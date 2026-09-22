import os
import re
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import HTMLResponse, RedirectResponse

from app.config import settings, get_setting

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

    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/performer", response_class=HTMLResponse)
async def serve_performer_page():
    index_path = os.path.join(STATIC_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    version = int(datetime.now(timezone.utc).timestamp())
    html = html.replace('/static/js/intake.js', f'/static/js/intake.js?v={version}')

    response = HTMLResponse(content=html)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/tracks")
async def redirect_tracks_to_performer():
    """301 permanent redirect from old /tracks to /performer"""
    return RedirectResponse(url="/performer", status_code=301)


@router.get("/upload")
async def redirect_upload_to_performer():
    return RedirectResponse(url="/tracks")


@router.get("/intake")
async def redirect_intake_to_performer():
    return RedirectResponse(url="/tracks")


@router.get("/dashboard", response_class=HTMLResponse)
async def serve_dashboard_page():
    dash_path = os.path.join(STATIC_DIR, "dashboard.html")
    with open(dash_path, "r", encoding="utf-8") as f:
        html = f.read()
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
