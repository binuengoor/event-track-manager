import os
import hmac
import time
import hashlib
import logging
import threading
from collections import deque
from typing import Deque, Dict, Optional

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from app.config import settings
from app.schemas import LoginRequest

logger = logging.getLogger("auth-router")

router = APIRouter(tags=["auth"])

# Failed-attempt throttling: per client and global (the global cap stops attackers who
# rotate spoofed X-Forwarded-For values against a 4-digit PIN).
FAIL_WINDOW_SECONDS = 300
MAX_FAILS_PER_CLIENT = 8
MAX_FAILS_GLOBAL = 100


class RateLimited(HTTPException):
    """429 with Retry-After. Register ``register_auth_handlers(app)`` so the JSON body also carries ``retry_after``."""

    def __init__(self, retry_after: int):
        self.retry_after = max(int(retry_after), 1)
        super().__init__(status_code=429, detail="Too many failed attempts. Try again in a few minutes.",
                         headers={"Retry-After": str(self.retry_after)})


async def _rate_limited_handler(_request: Request, exc: RateLimited):
    return JSONResponse(status_code=429, content={"detail": exc.detail, "retry_after": exc.retry_after},
                        headers={"Retry-After": str(exc.retry_after)})


def register_auth_handlers(app) -> None:
    """Idempotent: makes 429 bodies carry ``retry_after`` next to the Retry-After header."""
    app.add_exception_handler(RateLimited, _rate_limited_handler)


class FailureLimiter:
    def __init__(self):
        self._lock = threading.Lock()
        self._per_client: Dict[str, Deque[float]] = {}
        self._global: Deque[float] = deque()

    def _prune(self, dq: Deque[float], now: float):
        while dq and now - dq[0] > FAIL_WINDOW_SECONDS:
            dq.popleft()

    def is_blocked(self, client: str) -> bool:
        return self.retry_after(client) > 0

    def retry_after(self, client: str) -> int:
        """Seconds until the client may try again; 0 when not blocked."""
        now = time.time()
        waits = []
        with self._lock:
            self._prune(self._global, now)
            dq = self._per_client.get(client)
            if dq is not None:
                self._prune(dq, now)
            if len(self._global) >= MAX_FAILS_GLOBAL:
                waits.append(self._global[len(self._global) - MAX_FAILS_GLOBAL] + FAIL_WINDOW_SECONDS - now)
            if dq is not None and len(dq) >= MAX_FAILS_PER_CLIENT:
                waits.append(dq[len(dq) - MAX_FAILS_PER_CLIENT] + FAIL_WINDOW_SECONDS - now)
        return max(1, int(max(waits) + 0.999)) if waits else 0

    def record_failure(self, client: str):
        now = time.time()
        with self._lock:
            self._global.append(now)
            self._per_client.setdefault(client, deque()).append(now)

    def reset(self):
        with self._lock:
            self._per_client.clear()
            self._global.clear()


failure_limiter = FailureLimiter()


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def trust_cloudflare() -> bool:
    """TRUST_CLOUDFLARE=true: the app is only reachable through Cloudflare, so CF-Connecting-IP is trustworthy."""
    return _env_flag("TRUST_CLOUDFLARE")


def trust_proxy() -> bool:
    """TRUST_PROXY=true: a reverse proxy we control sets X-Forwarded-For. Off by default (clients can spoof it)."""
    return _env_flag("TRUST_PROXY")


def client_key(request: Request) -> str:
    """Lockout key. Forwarded headers are honoured only when explicitly trusted; otherwise the socket peer."""
    if trust_cloudflare():
        cf_ip = request.headers.get("cf-connecting-ip", "").strip()
        if cf_ip:
            return cf_ip
    if trust_cloudflare() or trust_proxy():
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _token(role: str, pin: str) -> str:
    """Cookie value derived from the PIN, so the raw PIN is never stored in the cookie."""
    return hmac.new(pin.encode(), f"event-track-manager-{role}-session".encode(), hashlib.sha256).hexdigest()


def _session_token() -> str:  # kept for tests/back-compat
    return _token("admin", settings.admin_pin)


def _eq(a: Optional[str], b: Optional[str]) -> bool:
    return bool(a) and bool(b) and hmac.compare_digest(a.encode(), b.encode())


def _role(request: Request) -> Optional[str]:
    """Recognize only the shared admin PIN and its signed session cookie."""
    if _eq(request.headers.get("X-Admin-PIN"), settings.admin_pin):
        return "admin"
    if _eq(request.cookies.get("admin_session"), _token("admin", settings.admin_pin)):
        return "admin"
    return None


def is_admin(request: Request) -> bool:
    """Non-raising check used by public endpoints to decide how much data to return."""
    return _role(request) == "admin"


def _credentials_supplied(request: Request) -> bool:
    return bool((request.headers.get("X-Admin-PIN") or "").strip() or request.cookies.get("admin_session"))


def _guard(request: Request, allowed: tuple) -> bool:
    """Only a SUPPLIED wrong PIN or bad cookie counts toward lockout; no credentials is a plain, uncounted 401."""
    key = client_key(request)
    wait = failure_limiter.retry_after(key)
    if wait:
        raise RateLimited(wait)
    role = _role(request)
    if role in allowed:
        return True
    if _credentials_supplied(request):
        failure_limiter.record_failure(key)
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid Admin PIN")
    raise HTTPException(status_code=401, detail="Unauthorized: Admin PIN required")


def verify_admin_pin(request: Request) -> bool:
    """Admin only: settings, roster, presets, food catalog, backups, console."""
    return _guard(request, ("admin",))


# Thin alias: app/routers/{audio,stage}.py (owned by other packages) still import this name.
verify_operator_pin = verify_admin_pin


@router.post("/api/auth/login")
async def admin_login(login: LoginRequest, request: Request):
    key = client_key(request)
    wait = failure_limiter.retry_after(key)
    if wait:
        raise RateLimited(wait)
    role = None
    if _eq(login.pin, settings.admin_pin):
        role, pin = "admin", settings.admin_pin
    if role:
        response = JSONResponse(content={"status": "success", "message": "Authenticated", "role": role})
        secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        response.set_cookie(
            key=f"{role}_session",
            value=_token(role, pin),
            httponly=True,
            secure=secure,
            samesite="strict",
            max_age=86400  # 24 hours
        )
        return response
    if (login.pin or "").strip():
        failure_limiter.record_failure(key)
    raise HTTPException(status_code=401, detail="Invalid PIN. Please try again.")
