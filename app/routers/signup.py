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


@router.get("/api/signup/config")
async def get_signup_config():
    age_groups = get_setting("age_groups")
    if isinstance(age_groups, str):
        try:
            age_groups = json.loads(age_groups)
        except Exception:
            age_groups = []
    elif not age_groups:
        age_groups = [ag.model_dump() for ag in settings.signup.age_groups]

    perf_types = get_setting("performance_types")
    if isinstance(perf_types, str):
        try:
            perf_types = json.loads(perf_types)
        except Exception:
            perf_types = [p.strip() for p in perf_types.split(",") if p.strip()]
    elif not perf_types:
        perf_types = settings.signup.performance_types

    # Only show food groups that have items
    food_groups = db_service.get_food_groups()
    visible_groups = [g for g in food_groups if g.get("item_count", 0) > 0]
    all_items = db_service.get_all_food_items_with_signups()

    perfs = db_service.get_all_performances()
    registered_names = sorted(list({p["performer_name"] for p in perfs if p.get("performer_name")}))
    existing_songs = [
        {
            "song_title": (p.get("song_title") or "").strip(),
            "performer_name": (p.get("performer_name") or "").strip(),
            "partner_name": (p.get("partner_name") or "").strip(),
            "performance_type": p.get("performance_type", "Solo"),
            "entry_id": p.get("entry_id")
        }
        for p in perfs
        if p.get("song_title") and not p.get("is_song_name_missing")
    ]

    header_brand_title = get_setting("header_brand_title") or getattr(settings.event, "header_brand_title", "EMA Paattukoottam")
    header_brand_subtitle = get_setting("header_brand_subtitle") or getattr(settings.event, "header_brand_subtitle", "Musical Night")

    return {
        "header_brand_title": header_brand_title,
        "header_brand_subtitle": header_brand_subtitle,
        "event_name": get_setting("event_name", settings.event.name),
        "event_subtitle": get_setting("event_subtitle", settings.event.subtitle),
        "poster_url": get_setting("event_poster_url", settings.event.poster_url),
        "payment_url": get_setting("payment_url", settings.event.payment_url),
        "signup_enabled": bool(get_setting("signup_enabled", settings.signup.signup_enabled)),
        "food_signup_enabled": bool(get_setting("food_signup_enabled", settings.signup.food_signup_enabled)),
        "food_serving_note": get_setting("food_serving_note", settings.signup.food_serving_note),
        "max_performances_per_participant": int(get_setting("max_performances_per_participant", settings.signup.max_performances_per_participant)),
        "max_solo_per_participant": int(get_setting("max_solo_per_participant", settings.signup.max_solo_per_participant)),
        "performance_types": perf_types,
        "age_groups": age_groups,
        "food_groups": visible_groups,
        "food_items": all_items,
        "registered_performers": registered_names,
        "existing_songs": existing_songs
    }


