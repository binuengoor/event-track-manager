import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import settings
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.services.downloader_client import downloader_client
from app.events import register_default_listeners
from app.services.event_manager import event_manager

# Re-exports for backward compatibility
from app.schemas import (
    LoginRequest,
    StatusUpdateRequest,
    PerformanceNotesRequest,
    validate_phone,
    PerformanceSignupItem,
    FoodSignupItem,
    SignupRequest,
    PerformanceUpdateRequest,
    AdminParticipantUpdateRequest,
    AddPerformanceRequest,
    PerformerRenameRequest,
    FoodClaimRequest,
    FoodUpdateRequest,
    FoodGroupCreateRequest,
    FoodGroupUpdateRequest,
    FoodGroupReorderRequest,
    FoodItemCreateRequest,
    FoodItemUpdateRequest,
    FoodServingNoteRequest,
    FoodToggleRequest,
    SignupToggleRequest,
    SequenceItem,
    ReorderRequest,
)
from app.routers.auth import verify_admin_pin
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
    try:
        event_manager.bootstrap(seed_food=True, migrate_legacy=True)
    except Exception as ex:
        logger.warning("Event bootstrap failed: %s", ex)

    # 4. Start background backup debounce loop & pooled downloader client
    backup_service.start()
    await downloader_client.start()

    yield

    # Shutdown
    await downloader_client.close()
    await backup_service.stop()


app = FastAPI(
    title="EMA Paattukoottam Event & Track Manager",
    description="Track manager, self-service registration, potluck food sign-up, and stage console",
    version="2.0.0",
    lifespan=lifespan
)

# Static and Data Directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

PUBLIC_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")
PUBLIC_BLOCKED_TOP_LEVEL = {"tracks", "incoming", "backups", "cache", "db", "secrets"}

os.makedirs(settings.storage.event_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


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


@app.middleware("http")
async def revalidate_static_assets(request, call_next):
    """Static JS/CSS revalidate on every load (cheap 304s) so UI updates reach users without hard refreshes."""
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# Register Modular Routers
app.include_router(pages.router)
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
