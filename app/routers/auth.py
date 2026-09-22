import logging
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from app.config import settings
from app.schemas import LoginRequest

logger = logging.getLogger("auth-router")

router = APIRouter(tags=["auth"])


def verify_admin_pin(request: Request) -> bool:
    """Verifies sound operator / admin PIN from header, cookie, or query param."""
    auth_header = request.headers.get("X-Admin-PIN")
    cookie_pin = request.cookies.get("admin_pin") or request.cookies.get("admin_session")
    query_pin = request.query_params.get("pin")
    pin = auth_header or cookie_pin or query_pin
    if pin != settings.admin_pin:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid Admin PIN")
    return True


@router.post("/api/auth/login")
async def admin_login(login: LoginRequest):
    if login.pin == settings.admin_pin:
        response = JSONResponse(content={"status": "success", "message": "Authenticated"})
        response.set_cookie(
            key="admin_pin",
            value=login.pin,
            httponly=True,
            samesite="lax",
            max_age=86400  # 24 hours
        )
        return response
    raise HTTPException(status_code=401, detail="Invalid PIN. Please try again.")
