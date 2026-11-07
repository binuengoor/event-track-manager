import logging
from typing import List, Dict, Any
from fastapi import APIRouter

from app.features import feature_enabled
from app.config import settings, get_setting
from app.services.db_service import db_service
from app.privacy import strip_private, NamePrivacy, public_status

logger = logging.getLogger("dashboard-router")

router = APIRouter(tags=["dashboard"])


@router.get("/api/dashboard/performances")
def dashboard_performances():
    if not feature_enabled("dashboard_enabled"):
        return []

    perfs = db_service.get_all_performances()
    active_id = db_service.get_active_entry_id()
    names = NamePrivacy(perfs)
    results = []
    for p in perfs:
        has_track = bool(p.get("drive_file_id") or p.get("track_status") == "Uploaded")
        results.append({
            "entry_id": p.get("entry_id"),
            "performer_name": names.name(p.get("performer_name")),
            "performance_type": p.get("performance_type", "Solo"),
            "partner_name": names.partners(p.get("partner_name")),
            "song_title": p.get("song_title", ""),
            "movie_name": p.get("movie_name", ""),
            "sequence_order": p.get("sequence_order"),
            "status": public_status(p.get("performance_status"), p.get("entry_id") == active_id),
            "duration": p.get("duration"),
            "has_track": has_track
        })
    return results


@router.get("/api/dashboard/food")
def dashboard_food():
    serving_note = get_setting("food_serving_note", settings.signup.food_serving_note)
    enabled = feature_enabled("food_signup_enabled")
    groups = [g for g in db_service.get_food_groups() if g.get("item_count", 0) > 0]
    items = db_service.get_all_food_items_with_signups()

    return {
        "enabled": enabled,
        "serving_note": serving_note,
        "groups": groups,
        "items": strip_private(items),
        "total_items": len(items),
        "taken_items": sum(1 for i in items if i.get("is_taken")),
        "open_items": sum(1 for i in items if not i.get("is_taken")),
    }
