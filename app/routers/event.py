import logging
from fastapi import APIRouter

from app.config import settings, get_setting, parse_event_datetime
from app.services.downloader_client import downloader_client

logger = logging.getLogger("event-router")

router = APIRouter(tags=["event"])


@router.get("/api/event-info")
def get_event_info():
    sheet_url = get_setting("signup_sheet_url") or settings.event.signup_sheet_url or f"https://docs.google.com/spreadsheets/d/{settings.google.sheet_id}/edit"
    payment_url = get_setting("payment_url") or settings.event.payment_url
    poster_url = get_setting("event_poster_url") or settings.event.poster_url
    header_brand_title = get_setting("header_brand_title") or getattr(settings.event, "header_brand_title", "EMA Paattukoottam")
    header_brand_subtitle = get_setting("header_brand_subtitle") or getattr(settings.event, "header_brand_subtitle", "Musical Night")
    event_name = get_setting("event_name") or settings.event.name
    event_subtitle = get_setting("event_subtitle") or settings.event.subtitle
    start_time = get_setting("event_start_time") or get_setting("event_date_time") or settings.event.start_time
    venue = get_setting("event_venue") or get_setting("venue") or settings.event.venue
    time_range = get_setting("time_range") or get_setting("event_time_range") or settings.event.time_range
    general_notes = get_setting("general_notes") or settings.event.general_notes or ""

    hero_tag_primary = get_setting("hero_tag_primary") or getattr(settings.event, "hero_tag_primary", "Musical Evening")
    hero_tag_status = get_setting("hero_tag_status") or getattr(settings.event, "hero_tag_status", "Stage Ready")

    payment_enabled = bool(get_setting("payment_enabled", getattr(settings.signup, "payment_enabled", True)))
    effective_payment_url = payment_url if payment_enabled else ""

    return {
        "event_id": get_setting("event_id") or settings.event.id,
        "header_brand_title": header_brand_title,
        "header_brand_subtitle": header_brand_subtitle,
        "event_name": event_name,
        "app_title": event_name,
        "app_subtitle": event_subtitle,
        "event_start_time": start_time,
        "event_start_time_iso": parse_event_datetime(start_time),
        "poster_url": poster_url,
        "venue": venue,
        "time_range": time_range,
        "general_notes": general_notes,
        "hero_tag_primary": hero_tag_primary,
        "hero_tag_status": hero_tag_status,
        "payment_url": effective_payment_url,
        "payment_enabled": payment_enabled,
        "stage_performances_enabled": bool(get_setting("stage_performances_enabled", getattr(settings.signup, "stage_performances_enabled", True))),
        "signup_enabled": bool(get_setting("signup_enabled", getattr(settings.signup, "signup_enabled", True))),
        "food_signup_enabled": bool(get_setting("food_signup_enabled", getattr(settings.signup, "food_signup_enabled", True))),
        "track_upload_enabled": bool(get_setting("track_upload_enabled", getattr(settings.signup, "track_upload_enabled", True))),
        "allow_duets": bool(get_setting("allow_duets", getattr(settings.signup, "allow_duets", True))),
        "performer_edits_enabled": bool(get_setting("performer_edits_enabled", getattr(settings.signup, "performer_edits_enabled", True))),
        "live_display_enabled": bool(get_setting("live_display_enabled", getattr(settings.signup, "live_display_enabled", True))),
        "dashboard_enabled": bool(get_setting("dashboard_enabled", getattr(settings.signup, "dashboard_enabled", True))),
        "console_enabled": bool(get_setting("console_enabled", getattr(settings.signup, "console_enabled", True))),
        "mock_mode": settings.mock_google_api,
        "max_upload_size_mb": settings.storage.max_upload_size_mb,
        "sheet_url": sheet_url
    }


@router.get("/api/health")
async def health():
    downloader_status = await downloader_client.check_health()
    return {
        "status": "healthy",
        "app": "event-track-manager",
        "mock_mode": settings.mock_google_api,
        "downloader": downloader_status
    }
