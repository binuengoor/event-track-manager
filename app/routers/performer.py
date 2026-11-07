import json
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException

from app.features import feature_enabled
from app.config import settings, get_setting
from app.services.db_service import db_service, is_placeholder_song_title
from app.services.backup_service import backup_service
from app.privacy import strip_private, NamePrivacy
from app.utils.name_matcher import split_signer_names
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
    names = NamePrivacy(all_perfs)
    try:
        clean_name = names.resolve_name(clean_name)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    # Exact (case-insensitive) match only: substring matching let anyone enumerate every performer.
    wanted = clean_name.lower()
    user_perfs = [
        p for p in all_perfs
        if wanted == (p.get("performer_name") or "").strip().lower()
        or wanted in [t.lower() for t in split_signer_names(p.get("partner_name"))]
        or wanted == (p.get("partner_name") or "").strip().lower()
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
    food_enabled = feature_enabled("food_signup_enabled")
    stage_performances_enabled = feature_enabled("stage_performances_enabled")
    track_upload_enabled = feature_enabled("track_upload_enabled")
    edits_enabled = feature_enabled("performer_edits_enabled")
    allow_duets = feature_enabled("allow_duets")

    # When stage performances are disabled (e.g. potluck-only event), suppress performances & songs completely
    if not stage_performances_enabled:
        effective_perfs = []
        other_songs = []
    else:
        def shown(value):
            return names.name(value)

        def shown_partners(value):
            return names.partners(value) if names.active else value

        effective_perfs = [
            {**{k: v for k, v in p.items() if k not in ("drive_file_name", "age_group", "partner_age_group", "extra_tags", "stage_notes")}, "drive_file_id": "available" if p.get("drive_file_id") else None, "performer_name": shown(p.get("performer_name")), "partner_name": shown_partners(p.get("partner_name"))}
            for p in user_perfs
        ]
        # Other songs list for transparency
        user_ids = {up["entry_id"] for up in user_perfs}
        other_songs = [
            {
                "entry_id": p["entry_id"],
                "performer_name": names.name(p["performer_name"]),
                "song_title": p.get("song_title") or "",
                "movie_name": p.get("movie_name") or "",
                "performance_type": p.get("performance_type", "Solo")
            }
            for p in all_perfs if p["entry_id"] not in user_ids and not is_placeholder_song_title(p.get("song_title"))
        ]

    response = strip_private({
        "performer_name": names.name(clean_name),
        "performances": effective_perfs,
        "food_signup": food_signup,
        "counts": counts,
        "stage_performances_enabled": stage_performances_enabled,
        "food_enabled": food_enabled,
        "food_serving_note": serving_note,
        "track_upload_enabled": track_upload_enabled,
        "edits_enabled": edits_enabled,
        "allow_duets": allow_duets,
        "all_food_items": names.food_items(all_food_items),
        "other_songs": other_songs
    })
    if food_signup and response["food_signup"] is not None:
        # This is the selected performer's own claim, needed for editing it.
        response["food_signup"]["signup_id"] = food_signup.get("signup_id")
        response["food_signup"]["signer_name"] = names.partners(food_signup.get("signer_name"))
    return response


@router.get("/api/performer/names")
async def get_registered_participant_names():
    """Returns unique, sorted names of performers. When stage performances are enabled,
    returns distinct performer and partner names from performances to prevent food signups
    (e.g., family groupings like 'Rajiv & Anjana') from appearing in the performer dropdown.
    If stage performances are disabled, falls back to registered participants (e.g. food/attendees)."""
    stage_performances_enabled = feature_enabled("stage_performances_enabled")

    names = set()
    perfs = db_service.get_all_performances()
    privacy = NamePrivacy(perfs)
    for perf in perfs:
        pname = (perf.get("performer_name") or "").strip()
        if pname:
            names.add(privacy.name(pname))
        partner = (perf.get("partner_name") or "").strip()
        if partner:
            for person in split_signer_names(partner):
                names.add(privacy.name(person))

    if not stage_performances_enabled:
        participants = db_service.get_all_participants()
        for p in participants:
            n = (p.get("name") or "").strip()
            if n:
                names.add(privacy.name(n))

    return sorted(list(names), key=lambda x: x.lower())


@router.post("/api/performer/performances")
async def add_performer_performance(payload: AddPerformanceRequest):
    if not feature_enabled("performer_edits_enabled"):
        raise HTTPException(status_code=400, detail="Performer self-service editing is currently locked for this event.")

    clean_name = payload.performer_name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Performer name is required.")

    all_perfs = db_service.get_all_performances()
    try:
        clean_name = NamePrivacy(all_perfs).resolve_name(clean_name)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    user_perfs = [
        p for p in all_perfs
        if clean_name.lower() == (p.get("performer_name") or "").strip().lower()
        or clean_name.lower() in [n.lower() for n in split_signer_names(p.get("partner_name"))]
    ]
    if not user_perfs:
        raise HTTPException(status_code=404, detail=f"No registration found for {clean_name}. Please sign up first.")

    perf_type = payload.performance_type.strip().capitalize() if payload.performance_type else "Solo"
    allow_duets = feature_enabled("allow_duets")
    if not allow_duets and perf_type != "Solo":
        raise HTTPException(status_code=400, detail="Duet and group performances are currently disabled for this event (Solo only).")

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
    if partner_name:
        try:
            partner_name = " & ".join(NamePrivacy(all_perfs).resolve_name(n) for n in split_signer_names(partner_name))
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
    if perf_type == "Duet":
        if not partner_name:
            raise HTTPException(status_code=400, detail="Partner name is required for Duet performance.")
        registered_names = {
            (p.get("performer_name") or "").strip().lower()
            for p in all_perfs
            if p.get("performer_name")
        }
        registered_names.update(name.casefold() for p in all_perfs for name in split_signer_names(p.get("partner_name")))
        if partner_name.lower() not in registered_names:
            if not partner_phone or not validate_phone(partner_phone):
                raise HTTPException(
                    status_code=400,
                    detail=f"A valid 10-digit phone number is required for partner '{partner_name}'."
                )

    # Prefer the participant's own record or primary act. Never copy another
    # person's demographics when the selected performer was only a partner.
    primary = next((p for p in user_perfs if (p.get("performer_name") or "").strip().casefold() == clean_name.casefold()), None)
    if primary:
        contact_info = primary.get("contact_info") or ""
        age_group = primary.get("age_group") or ""
        guardian_name = primary.get("guardian_name") or ""
        guardian_phone = primary.get("guardian_phone") or ""
    else:
        # Legacy participant rows may have been backfilled with the primary
        # singer's guardian. Use only explicitly partner-specific information.
        ref_perf = next((p for p in user_perfs if len(split_signer_names(p.get("partner_name"))) == 1), None)
        if not ref_perf:
            raise HTTPException(status_code=400, detail="Your individual details are missing. Please ask an organizer to update them.")
        contact_info = ref_perf.get("partner_phone") or ""
        age_group = ref_perf.get("partner_age_group") or ""
        guardian_name = ref_perf.get("partner_guardian_name") or ""
        guardian_phone = ref_perf.get("partner_guardian_phone") or ""
    if not age_group:
        raise HTTPException(status_code=400, detail="Your age group is missing. Please ask an organizer to update your details.")
    if age_group.strip().casefold() == "junior" and (not guardian_name or not guardian_phone):
        raise HTTPException(status_code=400, detail="Your guardian details are missing. Please ask an organizer to update them.")

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
        public_first_name_only=any(
            p.get("public_first_name_only") and (p.get("performer_name") or "").strip().casefold() == clean_name.casefold()
            for p in user_perfs
        ),
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
    if not feature_enabled("performer_edits_enabled"):
        raise HTTPException(status_code=400, detail="Performer self-service editing is currently locked for this event.")

    old_name = payload.old_name.strip()
    new_name = payload.new_name.strip()
    if not old_name or not new_name:
        raise HTTPException(status_code=400, detail="Both old name and new name are required.")
    old_names = NamePrivacy(db_service.get_all_performances())
    try:
        old_name = old_names.resolve_name(old_name)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    
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

        names = NamePrivacy(db_service.get_all_performances())
        return {
            "status": "success",
            "old_name": old_names.name(old_name),
            "new_name": names.name(new_name),
            "message": "Name changed successfully."
        }
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
