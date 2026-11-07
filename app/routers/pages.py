import os
import re
from html import escape
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Response, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.config import settings, get_setting
from app.guest_navigation import render_guest_navigation

router = APIRouter(tags=["pages"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")


@router.get("/", response_class=HTMLResponse)
async def serve_landing_page():
    landing_path = os.path.join(STATIC_DIR, "landing.html")
    if not os.path.isfile(landing_path):
        landing_path = os.path.join(STATIC_DIR, "index.html")
    with open(landing_path, "r", encoding="utf-8") as f:
        html = f.read()
    html = render_guest_navigation(_brand(html), "/")
    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@router.get("/signup", response_class=HTMLResponse)
async def serve_signup_page():
    signup_path = os.path.join(STATIC_DIR, "signup.html")
    with open(signup_path, "r", encoding="utf-8") as f:
        html = f.read()

    version = int(datetime.now(timezone.utc).timestamp())
    html = html.replace('/static/js/signup.js', f'/static/js/signup.js?v={version}')

    html = render_guest_navigation(_brand(html), "/signup")
    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/my-entry", response_class=HTMLResponse)
async def serve_performer_page():
    index_path = os.path.join(STATIC_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    version = int(datetime.now(timezone.utc).timestamp())
    html = html.replace('/static/js/intake.js', f'/static/js/intake.js?v={version}')

    html = render_guest_navigation(_brand(html), "/my-entry")
    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


def _brand(html: str) -> str:
    """Replace the template placeholder brand with the event's own (escaped) header text."""
    title = escape(str(get_setting("header_brand_title") or getattr(settings.event, "header_brand_title", "") or "Event"))
    subtitle = escape(str(get_setting("header_brand_subtitle") or getattr(settings.event, "header_brand_subtitle", "") or ""))
    html = html.replace("EMA Paattukoottam", title)
    return html.replace(">Musical Night<", f">{subtitle}<")


def _redirect_with_query(path: str, request: Request, status_code: int = 301):
    query = request.url.query
    return RedirectResponse(path + (f"?{query}" if query else ""), status_code=status_code)


@router.get("/performer")
async def redirect_performer(request: Request):
    return _redirect_with_query("/my-entry", request)


@router.get("/dashboard")
async def redirect_dashboard(request: Request):
    return _redirect_with_query("/schedule", request)


@router.get("/tracks")
async def redirect_tracks_to_performer(request: Request):
    """301 permanent redirect from old /tracks to /performer"""
    return _redirect_with_query("/my-entry", request)


@router.get("/upload")
async def redirect_upload_to_performer(request: Request):
    return _redirect_with_query("/my-entry", request)


@router.get("/intake")
async def redirect_intake_to_performer(request: Request):
    return _redirect_with_query("/my-entry", request)


@router.get("/schedule", response_class=HTMLResponse)
async def serve_dashboard_page():
    dash_path = os.path.join(STATIC_DIR, "dashboard.html")
    with open(dash_path, "r", encoding="utf-8") as f:
        html = f.read()
    html = render_guest_navigation(_brand(html), "/schedule")
    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/admin", response_class=HTMLResponse)
async def serve_admin_settings_page():
    admin_settings_path = os.path.join(STATIC_DIR, "admin-settings.html")
    with open(admin_settings_path, "r", encoding="utf-8") as f:
        html = f.read()

    version = int(datetime.now(timezone.utc).timestamp())
    html = html.replace('/static/js/admin-settings.js', f'/static/js/admin-settings.js?v={version}')

    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/settings")
async def redirect_settings_to_admin():
    return RedirectResponse(url="/admin")


@router.get("/console", response_class=HTMLResponse)
async def serve_console_page():
    admin_path = os.path.join(STATIC_DIR, "admin.html")
    with open(admin_path, "r", encoding="utf-8") as f:
        html = f.read()

    version = int(datetime.now(timezone.utc).timestamp())
    html = html.replace('/static/js/admin.js', f'/static/js/admin.js?v={version}')

    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/console/stage-monitor", response_class=HTMLResponse)
async def serve_stage_monitor_page():
    stage_path = os.path.join(STATIC_DIR, "stage-monitor.html")
    if not os.path.isfile(stage_path):
        raise HTTPException(status_code=404, detail="Stage monitor page not found")
    with open(stage_path, "r", encoding="utf-8") as f:
        html = f.read()

    version = int(datetime.now(timezone.utc).timestamp())
    html = html.replace('/static/js/stage-monitor.js', f'/static/js/stage-monitor.js?v={version}')

    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/stage-monitor")
async def redirect_stage_monitor():
    return RedirectResponse(url="/console/stage-monitor", status_code=302)


@router.get("/live", response_class=HTMLResponse)
async def serve_live_page():
    live_path = os.path.join(STATIC_DIR, "live.html")
    with open(live_path, "r", encoding="utf-8") as f:
        html = f.read()

    html = render_guest_navigation(html, "/live")
    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/sw.js")
async def serve_service_worker():
    sw_path = os.path.join(STATIC_DIR, "sw.js")
    if not os.path.exists(sw_path):
        raise HTTPException(status_code=404, detail="Service worker not found")
    with open(sw_path, "r", encoding="utf-8") as f:
        content = f.read()
    response = Response(content=content, media_type="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response
