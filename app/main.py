import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.services.db_service import db_service
from app.services.backup_service import backup_service

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

    # 3. Start background backup debounce loop
    backup_service.start()

    yield

    # Shutdown
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
DATA_DIR = os.getenv("DATA_DIR", "/data" if os.path.exists("/data") else os.path.join(os.path.dirname(BASE_DIR), "data"))

os.makedirs(DATA_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")

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
