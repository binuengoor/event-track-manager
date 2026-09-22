import json
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from app.config import settings
from app.exceptions import PerformanceNotFoundError
from app.services.db_service import db_service
from app.services.backup_service import backup_service

logger = logging.getLogger("admin-service")


class AdminService:
    """Encapsulates admin business logic including settings, presets, participant cascades, and analytics."""

    PRESETS = {
        "musical_night": {
            "stage_performances_enabled": True,
            "signup_enabled": True,
            "food_signup_enabled": True,
            "track_upload_enabled": True,
            "allow_duets": True,
            "performer_edits_enabled": True,
            "live_display_enabled": True,
            "dashboard_enabled": True,
            "console_enabled": True,
            "payment_enabled": True,
        },
        "acoustic": {
            "stage_performances_enabled": True,
            "signup_enabled": True,
            "food_signup_enabled": True,
            "track_upload_enabled": False,
            "allow_duets": True,
            "performer_edits_enabled": True,
            "live_display_enabled": True,
            "dashboard_enabled": True,
            "console_enabled": True,
            "payment_enabled": True,
        },
        "competition": {
            "stage_performances_enabled": True,
            "signup_enabled": True,
            "food_signup_enabled": False,
            "track_upload_enabled": True,
            "allow_duets": False,
            "performer_edits_enabled": True,
            "live_display_enabled": True,
            "dashboard_enabled": False,
            "console_enabled": True,
            "payment_enabled": True,
        },
        "potluck": {
            "stage_performances_enabled": False,
            "signup_enabled": False,
            "food_signup_enabled": True,
            "track_upload_enabled": False,
            "allow_duets": False,
            "performer_edits_enabled": False,
            "live_display_enabled": False,
            "dashboard_enabled": True,
            "console_enabled": False,
            "payment_enabled": False,
        },
        "freeze": {
            "stage_performances_enabled": True,
            "signup_enabled": False,
            "food_signup_enabled": False,
            "track_upload_enabled": False,
            "performer_edits_enabled": False,
            "console_enabled": True,
        }
    }

    def get_settings(self) -> Dict[str, Any]:
        """Retrieves administrative settings merged with application defaults."""
        all_settings = db_service.get_all_app_settings()
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
            "food_signup_enabled": getattr(settings.signup, "food_signup_enabled", True),
            "track_upload_enabled": getattr(settings.signup, "track_upload_enabled", True),
            "allow_duets": getattr(settings.signup, "allow_duets", True),
            "performer_edits_enabled": getattr(settings.signup, "performer_edits_enabled", True),
            "live_display_enabled": getattr(settings.signup, "live_display_enabled", True),
            "dashboard_enabled": getattr(settings.signup, "dashboard_enabled", True),
            "payment_enabled": getattr(settings.signup, "payment_enabled", True),
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

        return {**defaults, **result}

    def apply_preset(self, preset_name: str) -> Dict[str, Any]:
        """Applies a named configuration preset across feature flags."""
        preset = preset_name.strip().lower()
        if preset not in self.PRESETS:
            raise ValueError(f"Unknown preset '{preset}'. Valid: {list(self.PRESETS.keys())}")

        flags = self.PRESETS[preset]
        for k, v in flags.items():
            db_service.set_app_setting(k, v)

        backup_service.trigger_backup()
        db_service.log_activity(
            action_type="preset_applied",
            performer_name="Admin",
            summary=f"Applied event preset '{preset}' ({len(flags)} settings updated)",
            details=json.dumps(flags),
            source="admin"
        )
        return {"status": "success", "preset": preset, "applied_flags": flags}

    def update_settings(self, items: Dict[str, Any]) -> int:
        """Validates and updates custom settings."""
        if "header_brand_title" in items and isinstance(items["header_brand_title"], str) and len(items["header_brand_title"].strip()) > 35:
            raise ValueError("Header Brand Title cannot exceed 35 characters.")
        if "header_brand_subtitle" in items and isinstance(items["header_brand_subtitle"], str) and len(items["header_brand_subtitle"].strip()) > 45:
            raise ValueError("Header Brand Subtitle cannot exceed 45 characters.")
        if "event_name" in items and isinstance(items["event_name"], str) and len(items["event_name"].strip()) > 60:
            raise ValueError("Event Name cannot exceed 60 characters.")
        if "event_subtitle" in items and isinstance(items["event_subtitle"], str) and len(items["event_subtitle"].strip()) > 80:
            raise ValueError("Event Subtitle cannot exceed 80 characters.")

        for k, v in items.items():
            db_service.set_app_setting(k, v)

        backup_service.trigger_backup()
        return len(items)

    def get_summary(self) -> Dict[str, Any]:
        """Aggregates event performance, participant, and food registration metrics."""
        perfs = db_service.get_all_performances()

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

        participants = db_service.get_all_participants()
        total_participants = len(participants)
        juniors = sum(1 for p in participants if "junior" in (p.get("age_group") or "").lower())
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

    def list_participants_with_food(self) -> List[Dict[str, Any]]:
        """Returns performances enriched with food signups for performers and duet partners."""
        perfs = db_service.get_all_performances()
        food_map = db_service.get_all_food_signups_map()

        for p in perfs:
            name = (p.get("performer_name") or "").strip().lower()
            guardian = (p.get("guardian_name") or "").strip().lower()
            partner = (p.get("partner_name") or "").strip().lower()

            food = food_map.get(name)
            if not food and guardian:
                food = food_map.get(guardian)
            p["food_signup"] = food

            partner_food = None
            if partner:
                partner_food = food_map.get(partner)
                if not partner_food and guardian:
                    partner_food = food_map.get(guardian)
            p["partner_food_signup"] = partner_food

        return perfs

    def update_participant(self, entry_id: str, update_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handles administrative edits to a participant's entry, cascading renames and food bindings."""
        old_perf = db_service.get_performance(entry_id)
        if not old_perf:
            raise PerformanceNotFoundError("Participant/performance entry not found.")

        old_performer_name = (old_perf.get("performer_name") or "").strip()
        new_performer_name = (update_payload.get("performer_name") or "").strip()

        # Cascade rename across performances and food signups if performer name changed
        if new_performer_name and new_performer_name.lower() != old_performer_name.lower():
            db_service.rename_performer(old_performer_name, new_performer_name)

        # Cascade rename for partner_name if partner name changed
        old_partner_name = (old_perf.get("partner_name") or "").strip()
        new_partner_name = (update_payload.get("partner_name") or "").strip()
        if old_partner_name and new_partner_name and new_partner_name.lower() != old_partner_name.lower():
            try:
                db_service.rename_performer(old_partner_name, new_partner_name)
            except ValueError:
                pass

        # Link/unlink food item if specified
        if "food_item_id" in update_payload and update_payload["food_item_id"] is not None:
            effective_name = new_performer_name or old_performer_name
            phone = (
                update_payload.get("contact_info")
                or update_payload.get("guardian_phone")
                or old_perf.get("contact_info")
                or old_perf.get("guardian_phone")
            )
            db_service.link_participant_to_food_item(effective_name, update_payload["food_item_id"], phone)

            # If duet partner is part of the same junior family act, link them too
            effective_partner = (update_payload.get("partner_name") or old_perf.get("partner_name") or "").strip()
            partner_age = (
                update_payload.get("partner_age_group")
                or old_perf.get("partner_age_group")
                or update_payload.get("age_group")
                or old_perf.get("age_group")
                or ""
            ).lower()
            has_guard = bool((update_payload.get("guardian_name") or old_perf.get("guardian_name") or "").strip())
            if effective_partner and "junior" in partner_age and has_guard:
                partner_phone = update_payload.get("partner_phone") or old_perf.get("partner_phone") or phone
                db_service.link_participant_to_food_item(effective_partner, update_payload["food_item_id"], partner_phone)

        update_data = {k: v for k, v in update_payload.items() if v is not None and k != "food_item_id"}
        if "phone" in update_data:
            legacy_phone = update_data.pop("phone")
            if "guardian_phone" not in update_data and legacy_phone:
                update_data["guardian_phone"] = legacy_phone
            if "contact_info" not in update_data and legacy_phone:
                update_data["contact_info"] = legacy_phone

        if update_data:
            success = db_service.update_performance_details(entry_id, **update_data)
            if not success:
                raise PerformanceNotFoundError("Participant/performance entry not found.")
        else:
            now_iso = datetime.now(timezone.utc).isoformat()
            db_service.update_performance_field(entry_id, "last_updated", now_iso)

        backup_service.trigger_backup()

        perf_name = update_payload.get("performer_name") or old_perf.get("performer_name", "Participant")
        db_service.log_activity(
            action_type="admin_edit",
            performer_name=perf_name,
            entry_id=entry_id,
            summary=f"Admin updated participant details for {entry_id} ({perf_name})",
            details=json.dumps({k: v for k, v in update_payload.items() if v is not None}),
            source="admin"
        )

        return {"status": "success", "entry_id": entry_id, "message": "Participant updated successfully."}

    def delete_participant(self, entry_id: str) -> Dict[str, Any]:
        """Deletes a performance entry and logs activity."""
        target_perf = db_service.get_performance(entry_id) or {}
        success = db_service.delete_performance(entry_id)
        if not success:
            raise PerformanceNotFoundError("Participant/performance entry not found.")

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


admin_service = AdminService()
