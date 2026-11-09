import json
import logging
import os
from urllib.parse import urlsplit
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from app.config import settings
from app.exceptions import PerformanceNotFoundError
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.services import presets as preset_lib
from app.utils.age_groups import normalize_age_groups

logger = logging.getLogger("admin-service")


class AdminService:
    """Encapsulates admin business logic including settings, presets, participant cascades, and analytics."""

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
            "header_brand_title": getattr(settings.event, "header_brand_title", "") or "Event",
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
            "doors_open_time": settings.event.doors_open_time or "",
            "post_event_link_url": settings.event.post_event_link_url or "",
            "event_passcode": getattr(settings.event, "event_passcode", "") or "",
            "payment_url": settings.event.payment_url or "",
            "external_link_url": settings.event.external_link_url or "",
            "signup_enabled": getattr(settings.signup, "signup_enabled", True),
            "food_signup_enabled": getattr(settings.signup, "food_signup_enabled", True),
            "track_upload_enabled": getattr(settings.signup, "track_upload_enabled", True),
            "allow_duets": getattr(settings.signup, "allow_duets", True),
            "performer_edits_enabled": getattr(settings.signup, "performer_edits_enabled", True),
            "edit_verification_enabled": getattr(settings.signup, "edit_verification_enabled", False),
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
            "allowed_media": ["audio", "video"],
            "setup_completed": False,
            "wizard_step": 1,
            "wizard_draft": {"preset": "musical_night", "basics": {}, "food": "", "rules": {}},
            "active_preset": "",
            "stage_performances_enabled": getattr(settings.signup, "stage_performances_enabled", True),
            "console_enabled": getattr(settings.signup, "console_enabled", True),
            "shorten_junior_names": True,
            "announcement": "",
            "max_audio_upload_mb": 200,
            "max_video_upload_mb": 500,
        }

        merged = {**defaults, **result}
        merged["active_event_id"] = settings.event.id
        merged["age_groups"] = normalize_age_groups(merged.get("age_groups"), defaults["age_groups"])
        return merged

    def list_presets(self) -> List[Dict[str, Any]]:
        """Preset catalog with a live preview of what each one would change right now."""
        current = self.get_settings()
        return [
            {
                "id": p["id"], "name": p["name"], "icon": p["icon"], "accent": p["accent"],
                "tagline": p["tagline"], "changes": preset_lib.diff_against(p["id"], current),
            }
            for p in preset_lib.PRESET_CATALOG
        ]

    def apply_preset(self, preset_name: str, expected_event_id: Optional[str] = None) -> Dict[str, Any]:
        """Applies a named preset: feature flags plus sign-up rules. Never deletes data."""
        preset = preset_name.strip().lower()
        if preset not in preset_lib.PRESETS_BY_ID:
            raise ValueError(f"Unknown preset '{preset}'. Valid: {list(preset_lib.PRESETS_BY_ID.keys())}")

        from app.services.event_service import event_service
        with event_service._lock:
            self._check_expected_event(expected_event_id)
            return self._apply_preset_locked(preset)

    def _apply_preset_locked(self, preset: str) -> Dict[str, Any]:
        before = self.get_settings()
        changes = preset_lib.diff_against(preset, before)
        values = self._validate_settings(preset_lib.preset_settings(preset))
        for k, v in values.items():
            db_service.set_app_setting(k, v)
        db_service.set_app_setting("active_preset", preset)

        backup_service.trigger_backup()
        db_service.log_activity(
            action_type="preset_applied",
            performer_name="Admin",
            summary=f"Applied event preset '{preset}' ({len(changes)} changes)",
            details=json.dumps(changes),
            source="admin"
        )
        return {"status": "success", "preset": preset, "applied_flags": values, "changes": changes}

    @staticmethod
    def _check_expected_event(expected_event_id: Optional[str]) -> None:
        if expected_event_id is not None and expected_event_id != settings.event.id:
            from fastapi import HTTPException
            raise HTTPException(status_code=409, detail="The active event changed. Reload before saving.")

    def update_settings(self, items: Dict[str, Any], expected_event_id: Optional[str] = None) -> int:
        """Validates and updates custom settings; wizard state is committed as one event-scoped transaction."""
        if "header_brand_title" in items and isinstance(items["header_brand_title"], str) and len(items["header_brand_title"].strip()) > 35:
            raise ValueError("Header Brand Title cannot exceed 35 characters.")
        if "header_brand_subtitle" in items and isinstance(items["header_brand_subtitle"], str) and len(items["header_brand_subtitle"].strip()) > 45:
            raise ValueError("Header Brand Subtitle cannot exceed 45 characters.")
        if "event_name" in items and isinstance(items["event_name"], str) and len(items["event_name"].strip()) > 60:
            raise ValueError("Event Name cannot exceed 60 characters.")
        if "event_subtitle" in items and isinstance(items["event_subtitle"], str) and len(items["event_subtitle"].strip()) > 80:
            raise ValueError("Event Subtitle cannot exceed 80 characters.")

        cleaned = self._validate_settings(items)
        has_wizard_progress = bool({"wizard_step", "wizard_draft"} & set(cleaned))
        if has_wizard_progress and not expected_event_id:
            raise ValueError("Wizard progress saves require expected_event_id.")
        if cleaned.get("setup_completed") is True:
            cleaned["wizard_step"] = 1
            cleaned["wizard_draft"] = {"preset": "musical_night", "basics": {}, "food": "", "rules": {}}

        from app.services.event_service import event_service
        if has_wizard_progress or expected_event_id is not None or cleaned.get("setup_completed") is True:
            with event_service._lock:
                self._check_expected_event(expected_event_id)
                self._write_settings_transaction(cleaned)
        else:
            for key, value in cleaned.items():
                db_service.set_app_setting(key, value)
        backup_service.trigger_backup()
        return len(cleaned)

    @staticmethod
    def _write_settings_transaction(values: Dict[str, Any]) -> None:
        conn = db_service._get_connection()
        try:
            conn.execute("BEGIN")
            for key, value in values.items():
                conn.execute("""INSERT INTO app_settings (key, value, updated_at)
                    VALUES (?, ?, datetime('now'))
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')""",
                    (key, json.dumps(value)))
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    BOOL_SETTINGS = {
        "setup_completed",
        "stage_performances_enabled", "signup_enabled", "food_signup_enabled", "track_upload_enabled",
        "allow_duets", "performer_edits_enabled", "edit_verification_enabled", "live_display_enabled", "dashboard_enabled",
        "console_enabled", "payment_enabled", "backup_enabled", "shorten_junior_names",
    }
    INT_SETTINGS = {
        "max_performances_per_participant": (1, 20), "max_solo_per_participant": (0, 20),
        "max_audio_upload_mb": (1, 2000), "max_video_upload_mb": (1, 5000),
        "wizard_step": (1, 5),
    }
    LIST_SETTINGS = {"performance_types", "console_extra_columns", "allowed_media"}
    AGE_GROUP_DESCRIPTION_LIMIT = 200
    GALLERY_ORDER_LIMIT = 50
    STR_SETTINGS = {
        "header_brand_title", "header_brand_subtitle", "event_name", "event_subtitle", "event_date_time",
        "event_start_time", "event_venue", "event_time_range", "general_notes", "hero_tag_primary",
        "hero_tag_status", "event_poster_url", "payment_url", "external_link_url", "food_serving_note",
        "doors_open_time", "post_event_link_url", "event_passcode",
        "entry_id_prefix", "live_order_by", "event_id", "venue", "time_range", "active_preset", "announcement",
    }
    WIZARD_BASICS_LIMITS = {
        "event_name": 60, "event_subtitle": 80, "event_start_time": 100,
        "event_time_range": 100, "event_venue": 200,
    }
    WIZARD_RULE_KEYS = {"max_performances_per_participant", "max_solo_per_participant", "allowed_media"}
    WIZARD_DRAFT_LIMIT = 20_000

    def _validate_settings(self, items: Dict[str, Any]) -> Dict[str, Any]:
        """Rejects unknown keys and wrong types so a bad value can never break signup or live pages."""
        if not isinstance(items, dict):
            raise ValueError("Settings payload must be an object.")
        cleaned: Dict[str, Any] = {}
        items = {("external_link_url" if k == "signup_sheet_url" else k): v for k, v in items.items()}  # pre-rename alias
        for k, v in items.items():
            if k == "wizard_draft":
                if not isinstance(v, dict) or set(v) != {"preset", "basics", "food", "rules"}:
                    raise ValueError("Setting 'wizard_draft' must contain preset, basics, food, and rules.")
                if (not isinstance(v["preset"], str) or v["preset"] not in preset_lib.PRESETS_BY_ID
                        or v["preset"] in ("freeze", "rehearsal")):
                    raise ValueError("Wizard draft preset is invalid.")
                basics = v["basics"]
                if not isinstance(basics, dict) or set(basics) - set(self.WIZARD_BASICS_LIMITS):
                    raise ValueError("Wizard draft basics contains an unknown field.")
                clean_basics = {}
                for key, value in basics.items():
                    if not isinstance(value, str) or len(value) > self.WIZARD_BASICS_LIMITS[key]:
                        raise ValueError(f"Wizard draft '{key}' must be text within its length limit.")
                    clean_basics[key] = value
                food = v["food"]
                if not isinstance(food, str) or len(food) > self.WIZARD_DRAFT_LIMIT:
                    raise ValueError(f"Wizard draft food must be text (max {self.WIZARD_DRAFT_LIMIT} characters).")
                rules = v["rules"]
                if not isinstance(rules, dict) or set(rules) - self.WIZARD_RULE_KEYS:
                    raise ValueError("Wizard draft rules contains an unknown field.")
                clean_rules = self._validate_settings(rules)
                if ("max_performances_per_participant" in clean_rules and "max_solo_per_participant" in clean_rules
                        and clean_rules["max_solo_per_participant"] > clean_rules["max_performances_per_participant"]):
                    raise ValueError("Wizard draft solo limit cannot exceed the total performance limit.")
                v = {"preset": v["preset"], "basics": clean_basics, "food": food, "rules": clean_rules}
            elif k == "gallery_order":
                if (not isinstance(v, list) or len(v) > self.GALLERY_ORDER_LIMIT
                        or not all(isinstance(name, str) and name and name == os.path.basename(name)
                                   for name in v)):
                    raise ValueError(f"Setting 'gallery_order' must be a list of up to {self.GALLERY_ORDER_LIMIT} filenames.")
            elif k == "age_groups":
                if not isinstance(v, list) or len(v) > 50:
                    raise ValueError("Setting 'age_groups' must be a list (max 50 entries).")
                normalized = []
                seen_names = set()
                for ag in v:
                    if not isinstance(ag, dict) or not isinstance(ag.get("name"), str) or not ag["name"].strip():
                        raise ValueError("Each age group needs a name.")
                    name = ag["name"].strip()
                    folded_name = name.casefold()
                    if folded_name in seen_names:
                        raise ValueError("Age group names must be unique, ignoring capitalization.")
                    seen_names.add(folded_name)
                    description = ag.get("description", "")
                    if not isinstance(description, str):
                        raise ValueError("Age group 'description' must be text.")
                    description = description.strip()
                    if len(description) > self.AGE_GROUP_DESCRIPTION_LIMIT:
                        raise ValueError(f"Age group descriptions cannot exceed {self.AGE_GROUP_DESCRIPTION_LIMIT} characters.")
                    requires_guardian = ag.get("requires_guardian", False)
                    if not isinstance(requires_guardian, bool):
                        raise ValueError("Age group 'requires_guardian' must be true or false.")
                    normalized.append({
                        "name": name,
                        "description": description,
                        "requires_guardian": requires_guardian,
                    })
                v = normalized
            elif k in self.BOOL_SETTINGS:
                if isinstance(v, str) and v.strip().lower() in ("true", "false"):
                    v = v.strip().lower() == "true"
                if not isinstance(v, bool):
                    raise ValueError(f"Setting '{k}' must be true or false.")
            elif k in self.INT_SETTINGS:
                lo, hi = self.INT_SETTINGS[k]
                try:
                    if isinstance(v, bool):
                        raise ValueError
                    v = int(str(v).strip())
                except ValueError:
                    raise ValueError(f"Setting '{k}' must be a whole number.")
                if not lo <= v <= hi:
                    raise ValueError(f"Setting '{k}' must be between {lo} and {hi}.")
            elif k in self.LIST_SETTINGS:
                if not isinstance(v, list) or len(v) > 50:
                    raise ValueError(f"Setting '{k}' must be a list (max 50 entries).")
                if not all(isinstance(x, str) and x.strip() for x in v):
                    raise ValueError(f"Setting '{k}' must be a list of non-empty text values.")
                elif k == "allowed_media" and (not v or any(x not in ("audio", "video") for x in v)):
                    raise ValueError("Allowed track types must include audio, video, or both.")
                elif k == "performance_types" and not v:
                    raise ValueError("At least one performance type is required.")
            elif k in self.STR_SETTINGS:
                if v is None:
                    v = ""
                if not isinstance(v, str):
                    raise ValueError(f"Setting '{k}' must be text.")
                if k == "announcement":
                    v = v.strip()
                    if len(v) > 140:
                        raise ValueError("Announcement cannot exceed 140 characters.")
                if k == "doors_open_time":
                    v = v.strip()
                    if len(v) > 100:
                        raise ValueError("Doors open time cannot exceed 100 characters.")
                if k == "event_passcode":
                    v = v.strip()
                    if len(v) > 100:
                        raise ValueError("Event passcode cannot exceed 100 characters.")
                if k == "post_event_link_url":
                    v = v.strip()
                    if len(v) > 2048:
                        raise ValueError("Post-event link URL cannot exceed 2048 characters.")
                    if v:
                        if any(char.isspace() or ord(char) < 32 for char in v):
                            raise ValueError("Post-event link must be a valid HTTP or HTTPS URL.")
                        try:
                            parts = urlsplit(v)
                            valid = (parts.scheme.lower() in ("http", "https") and bool(parts.hostname)
                                     and parts.username is None and parts.password is None)
                            _ = parts.port
                        except ValueError:
                            valid = False
                        if not valid:
                            raise ValueError("Post-event link must be a valid HTTP or HTTPS URL.")
                if len(v) > 5000:
                    raise ValueError(f"Setting '{k}' is too long.")
            else:
                raise ValueError(f"Unknown setting '{k}'.")
            cleaned[k] = v
        return cleaned

    # ------------------------------------------------------------------ potluck catalog helpers
    FOOD_TEMPLATES = {
        "indian": "Appetizers:\nVeg Appetizer x3\nNon-Veg Appetizer x3\nRice & Main:\nVeg Biryani\nChicken Biryani\nJeera Rice\nNoodles\nCurries:\nPaneer Curry x2\nChicken Curry x2\nDal\nBreads & Sides:\nNaan / Roti x2\nSalad / Raita\nDesserts:\nGulab Jamun\nPayasam\nCake / Pastries",
        "bbq": "Mains:\nBurgers\nHot Dogs\nGrilled Chicken\nVeggie Skewers\nSides:\nPotato Salad\nCole Slaw\nCorn on the Cob\nBaked Beans\nChips & Dip\nDesserts:\nPie\nBrownies\nWatermelon\nDrinks & Extras:\nLemonade\nIce x2\nPlates & Cutlery",
        "thanksgiving": "Mains:\nTurkey\nHam\nVegetarian Main\nSides:\nMashed Potatoes\nStuffing\nGreen Beans\nCranberry Sauce\nDinner Rolls x2\nSalad\nDesserts:\nPumpkin Pie\nApple Pie\nDrinks:\nCider\nSparkling Water",
        "simple": "Mains x4\nSides x4\nDesserts x3\nDrinks x2",
    }

    @staticmethod
    def parse_food_lines(text: str, default_group: str = "Potluck") -> List[Dict[str, str]]:
        """Parses a pasted list into items.

        ``Group:`` starts a group; ``Item x3`` (or ``Item (3)``) creates Item 1, Item 2, Item 3.
        """
        import re
        items: List[Dict[str, str]] = []
        group = default_group
        for raw in (text or "").splitlines():
            line = raw.strip().lstrip("-*• ").strip()
            if not line:
                continue
            if line.endswith(":") and len(line) > 1:
                group = line[:-1].strip() or default_group
                continue
            m = re.match(r"^(.*?)\s*(?:[x×]\s*(\d{1,2})|\((\d{1,2})\))\s*$", line, flags=re.IGNORECASE)
            name, count = (m.group(1).strip(), int(m.group(2) or m.group(3))) if m and m.group(1).strip() else (line, 1)
            count = max(1, min(count, 30))
            if count == 1:
                items.append({"group": group, "name": name})
            else:
                items.extend({"group": group, "name": f"{name} {i}"} for i in range(1, count + 1))
        return items

    def bulk_add_food(self, text: str, default_group: str = "Potluck") -> Dict[str, Any]:
        """Adds many potluck items at once (skips names that already exist). Never touches existing signups."""
        parsed = self.parse_food_lines(text, default_group)
        if not parsed:
            raise ValueError("Paste at least one item, one per line.")
        if len(parsed) > 300:
            raise ValueError("Too many items at once (max 300).")
        groups = {g["name"].strip().lower(): g["group_id"] for g in db_service.get_food_groups()}
        existing = {i["name"].strip().lower() for i in db_service.get_all_food_items_with_signups()}
        added, skipped, new_groups = 0, [], 0
        for it in parsed:
            key = it["group"].strip().lower()
            if key not in groups:
                groups[key] = db_service.add_food_group(it["group"].strip())
                new_groups += 1
            if it["name"].strip().lower() in existing:
                skipped.append(it["name"])
                continue
            db_service.add_food_item(name=it["name"], group_id=groups[key])
            existing.add(it["name"].strip().lower())
            added += 1
        backup_service.trigger_backup()
        db_service.log_activity(action_type="admin_edit", performer_name="Admin",
                                summary=f"Bulk-added {added} potluck item(s) in {len(set(i['group'] for i in parsed))} group(s)",
                                details=json.dumps({"skipped": skipped}), source="admin")
        return {"status": "success", "added": added, "skipped": skipped, "groups_created": new_groups}

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
