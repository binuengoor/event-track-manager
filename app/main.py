import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.services.downloader_client import downloader_client
from app.events import register_default_listeners

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
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("event-track-manager")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 0. Register in-process domain event listeners
    register_default_listeners()

    # 1. Seed runtime app_settings in DB on first run from .env / config.yaml
    defaults = {
        "event_name": settings.event.name,
        "event_subtitle": settings.event.subtitle,
        "event_date_time": settings.event.start_time,
        "event_start_time": settings.event.start_time,
        "event_venue": settings.event.venue,
        "event_time_range": settings.event.time_range,
        "event_poster_url": settings.event.poster_url,
        "payment_url": settings.event.payment_url or "",
        "signup_sheet_url": settings.event.signup_sheet_url or "",
        "food_signup_enabled": settings.signup.food_signup_enabled,
        "signup_enabled": settings.signup.signup_enabled,
        "track_upload_enabled": settings.signup.track_upload_enabled,
        "allow_duets": settings.signup.allow_duets,
        "performer_edits_enabled": settings.signup.performer_edits_enabled,
        "live_display_enabled": settings.signup.live_display_enabled,
        "dashboard_enabled": settings.signup.dashboard_enabled,
        "payment_enabled": settings.signup.payment_enabled,
        "food_serving_note": settings.signup.food_serving_note,
        "max_performances_per_participant": settings.signup.max_performances_per_participant,
        "max_solo_per_participant": settings.signup.max_solo_per_participant,
        "performance_types": settings.signup.performance_types,
        "age_groups": [ag.model_dump() for ag in settings.signup.age_groups],
        "entry_id_prefix": settings.entry_id_prefix,
        "console_extra_columns": settings.console_extra_columns,
        "live_order_by": settings.live_order_by,
        "backup_enabled": settings.backup.enabled,
    }
    db_service.seed_app_settings(defaults)

    # 2. Seed initial food catalog if tables are empty
    db_service.seed_food_catalog(settings.food_items_seed)

    # 3. Align tracks on disk with the database and write the first export into the event folder
    try:
        from app.services.event_service import event_service
        from app.services.export_service import export_service
        event_service.migrate_legacy_cache_tracks()
        event_service.reconcile_tracks(force=True)
        export_service.export_now(snapshot=False)
    except Exception as ex:
        logger.warning("Initial event folder sync failed: %s", ex)

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
DATA_DIR = os.getenv("DATA_DIR") or settings.storage.event_dir

class PublicDataFiles(StaticFiles):
    """Serves poster/gallery images only (image extensions). Never tracks, exports, backups or databases."""
    ALLOWED_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")
    BLOCKED_TOP_LEVEL = {"tracks", "incoming", "backups", "cache", "db", "secrets"}

    async def get_response(self, path, scope):
        parts = [p.lower() for p in path.replace("\\", "/").split("/") if p]
        if (
            not parts
            or parts[0] in self.BLOCKED_TOP_LEVEL
            or ".." in parts
            or not parts[-1].endswith(self.ALLOWED_EXTS)
        ):
            raise HTTPException(status_code=404)
        return await super().get_response(path, scope)


os.makedirs(DATA_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/data", PublicDataFiles(directory=DATA_DIR), name="data")

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
