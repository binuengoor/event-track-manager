import json
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException

from app.config import settings, get_setting
from app.features import feature_enabled, require_feature
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


# Public edit limits. Admin edits go through /api/admin/participants and are not constrained by these.
PUBLIC_TRACK_STATUSES = ("Pending", "Acoustic")      # "Uploaded" is set only by the upload workflow
FIELD_LIMITS = {
    "song_title": 150, "movie_name": 150, "partner_name": 100, "partner_age_group": 50, "partner_phone": 40,
    "age_group": 50, "guardian_name": 100, "guardian_phone": 40, "contact_info": 40, "stage_notes": 500,
}


def _allowed_performance_types() -> List[str]:
    types = get_setting("performance_types")
    if isinstance(types, str):
        try:
            types = json.loads(types)
        except Exception:
            types = [t.strip() for t in types.split(",") if t.strip()]
    if not types:
        types = settings.signup.performance_types
    return [str(t) for t in types]


def _canonical_type(value: str) -> str:
    wanted = value.strip().lower()
    return next((t for t in _allowed_performance_types() if t.strip().lower() == wanted), value.strip())


def _validate_public_edit(payload: PerformanceUpdateRequest, old_perf: Dict[str, Any]) -> None:
    """Rejects values the public edit endpoint must never accept (400 with a plain-language reason)."""
    if payload.track_status is not None and payload.track_status.strip() not in PUBLIC_TRACK_STATUSES:
        raise HTTPException(status_code=400, detail=f"Track status must be one of: {', '.join(PUBLIC_TRACK_STATUSES)}.")
    if payload.performance_type is not None:
        allowed = [t.strip().lower() for t in _allowed_performance_types()]
        if payload.performance_type.strip().lower() not in allowed:
            raise HTTPException(status_code=400, detail=f"Performance type must be one of: {', '.join(_allowed_performance_types())}.")
    for field, limit in FIELD_LIMITS.items():
        value = getattr(payload, field, None)
        if isinstance(value, str) and len(value.strip()) > limit:
            raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').capitalize()} is too long (max {limit} characters).")

    ptype = _canonical_type(payload.performance_type) if payload.performance_type else (old_perf.get("performance_type") or "Solo")
    if payload.performance_type and ptype.lower() != "solo" and not feature_enabled("allow_duets"):
        raise HTTPException(status_code=400, detail="Duet and group performances are currently disabled for this event (Solo only).")

    # Re-check the duet partner rule whenever the edit touches the type or the partner.
    if ptype.strip().capitalize() == "Duet" and (payload.performance_type or payload.partner_name is not None or payload.partner_phone is not None):
        partner = (payload.partner_name if payload.partner_name is not None else old_perf.get("partner_name")) or ""
        partner = partner.strip()
        if not partner:
            raise HTTPException(status_code=400, detail="Partner name is required for Duet performance.")
        registered = {(p.get("performer_name") or "").strip().lower() for p in db_service.get_all_performances() if p.get("performer_name")}
        if partner.lower() not in registered:
            phone = (payload.partner_phone or "").strip() or (old_perf.get("partner_phone") or "").strip()
            if not validate_phone(phone):
                raise HTTPException(status_code=400, detail=f"A valid 10-digit phone number is required for partner '{partner}'.")


@router.put("/api/signup/performance/{entry_id}")
async def update_performance_song(entry_id: str, payload: PerformanceUpdateRequest):
    require_feature("performer_edits_enabled", "Performer self-service editing is currently locked for this event.")

    old_perf = db_service.get_performance(entry_id)
    if not old_perf:
        raise HTTPException(status_code=404, detail=f"Performance entry {entry_id} not found")
    _validate_public_edit(payload, old_perf)
    if payload.performance_type:
        payload.performance_type = _canonical_type(payload.performance_type)
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
    # Phones are never returned to the public hub, so blank values mean "unchanged".
    for private_field in ("partner_phone", "guardian_phone", "contact_info", "guardian_name"):
        if not (update_kwargs.get(private_field) or "").strip():
            update_kwargs.pop(private_field, None)
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
