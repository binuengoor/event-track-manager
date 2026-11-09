import os
import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse, JSONResponse

from app.config import settings
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.services.downloader_client import downloader_client
from app.events import register_default_listeners
from app.services.event_manager import event_manager
from app.services.event_service import event_service
from app.services.media_asset_service import GALLERY_PUBLIC_MIMES, POSTER_MIMES

from app.routers.auth import verify_admin_pin, register_auth_handlers
from app.routers import (
    pages,
    auth,
    event,
    signup,
    food,
    performer,
    dashboard,
    admin,
    stage,
    audio,
    data,
    events,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("event-track-manager")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 0. Register in-process domain event listeners
    register_default_listeners()

    # 1-3. Make the active event ready: schema, default settings (first boot only), first-time potluck menu,
    #      tracks on disk aligned with the database, and the first export into the event folder
    logger.info("Active event: %s  folder: %s  (switching %s)", event_manager.active_id(), settings.storage.event_dir,
                "on" if event_manager.switching_enabled() else "off, EVENT_DIR pins one folder")
    event_manager.bootstrap(seed_food=True, migrate_legacy=True)

    # 4. Start background backup debounce loop & pooled downloader client
    backup_service.start()
    await downloader_client.start()
    event_service.start_reconcile_worker()

    try:
        yield
    finally:
        await asyncio.to_thread(event_service.stop_reconcile_worker)
        await downloader_client.close()
        await backup_service.stop()


app = FastAPI(
    title="Event Track Manager",
    description="Track manager, self-service registration, potluck food sign-up, and stage console",
    version="2.0.0",
    lifespan=lifespan
)

# Static and Data Directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

PUBLIC_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")
PUBLIC_BLOCKED_TOP_LEVEL = {"tracks", "incoming", "backups", "cache", "db", "secrets"}

class AppStaticFiles(StaticFiles):
    # Do not serve guest HTML templates directly: the page routes inject event navigation.
    GUEST_ALIASES = {
        "landing.html": "/", "index.html": "/my-entry", "signup.html": "/signup",
        "dashboard.html": "/schedule", "live.html": "/live",
    }

    async def get_response(self, path, scope):
        if path in self.GUEST_ALIASES:
            query = scope.get("query_string", b"").decode("latin-1")
            target = self.GUEST_ALIASES[path] + (f"?{query}" if query else "")
            return RedirectResponse(target, status_code=307)
        return await super().get_response(path, scope)


os.makedirs(settings.storage.event_dir, exist_ok=True)
app.mount("/static", AppStaticFiles(directory=STATIC_DIR), name="static")


@app.api_route("/data/{file_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_public_data(file_path: str):
    """Poster and gallery images of the ACTIVE event only (resolved per request, so switching events just works).
    Never tracks, exports, backups or databases."""
    parts = [p.lower() for p in file_path.replace("\\", "/").split("/") if p]
    if not parts or parts[0] in PUBLIC_BLOCKED_TOP_LEVEL or ".." in parts or not parts[-1].endswith(PUBLIC_IMAGE_EXTS):
        raise HTTPException(status_code=404)
    root = os.path.realpath(os.getenv("DATA_DIR") or settings.storage.event_dir)
    full = os.path.realpath(os.path.join(root, file_path))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        raise HTTPException(status_code=404)
    return FileResponse(full)


@app.api_route("/event-media/{file_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_event_media(file_path: str):
    """Serve only poster/gallery media from the currently active event's configured folders."""
    normalized = file_path.replace("\\", "/")
    parts = normalized.split("/")
    if (not normalized or any(part in ("", ".", "..") for part in parts)
            or any("\x00" in part for part in parts)):
        raise HTTPException(status_code=404)

    if parts[0] == "gallery":
        if len(parts) != 2:
            raise HTTPException(status_code=404)
        root = settings.storage.gallery_dir
        allowed = GALLERY_PUBLIC_MIMES
        name = parts[1]
    else:
        if len(parts) != 1:
            raise HTTPException(status_code=404)
        root = settings.storage.event_dir
        allowed = POSTER_MIMES
        name = parts[0]

    extension = os.path.splitext(name)[1].lower()
    if name.startswith(".") or extension not in allowed:
        raise HTTPException(status_code=404)
    root = os.path.realpath(root)
    candidate = os.path.join(root, name)
    full = os.path.realpath(candidate)
    try:
        contained = os.path.commonpath((root, full)) == root
    except ValueError:
        contained = False
    if not contained or os.path.islink(candidate) or not os.path.isfile(full):
        raise HTTPException(status_code=404)
    return FileResponse(full, media_type=allowed[extension], headers={
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    })


ROBOTS_TAG = "noindex, nofollow, noarchive"


@app.middleware("http")
async def no_search_indexing(request, call_next):
    """Public pages list children's names: ask every crawler to stay away (also covered by /robots.txt)."""
    response = await call_next(request)
    response.headers["X-Robots-Tag"] = ROBOTS_TAG
    return response


@app.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    return PlainTextResponse("User-agent: *\nDisallow: /")


@app.middleware("http")
async def revalidate_static_assets(request, call_next):
    """Static JS/CSS revalidate on every load (cheap 304s) so UI updates reach users without hard refreshes."""
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


from app.routers import (
    pages, auth, event, signup, food, performer, dashboard, admin, stage, audio, data, events, passcode
)
from app.routers.auth import is_admin
from app.routers.passcode import get_current_passcode

PASSCODE_EXEMPT_EXACT = {"/robots.txt", "/favicon.ico", "/api/health", "/gate", "/live"}
PASSCODE_EXEMPT_PREFIXES = (
    "/static/", "/data/", "/event-media/",
    "/api/live-status", "/api/live-stream",
    "/admin", "/console", "/api/admin/", "/api/auth/",
)


@app.middleware("http")
async def event_passcode_guard(request: Request, call_next):
    passcode_val = get_current_passcode()
    if not passcode_val:
        return await call_next(request)

    path = request.url.path
    if path in PASSCODE_EXEMPT_EXACT or any(path.startswith(prefix) for prefix in PASSCODE_EXEMPT_PREFIXES):
        return await call_next(request)

    if is_admin(request):
        return await call_next(request)

    query_t = request.query_params.get("t") or request.query_params.get("passcode")
    if query_t and query_t.strip() == passcode_val:
        response = await call_next(request)
        response.set_cookie(
            key="etm_passcode",
            value=passcode_val,
            path="/",
            samesite="lax",
            max_age=86400 * 30,
        )
        return response

    cookie_val = request.cookies.get("etm_passcode")
    if cookie_val and cookie_val.strip() == passcode_val:
        return await call_next(request)

    if path.startswith("/api/"):
        return JSONResponse(status_code=401, content={"detail": "Event passcode required"})

    next_url = path
    if request.url.query:
        params = [p for p in request.url.query.split("&") if p and not p.startswith("t=") and not p.startswith("passcode=")]
        if params:
            next_url += f"?{'&'.join(params)}"
    from urllib.parse import quote
    return RedirectResponse(url=f"/gate?next={quote(next_url)}", status_code=303)


# Register Modular Routers
register_auth_handlers(app)
app.include_router(pages.router)
app.include_router(passcode.router)
app.include_router(auth.router)
app.include_router(event.router)
app.include_router(signup.router)
app.include_router(food.router)
app.include_router(performer.router)
app.include_router(dashboard.router)
app.include_router(admin.router)
app.include_router(stage.router)
app.include_router(audio.router)
app.include_router(data.router)
app.include_router(events.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
