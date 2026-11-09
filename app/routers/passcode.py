import os
from typing import Optional
from urllib.parse import quote, urlparse
from fastapi import APIRouter, HTTPException, Request, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from app.config import settings, get_setting

router = APIRouter(tags=["passcode"])

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates")


class PasscodeVerifyRequest(BaseModel):
    passcode: str


def get_current_passcode() -> str:
    val = get_setting("event_passcode", getattr(settings.event, "event_passcode", "")) or ""
    return str(val).strip()


def safe_next_url(url: Optional[str]) -> str:
    if not url:
        return "/"
    clean = url.strip()
    if clean.startswith("/") and not clean.startswith("//") and "\\" not in clean:
        return clean
    return "/"


@router.get("/gate", response_class=HTMLResponse)
async def serve_gate_page(request: Request):
    gate_path = os.path.join(TEMPLATES_DIR, "gate.html")
    if not os.path.isfile(gate_path):
        raise HTTPException(status_code=404, detail="Gate page not found")
    with open(gate_path, "r", encoding="utf-8") as f:
        html = f.read()
    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.post("/gate")
async def submit_gate_form(passcode: str = Form(""), next: str = Form("/")):
    current = get_current_passcode()
    target = safe_next_url(next)
    if not current or passcode.strip() == current:
        res = RedirectResponse(url=target, status_code=303)
        res.set_cookie(
            key="etm_passcode",
            value=current or passcode.strip(),
            path="/",
            samesite="lax",
            max_age=86400 * 30,
        )
        return res
    return RedirectResponse(url=f"/gate?error=invalid&next={quote(target)}", status_code=303)


@router.post("/api/auth/passcode")
async def verify_passcode_api(payload: PasscodeVerifyRequest):
    current = get_current_passcode()
    if not current or payload.passcode.strip() == current:
        res = JSONResponse({"status": "success"})
        res.set_cookie(
            key="etm_passcode",
            value=current or payload.passcode.strip(),
            path="/",
            samesite="lax",
            max_age=86400 * 30,
        )
        return res
    raise HTTPException(status_code=401, detail="Incorrect passcode")
