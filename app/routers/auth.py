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


def _session_token() -> str:
    """Cookie value derived from the PIN, so the raw PIN is never stored in the cookie."""
    return hmac.new(settings.admin_pin.encode(), b"event-track-manager-admin-session", hashlib.sha256).hexdigest()


def _pin_ok(pin: Optional[str]) -> bool:
    return bool(pin) and hmac.compare_digest(pin.encode(), settings.admin_pin.encode())


def _credentials_valid(request: Request) -> bool:
    if _pin_ok(request.headers.get("X-Admin-PIN")):
        return True
    cookie = request.cookies.get("admin_session")
    return bool(cookie) and hmac.compare_digest(cookie.encode(), _session_token().encode())


def is_admin(request: Request) -> bool:
    """Non-raising check used by public endpoints to decide how much data to return."""
    return _credentials_valid(request)


def verify_admin_pin(request: Request) -> bool:
    """Verifies the admin PIN (X-Admin-PIN header) or the signed session cookie."""
    key = client_key(request)
    if failure_limiter.is_blocked(key):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in a few minutes.")
    if _credentials_valid(request):
        return True
    failure_limiter.record_failure(key)
    raise HTTPException(status_code=401, detail="Unauthorized: Invalid Admin PIN")


@router.post("/api/auth/login")
async def admin_login(login: LoginRequest, request: Request):
    key = client_key(request)
    if failure_limiter.is_blocked(key):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in a few minutes.")
    if _pin_ok(login.pin):
        response = JSONResponse(content={"status": "success", "message": "Authenticated"})
        secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        response.set_cookie(
            key="admin_session",
            value=_session_token(),
            httponly=True,
            secure=secure,
            samesite="strict",
            max_age=86400  # 24 hours
        )
        return response
    failure_limiter.record_failure(key)
    raise HTTPException(status_code=401, detail="Invalid PIN. Please try again.")
