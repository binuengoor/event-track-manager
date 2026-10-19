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


class FailureLimiter:
    def __init__(self):
        self._lock = threading.Lock()
        self._per_client: Dict[str, Deque[float]] = {}
        self._global: Deque[float] = deque()

    def _prune(self, dq: Deque[float], now: float):
        while dq and now - dq[0] > FAIL_WINDOW_SECONDS:
            dq.popleft()

    def is_blocked(self, client: str) -> bool:
        now = time.time()
        with self._lock:
            self._prune(self._global, now)
            dq = self._per_client.get(client)
            if dq is not None:
                self._prune(dq, now)
            return len(self._global) >= MAX_FAILS_GLOBAL or (dq is not None and len(dq) >= MAX_FAILS_PER_CLIENT)

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


def client_key(request: Request) -> str:
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


def _operator_pin() -> str:
    pin = getattr(settings, "operator_pin", "") or ""
    return pin if pin and pin != settings.admin_pin else ""


def _role(request: Request) -> Optional[str]:
    """'admin', 'operator' (sound console only) or None, from the PIN header or the signed session cookie."""
    header = request.headers.get("X-Admin-PIN")
    if _eq(header, settings.admin_pin):
        return "admin"
    if _operator_pin() and _eq(header, _operator_pin()):
        return "operator"
    if _eq(request.cookies.get("admin_session"), _token("admin", settings.admin_pin)):
        return "admin"
    if _operator_pin() and _eq(request.cookies.get("operator_session"), _token("operator", _operator_pin())):
        return "operator"
    return None


def is_admin(request: Request) -> bool:
    """Non-raising check used by public endpoints to decide how much data to return."""
    return _role(request) == "admin"


def _guard(request: Request, allowed: tuple) -> bool:
    key = client_key(request)
    if failure_limiter.is_blocked(key):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in a few minutes.")
    role = _role(request)
    if role in allowed:
        return True
    if role is None:
        failure_limiter.record_failure(key)
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid Admin PIN")
    raise HTTPException(status_code=403, detail="This PIN only opens the sound console. Use the admin PIN for settings.")


def verify_admin_pin(request: Request) -> bool:
    """Admin only: settings, roster, presets, food catalog, backups."""
    return _guard(request, ("admin",))


def verify_operator_pin(request: Request) -> bool:
    """Admin or sound operator: cueing, status, order, track downloads, exports."""
    return _guard(request, ("admin", "operator"))


@router.post("/api/auth/login")
async def admin_login(login: LoginRequest, request: Request):
    key = client_key(request)
    if failure_limiter.is_blocked(key):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in a few minutes.")
    role = None
    if _eq(login.pin, settings.admin_pin):
        role, pin = "admin", settings.admin_pin
    elif _operator_pin() and _eq(login.pin, _operator_pin()):
        role, pin = "operator", _operator_pin()
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
    failure_limiter.record_failure(key)
    raise HTTPException(status_code=401, detail="Invalid PIN. Please try again.")
