import json
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException

from app.config import settings, get_setting
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.schemas import (
    SignupRequest,
    PerformanceUpdateRequest,
    validate_phone,
)

logger = logging.getLogger("signup-router")

router = APIRouter(tags=["signup"])


from app.services.registration_service import registration_service
from app.exceptions import RegistrationError, PerformerLimitReachedError, FoodItemUnavailableError


@router.get("/api/signup/config")
async def get_signup_config():
    return registration_service.get_signup_config()


@router.post("/api/signup")
async def register_participant(payload: SignupRequest):
    try:
        return registration_service.register_participant(payload)
    except FoodItemUnavailableError as ex:
        raise HTTPException(status_code=409, detail=str(ex))
    except (RegistrationError, PerformerLimitReachedError) as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.put("/api/signup/performance/{entry_id}")
async def update_performance_song(entry_id: str, payload: PerformanceUpdateRequest):
    if not bool(get_setting("performer_edits_enabled", getattr(settings.signup, "performer_edits_enabled", True))):
        raise HTTPException(
            status_code=400,
            detail="Performer self-service editing is currently locked for this event."
        )

    old_perf = db_service.get_performance(entry_id) or {}
    update_kwargs = {
        "song_title": payload.song_title,
        "movie_name": payload.movie_name,
        "partner_name": payload.partner_name,
        "partner_age_group": payload.partner_age_group,
        "partner_phone": payload.partner_phone,
        "performance_type": payload.performance_type,
        "stage_notes": payload.stage_notes,
        "age_group": payload.age_group,
        "guardian_name": payload.guardian_name,
        "guardian_phone": payload.guardian_phone,
        "contact_info": payload.contact_info
    }
    if payload.track_status is not None:
        update_kwargs["track_status"] = payload.track_status
    elif payload.is_acoustic is not None:
        update_kwargs["track_status"] = "Acoustic" if payload.is_acoustic else "Pending"

    success = db_service.update_performance_details(
        entry_id,
        **update_kwargs
    )
    if not success:
        raise HTTPException(status_code=404, detail=f"Performance entry {entry_id} not found")

    backup_service.trigger_backup()

    changes = []
    if payload.song_title is not None and payload.song_title != (old_perf.get("song_title") or ""):
        changes.append(f"Song: '{old_perf.get('song_title') or 'TBD'}' -> '{payload.song_title}'")
    if payload.movie_name is not None and payload.movie_name != (old_perf.get("movie_name") or ""):
        changes.append(f"Movie: '{payload.movie_name}'")
    if payload.partner_name is not None and payload.partner_name != (old_perf.get("partner_name") or ""):
        changes.append(f"Partner: '{payload.partner_name}'")
    if payload.stage_notes is not None and payload.stage_notes != (old_perf.get("stage_notes") or ""):
        changes.append("Stage notes updated")
    change_summary = "; ".join(changes) if changes else f"Performance details updated for {entry_id}"
    dump_dict = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    db_service.log_activity(
        action_type="performance_update",
        performer_name=old_perf.get("performer_name", "Participant"),
        entry_id=entry_id,
        summary=change_summary,
        details=json.dumps({k: v for k, v in dump_dict.items() if v is not None}),
        source="performer_hub"
    )

    return {"status": "success", "entry_id": entry_id}
