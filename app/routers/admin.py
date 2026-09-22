import re
import json
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Request

from app.config import settings
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.routers.auth import verify_admin_pin
from app.schemas import AdminParticipantUpdateRequest

logger = logging.getLogger("admin-router")

router = APIRouter(tags=["admin"])


@router.get("/api/admin/settings")
async def get_admin_settings(_authorized: bool = Depends(verify_admin_pin)):
    all_settings = db_service.get_all_app_settings()
    # Unpack JSON values if needed
    result = {}
    for k, v in all_settings.items():
        try:
            result[k] = json.loads(v)
        except Exception:
            result[k] = v

    defaults = {
        "header_brand_title": getattr(settings.event, "header_brand_title", "EMA Paattukoottam"),
        "header_brand_subtitle": getattr(settings.event, "header_brand_subtitle", "Musical Night"),
        "event_name": settings.event.name,
        "event_subtitle": settings.event.subtitle,
        "event_date_time": settings.event.start_time,
        "event_start_time": settings.event.start_time,
        "event_venue": settings.event.venue,
        "event_time_range": settings.event.time_range,
        "general_notes": settings.event.general_notes or "",
        "hero_tag_primary": getattr(settings.event, "hero_tag_primary", "Musical Evening"),
        "hero_tag_status": getattr(settings.event, "hero_tag_status", "Stage Ready"),
        "event_poster_url": settings.event.poster_url,
        "payment_url": settings.event.payment_url or "",
        "signup_sheet_url": settings.event.signup_sheet_url or "",
        "signup_enabled": getattr(settings.signup, "signup_enabled", True),
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

    # Merge defaults with stored values (stored values take precedence)
    merged = {**defaults, **result}
    return merged


@router.put("/api/admin/settings")
async def update_admin_settings(request: Request, _authorized: bool = Depends(verify_admin_pin)):
    payload = await request.json()
    items = payload.get("settings", payload) if isinstance(payload, dict) else {}

    if "header_brand_title" in items and isinstance(items["header_brand_title"], str) and len(items["header_brand_title"].strip()) > 35:
        raise HTTPException(status_code=400, detail="Header Brand Title cannot exceed 35 characters.")
    if "header_brand_subtitle" in items and isinstance(items["header_brand_subtitle"], str) and len(items["header_brand_subtitle"].strip()) > 45:
        raise HTTPException(status_code=400, detail="Header Brand Subtitle cannot exceed 45 characters.")
    if "event_name" in items and isinstance(items["event_name"], str) and len(items["event_name"].strip()) > 60:
        raise HTTPException(status_code=400, detail="Event Name cannot exceed 60 characters.")
    if "event_subtitle" in items and isinstance(items["event_subtitle"], str) and len(items["event_subtitle"].strip()) > 80:
        raise HTTPException(status_code=400, detail="Event Subtitle cannot exceed 80 characters.")

    for k, v in items.items():
        db_service.set_app_setting(k, v)
    backup_service.trigger_backup()
    return {"status": "success", "updated_count": len(items)}


@router.get("/api/admin/summary")
async def get_admin_summary(_authorized: bool = Depends(verify_admin_pin)):
    perfs = db_service.get_all_performances()

    participants_map = {}
    junior_acts = 0
    senior_acts = 0
    solo = 0
    duet = 0
    group = 0

    for p in perfs:
        ptype = (p.get("performance_type") or "").lower()
        if "solo" in ptype:
            solo += 1
        elif "duet" in ptype:
            duet += 1
        elif "group" in ptype:
            group += 1

        is_junior_act = "junior" in (p.get("age_group") or "").lower() or any("junior" in str(t).lower() for t in p.get("extra_tags", []))
        if is_junior_act:
            junior_acts += 1
        else:
            senior_acts += 1

        norm_name = (p.get("performer_name") or "").strip()
        if norm_name:
            k = norm_name.lower()
            if k not in participants_map:
                participants_map[k] = {
                    "name": norm_name,
                    "age_group": p.get("age_group") or "Senior"
                }
            elif "junior" in (p.get("age_group") or "").lower():
                participants_map[k]["age_group"] = p.get("age_group")

        raw_partner = (p.get("partner_name") or "").strip()
        if raw_partner:
            parts = [s.strip() for s in re.split(r'[&,]|(?:\band\b)', raw_partner, flags=re.IGNORECASE) if s.strip()]
            for p_name in parts:
                if norm_name and p_name.lower() == norm_name.lower():
                    continue
                pk = p_name.lower()
                partner_age = p.get("partner_age_group") or p.get("age_group") or "Senior"
                if pk not in participants_map:
                    participants_map[pk] = {
                        "name": p_name,
                        "age_group": partner_age
                    }
                elif "junior" in partner_age.lower():
                    participants_map[pk]["age_group"] = partner_age

    total_participants = len(participants_map)
    juniors = sum(1 for p in participants_map.values() if "junior" in (p.get("age_group") or "").lower())
    seniors = total_participants - juniors

    food_items = db_service.get_all_food_items_with_signups()
    food_taken = sum(1 for f in food_items if f.get("is_taken"))

    return {
        "total_participants": total_participants,
        "total_performances": len(perfs),
        "juniors": juniors,
        "seniors": seniors,
        "junior_acts": junior_acts,
        "senior_acts": senior_acts,
        "solo": solo,
        "duet": duet,
        "group": group,
        "food_taken": food_taken,
        "food_total": len(food_items)
    }


@router.get("/api/admin/backup-status")
async def get_backup_status_endpoint(_authorized: bool = Depends(verify_admin_pin)):
    return backup_service.get_backup_status()


@router.post("/api/admin/backup-now")
async def trigger_immediate_backup(_authorized: bool = Depends(verify_admin_pin)):
    return await backup_service.backup_now()


@router.get("/api/admin/participants")
async def list_admin_participants(_authorized: bool = Depends(verify_admin_pin)):
    """Returns all performances/participants directly from SQLite with food signup details."""
    perfs = db_service.get_all_performances()
    for p in perfs:
        name = (p.get("performer_name") or "").strip()
        guardian = (p.get("guardian_name") or "").strip()
        partner = (p.get("partner_name") or "").strip()

        # Primary performer food lookup
        food = db_service.get_food_signup_for_signer(name)
        if not food and guardian:
            food = db_service.get_food_signup_for_signer(guardian)
        p["food_signup"] = food

        # Also resolve food signup for duet partner
        partner_food = None
        if partner:
            partner_food = db_service.get_food_signup_for_signer(partner)
            if not partner_food and guardian:
                partner_food = db_service.get_food_signup_for_signer(guardian)
        p["partner_food_signup"] = partner_food
    return perfs


@router.put("/api/admin/participants/{entry_id}")
async def update_admin_participant(entry_id: str, payload: AdminParticipantUpdateRequest, _authorized: bool = Depends(verify_admin_pin)):
    """Updates participant details directly in SQLite and triggers debounced backup."""
    old_perf = db_service.get_performance(entry_id)
    if not old_perf:
        raise HTTPException(status_code=404, detail="Participant/performance entry not found.")

    old_performer_name = (old_perf.get("performer_name") or "").strip()
    new_performer_name = (payload.performer_name or "").strip()

    # Cascade rename across performances and food signups if performer name changed
    if new_performer_name and new_performer_name.lower() != old_performer_name.lower():
        try:
            db_service.rename_performer(old_performer_name, new_performer_name)
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex))

    # Cascade rename for partner_name if partner name changed
    old_partner_name = (old_perf.get("partner_name") or "").strip()
    new_partner_name = (payload.partner_name or "").strip()
    if old_partner_name and new_partner_name and new_partner_name.lower() != old_partner_name.lower():
        try:
            db_service.rename_performer(old_partner_name, new_partner_name)
        except ValueError:
            pass

    # Link/unlink food item if specified
    if payload.food_item_id is not None:
        effective_name = new_performer_name or old_performer_name
        phone = payload.contact_info or payload.guardian_phone or old_perf.get("contact_info") or old_perf.get("guardian_phone")
        db_service.link_participant_to_food_item(effective_name, payload.food_item_id, phone)

        # If duet partner is part of the same junior family act, link them too
        effective_partner = (payload.partner_name or old_perf.get("partner_name") or "").strip()
        partner_age = (payload.partner_age_group or old_perf.get("partner_age_group") or payload.age_group or old_perf.get("age_group") or "").lower()
        has_guard = bool((payload.guardian_name or old_perf.get("guardian_name") or "").strip())
        if effective_partner and "junior" in partner_age and has_guard:
            partner_phone = payload.partner_phone or old_perf.get("partner_phone") or phone
            db_service.link_participant_to_food_item(effective_partner, payload.food_item_id, partner_phone)

    dump_dict = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    update_data = {k: v for k, v in dump_dict.items() if v is not None and k != "food_item_id"}
    if "phone" in update_data:
        legacy_phone = update_data.pop("phone")
        if "guardian_phone" not in update_data and legacy_phone:
            update_data["guardian_phone"] = legacy_phone
        if "contact_info" not in update_data and legacy_phone:
            update_data["contact_info"] = legacy_phone
    if update_data:
        success = db_service.update_performance_details(entry_id, **update_data)
        if not success:
            raise HTTPException(status_code=404, detail="Participant/performance entry not found.")
    else:
        now_iso = datetime.now(timezone.utc).isoformat()
        db_service.update_performance_field(entry_id, "last_updated", now_iso)
    backup_service.trigger_backup()

    perf_name = payload.performer_name or old_perf.get("performer_name", "Participant")
    db_service.log_activity(
        action_type="admin_edit",
        performer_name=perf_name,
        entry_id=entry_id,
        summary=f"Admin updated participant details for {entry_id} ({perf_name})",
        details=json.dumps({k: v for k, v in dump_dict.items() if v is not None}),
        source="admin"
    )

    return {"status": "success", "entry_id": entry_id, "message": "Participant updated successfully."}


@router.delete("/api/admin/participants/{entry_id}")
async def delete_admin_participant(entry_id: str, _authorized: bool = Depends(verify_admin_pin)):
    """Deletes a participant performance from SQLite and triggers backup."""
    target_perf = db_service.get_performance(entry_id) or {}
    success = db_service.delete_performance(entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Participant/performance entry not found.")
    backup_service.trigger_backup()

    db_service.log_activity(
        action_type="delete",
        performer_name=target_perf.get("performer_name", "Participant"),
        entry_id=entry_id,
        summary=f"Admin deleted performance {entry_id} ({target_perf.get('performer_name', '')} - '{target_perf.get('song_title', '')}')",
        details=json.dumps(dict(target_perf)),
        source="admin"
    )

    return {"status": "success", "entry_id": entry_id, "message": "Participant entry deleted."}


@router.get("/api/admin/activity-logs")
async def get_admin_activity_logs(
    days: Optional[int] = 7,
    limit: int = 200,
    search: str = "",
    action_type: str = "",
    _authorized: bool = Depends(verify_admin_pin)
):
    """Returns activity audit log entries with optional days, search, and action filters."""
    return db_service.get_activity_logs(
        days=days,
        limit=limit,
        search=search,
        action_type=action_type
    )