@router.post("/api/signup")
async def register_participant(payload: SignupRequest):
    signup_enabled = bool(get_setting("signup_enabled", settings.signup.signup_enabled))
    if not signup_enabled:
        raise HTTPException(
            status_code=400,
            detail="Thanks for your interest, but the sign-ups for this event are currently closed. Please reach out to the organizers for more information."
        )

    clean_name = payload.performer_name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Name is required.")

    reg_type = (payload.registration_type or "performer").strip().lower()
    is_food_only = (reg_type == "food_only") or (not payload.performances and payload.food_signup and payload.food_signup.item_id)

    contact_phone = (payload.contact_info or "").strip()

    # Food-only attendee registration (bypasses song/stage requirements)
    if is_food_only:
        food_enabled = bool(get_setting("food_signup_enabled", settings.signup.food_signup_enabled))
        if not food_enabled:
            raise HTTPException(status_code=400, detail="Potluck food sign-up is currently disabled.")

        if not contact_phone or not validate_phone(contact_phone):
            raise HTTPException(status_code=400, detail="A valid 10-digit phone number is required for registration.")

        if not payload.food_signup or not payload.food_signup.item_id:
            raise HTTPException(status_code=400, detail="Please select an available potluck dish to complete attendee registration.")

        try:
            food_signup_id = db_service.claim_food_item(
                item_id=payload.food_signup.item_id,
                signer_name=clean_name,
                dish_description=payload.food_signup.dish_description or "",
                signer_phone=contact_phone
            )
        except ValueError as ex:
            raise HTTPException(status_code=409, detail=str(ex))

        backup_service.trigger_backup()

        dish_text = f" ({payload.food_signup.dish_description})" if payload.food_signup and payload.food_signup.dish_description else ""
        item_name = payload.food_signup.item_id
        for it in db_service.get_all_food_items_with_signups():
            if it.get("item_id") == payload.food_signup.item_id:
                item_name = it.get("name", item_name)
                break
        db_service.log_activity(
            action_type="signup",
            performer_name=clean_name,
            summary=f"Signed up for potluck: {item_name}{dish_text}",
            details=json.dumps({"role": "attendee", "item": item_name, "dish": payload.food_signup.dish_description or "", "phone": contact_phone}),
            source="public_signup"
        )

        return {
            "status": "success",
            "registration_type": "food_only",
            "performer_name": clean_name,
            "entry_ids": [],
            "food_signup_id": food_signup_id,
            "message": f"Thank you, {clean_name}! Your potluck food contribution has been registered."
        }

    if not payload.performances:
        raise HTTPException(status_code=400, detail="At least one performance is required.")

    # Validate age group guardian rules
    age_groups = get_setting("age_groups")
    if isinstance(age_groups, str):
        try:
            age_groups = json.loads(age_groups)
        except Exception:
            age_groups = []
    elif not age_groups:
        age_groups = [ag.model_dump() for ag in settings.signup.age_groups]

    selected_group_config = next((ag for ag in age_groups if (ag.get("name") if isinstance(ag, dict) else ag.name) == payload.age_group), None)
    requires_guardian = False
    if selected_group_config:
        requires_guardian = bool(selected_group_config.get("requires_guardian") if isinstance(selected_group_config, dict) else selected_group_config.requires_guardian)

    guardian_phone = (payload.guardian_phone or "").strip()
    guardian_name = (payload.guardian_name or "").strip()

    if requires_guardian:
        if not guardian_name:
            raise HTTPException(status_code=400, detail=f"Guardian name is required for {payload.age_group} participants.")
        if not guardian_phone or not validate_phone(guardian_phone):
            raise HTTPException(status_code=400, detail=f"A valid 10-digit guardian phone number is required for {payload.age_group} participants.")
        if not contact_phone:
            contact_phone = guardian_phone
        elif not validate_phone(contact_phone):
            raise HTTPException(status_code=400, detail="A valid 10-digit phone number is required.")
    else:
        if not contact_phone or not validate_phone(contact_phone):
            raise HTTPException(status_code=400, detail="A valid 10-digit phone number is required for registration.")

    # Validate duet / custom partner requirements
    all_existing_perfs = db_service.get_all_performances()
    registered_names = {
        (p.get("performer_name") or "").strip().lower()
        for p in all_existing_perfs
        if p.get("performer_name")
    }

    for idx, p in enumerate(payload.performances):
        perf_type = (p.performance_type or "").strip().capitalize()
        if perf_type == "Duet":
            p_name = (p.partner_name or "").strip()
            if not p_name:
                raise HTTPException(status_code=400, detail=f"Partner name is required for Duet performance #{idx + 1}.")
            if p_name.lower() not in registered_names:
                p_phone = (p.partner_phone or "").strip()
                if not p_phone or not validate_phone(p_phone):
                    raise HTTPException(
                        status_code=400,
                        detail=f"A valid 10-digit phone number is required for partner '{p_name}'."
                    )
        elif perf_type == "Group":
            p_name = (p.partner_name or "").strip()
            p_phone = (p.partner_phone or "").strip()
            if p_name and p_name.lower() not in registered_names and p_phone:
                if not validate_phone(p_phone):
                    raise HTTPException(
                        status_code=400,
                        detail=f"A valid 10-digit phone number is required for partner '{p_name}'."
                    )

    # Validate constraints
    max_perfs = int(get_setting("max_performances_per_participant", settings.signup.max_performances_per_participant))
    max_solo = int(get_setting("max_solo_per_participant", settings.signup.max_solo_per_participant))

    existing_counts = db_service.count_performances_for_performer(clean_name)
    req_total = len(payload.performances)
    req_solo = sum(1 for p in payload.performances if "solo" in (p.performance_type or "").lower())

    if existing_counts["total"] + req_total > max_perfs:
        raise HTTPException(
            status_code=400,
            detail=f"Registration exceeds limit. Maximum allowed is {max_perfs} performance(s) per participant (currently registered: {existing_counts['total']})."
        )

    if existing_counts["solo"] + req_solo > max_solo:
        raise HTTPException(
            status_code=400,
            detail=f"Solo limit exceeded. Maximum allowed is {max_solo} solo performance per participant (currently registered: {existing_counts['solo']})."
        )

    # 1. Create performances
    entry_ids = []
    for p in payload.performances:
        initial_track_status = "Acoustic" if p.is_acoustic else "Pending"
        eid = db_service.create_performance(
            performer_name=clean_name,
            performance_type=p.performance_type,
            partner_name=p.partner_name,
            partner_age_group=p.partner_age_group,
            contact_info=contact_phone,
            partner_phone=p.partner_phone or "",
            song_title=p.song_title or "",
            movie_name=p.movie_name or "",
            age_group=payload.age_group,
            guardian_name=guardian_name if requires_guardian else "",
            guardian_phone=guardian_phone if requires_guardian else "",
            stage_notes=p.stage_notes or "",
            track_status=initial_track_status,
            created_via="signup"
        )
        entry_ids.append(eid)

    # 2. Claim food item if requested
    food_signup_id = None
    food_enabled = bool(get_setting("food_signup_enabled", settings.signup.food_signup_enabled))
    if payload.food_signup and payload.food_signup.item_id and food_enabled:
        try:
            food_signup_id = db_service.claim_food_item(
                item_id=payload.food_signup.item_id,
                signer_name=clean_name,
                dish_description=payload.food_signup.dish_description or "",
                signer_phone=contact_phone
            )
        except ValueError as ex:
            raise HTTPException(status_code=409, detail=str(ex))

    backup_service.trigger_backup()

    acts_summary = ", ".join([f"{p.performance_type}: {p.song_title or 'Song TBD'}" for p in payload.performances])
    db_service.log_activity(
        action_type="signup",
        performer_name=clean_name,
        summary=f"Registered as performer ({len(payload.performances)} act{'s' if len(payload.performances) > 1 else ''}: {acts_summary})",
        details=json.dumps({"entry_ids": entry_ids, "age_group": payload.age_group, "phone": contact_phone}),
        source="public_signup"
    )
    if food_signup_id and payload.food_signup:
        item_name = payload.food_signup.item_id
        for it in db_service.get_all_food_items_with_signups():
            if it.get("item_id") == payload.food_signup.item_id:
                item_name = it.get("name", item_name)
                break
        dish_text = f" ({payload.food_signup.dish_description})" if payload.food_signup.dish_description else ""
        db_service.log_activity(
            action_type="food_claim",
            performer_name=clean_name,
            summary=f"Claimed potluck dish: {item_name}{dish_text}",
            details=json.dumps({"item_name": item_name, "dish_description": payload.food_signup.dish_description or ""}),
            source="public_signup"
        )

    return {
        "status": "success",
        "performer_name": clean_name,
        "entry_ids": entry_ids,
        "food_signup_id": food_signup_id,
        "message": "Registration completed successfully! Welcome to Paattukoottam."
    }


@router.put("/api/signup/performance/{entry_id}")
async def update_performance_song(entry_id: str, payload: PerformanceUpdateRequest):
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
