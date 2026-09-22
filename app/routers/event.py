import logging
from fastapi import APIRouter

from app.config import settings, get_setting, parse_event_datetime
from app.services.downloader_client import downloader_client

logger = logging.getLogger("event-router")

router = APIRouter(tags=["event"])


@router.get("/api/event-info")
async def get_event_info():
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
        "payment_url": payment_url,
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
