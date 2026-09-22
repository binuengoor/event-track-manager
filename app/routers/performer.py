import json
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException

from app.config import settings, get_setting
from app.services.db_service import db_service, is_placeholder_song_title
from app.services.backup_service import backup_service
from app.schemas import (
    AddPerformanceRequest,
    PerformerRenameRequest,
    validate_phone,
)

logger = logging.getLogger("performer-router")

router = APIRouter(tags=["performer"])


@router.get("/api/performer/profile")
async def get_performer_profile(name: str):
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name parameter is required.")

    all_perfs = db_service.get_all_performances()
    user_perfs = [
        p for p in all_perfs
        if clean_name.lower() in p.get("performer_name", "").lower()
        or clean_name.lower() in (p.get("partner_name") or "").lower()
    ]

    food_signup = db_service.get_food_signup_for_signer(clean_name)
    if not food_signup:
        for p in user_perfs:
            g_name = p.get("guardian_name")
            if g_name:
                food_signup = db_service.get_food_signup_for_signer(g_name)
                if food_signup:
                    break
    counts = db_service.count_performances_for_performer(clean_name)
    all_food_items = db_service.get_all_food_items_with_signups()
    serving_note = get_setting("food_serving_note", settings.signup.food_serving_note)
    food_enabled = bool(get_setting("food_signup_enabled", settings.signup.food_signup_enabled))

    # Other songs list for transparency
    user_ids = {up["entry_id"] for up in user_perfs}
    other_songs = [
        {
            "entry_id": p["entry_id"],
            "performer_name": p["performer_name"],
            "song_title": p.get("song_title") or "",
            "movie_name": p.get("movie_name") or "",
            "performance_type": p.get("performance_type", "Solo")
        }
        for p in all_perfs if p["entry_id"] not in user_ids and not is_placeholder_song_title(p.get("song_title"))
    ]

    return {
        "performer_name": clean_name,
        "performances": user_perfs,
        "food_signup": food_signup,
        "counts": counts,
        "food_enabled": food_enabled,
        "food_serving_note": serving_note,
        "all_food_items": all_food_items,
        "other_songs": other_songs
    }


@router.post("/api/performer/performances")
async def add_performer_performance(payload: AddPerformanceRequest):
    clean_name = payload.performer_name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Performer name is required.")

    all_perfs = db_service.get_all_performances()
    user_perfs = [
        p for p in all_perfs
        if clean_name.lower() == (p.get("performer_name") or "").strip().lower()
        or clean_name.lower() == (p.get("partner_name") or "").strip().lower()
    ]
    if not user_perfs:
        raise HTTPException(status_code=404, detail=f"No registration found for {clean_name}. Please sign up first.")

    max_perf = int(get_setting("max_performances_per_participant", settings.signup.max_performances_per_participant))
    if len(user_perfs) >= max_perf:
        raise HTTPException(status_code=400, detail=f"Maximum performances limit ({max_perf}) already reached for this participant.")

    perf_type = payload.performance_type.strip().capitalize() if payload.performance_type else "Solo"
    if perf_type == "Solo":
        max_solo = int(get_setting("max_solo_per_participant", settings.signup.max_solo_per_participant))
        solo_count = sum(1 for p in user_perfs if (p.get("performance_type") or "").strip().capitalize() == "Solo")
        if solo_count >= max_solo:
            raise HTTPException(status_code=400, detail=f"Only {max_solo} solo performance is allowed per participant.")

    partner_name = payload.partner_name.strip() if payload.partner_name else None
    partner_phone = payload.partner_phone.strip() if payload.partner_phone else ""
    if perf_type == "Duet":
        if not partner_name:
            raise HTTPException(status_code=400, detail="Partner name is required for Duet performance.")
        registered_names = {
            (p.get("performer_name") or "").strip().lower()
            for p in all_perfs
            if p.get("performer_name")
        }
        if partner_name.lower() not in registered_names:
            if not partner_phone or not validate_phone(partner_phone):
                raise HTTPException(
                    status_code=400,
                    detail=f"A valid 10-digit phone number is required for partner '{partner_name}'."
                )

    # Inherit demographics from primary performance
    ref_perf = user_perfs[0]
    contact_info = ref_perf.get("contact_info") or ""
    age_group = ref_perf.get("age_group") or ""
    guardian_name = ref_perf.get("guardian_name") or ""
    guardian_phone = ref_perf.get("guardian_phone") or ""

    track_status = "Acoustic" if payload.is_acoustic else "Pending"

    entry_id = db_service.create_performance(
        performer_name=clean_name,
        performance_type=perf_type,
        partner_name=partner_name,
        partner_age_group=payload.partner_age_group.strip() if payload.partner_age_group else None,
        contact_info=contact_info,
        partner_phone=partner_phone,
        song_title=payload.song_title.strip() if payload.song_title else "",
        movie_name=payload.movie_name.strip() if payload.movie_name else None,
        age_group=age_group,
        guardian_name=guardian_name,
        guardian_phone=guardian_phone,
        stage_notes=payload.stage_notes.strip() if payload.stage_notes else "",
        track_status=track_status,
        created_via="performer_hub"
    )
    backup_service.trigger_backup()

    dump_dict = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    db_service.log_activity(
        action_type="performance_update",
        performer_name=clean_name,
        entry_id=entry_id,
        summary=f"Added performance {entry_id} ({perf_type}: '{payload.song_title or 'Song TBD'}')",
        details=json.dumps(dump_dict),
        source="performer_hub"
    )

    return {"status": "success", "entry_id": entry_id, "message": "Performance added successfully."}


@router.put("/api/performer/rename")
async def rename_performer_endpoint(payload: PerformerRenameRequest):
    old_name = payload.old_name.strip()
    new_name = payload.new_name.strip()
    if not old_name or not new_name:
        raise HTTPException(status_code=400, detail="Both old name and new name are required.")
    
    try:
        db_service.rename_performer(old_name, new_name)
        backup_service.trigger_backup()

        db_service.log_activity(
            action_type="rename",
            performer_name=new_name,
            summary=f"Name changed from '{old_name}' to '{new_name}'",
            details=json.dumps({"old_name": old_name, "new_name": new_name}),
            source="performer_hub"
        )

        return {
            "status": "success",
            "old_name": old_name,
            "new_name": new_name,
            "message": f"Successfully renamed '{old_name}' to '{new_name}'."
        }
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
