import json
import logging
from typing import Dict, Any, List, Optional

from app.config import settings, get_setting
from app.exceptions import RegistrationError, PerformerLimitReachedError, FoodItemUnavailableError
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.schemas import SignupRequest, PerformanceUpdateRequest, validate_phone

logger = logging.getLogger("registration-service")


class RegistrationService:
    """Encapsulates participant signups, rules validation, and performance updates."""

    def get_signup_config(self) -> Dict[str, Any]:
        """Returns registration configuration, available food, and registered setlist for the public form."""
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
            "payment_url": get_setting("payment_url", settings.event.payment_url) if bool(get_setting("payment_enabled", getattr(settings.signup, "payment_enabled", True))) else "",
            "signup_enabled": bool(get_setting("signup_enabled", settings.signup.signup_enabled)),
            "food_signup_enabled": bool(get_setting("food_signup_enabled", settings.signup.food_signup_enabled)),
            "track_upload_enabled": bool(get_setting("track_upload_enabled", getattr(settings.signup, "track_upload_enabled", True))),
            "allow_duets": bool(get_setting("allow_duets", getattr(settings.signup, "allow_duets", True))),
            "performer_edits_enabled": bool(get_setting("performer_edits_enabled", getattr(settings.signup, "performer_edits_enabled", True))),
            "payment_enabled": bool(get_setting("payment_enabled", getattr(settings.signup, "payment_enabled", True))),
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

    def register_participant(self, payload: SignupRequest) -> Dict[str, Any]:
        """Executes full participant registration with validation and quota enforcement."""
        perf_signup_enabled = bool(get_setting("signup_enabled", getattr(settings.signup, "signup_enabled", True)))
        food_signup_enabled = bool(get_setting("food_signup_enabled", getattr(settings.signup, "food_signup_enabled", True)))

        if not perf_signup_enabled and not food_signup_enabled:
            raise RegistrationError(
                "Thanks for your interest, but the sign-ups for this event are currently closed. Please reach out to the organizers for more information."
            )

        clean_name = payload.performer_name.strip()
        if not clean_name:
            raise RegistrationError("Name is required.")

        reg_type = (payload.registration_type or "performer").strip().lower()
        is_food_only = (reg_type == "food_only") or (not payload.performances and payload.food_signup and payload.food_signup.item_id)
        contact_phone = (payload.contact_info or "").strip()

        # 1. Food-only attendee registration
        if is_food_only:
            if not food_signup_enabled:
                raise RegistrationError("Potluck food sign-up is currently disabled.")
            if not contact_phone or not validate_phone(contact_phone):
                raise RegistrationError("A valid 10-digit phone number is required for registration.")
            if not payload.food_signup or not payload.food_signup.item_id:
                raise RegistrationError("Please select an available potluck dish to complete attendee registration.")

            try:
                food_signup_id = db_service.claim_food_item(
                    item_id=payload.food_signup.item_id,
                    signer_name=clean_name,
                    dish_description=payload.food_signup.dish_description or "",
                    signer_phone=contact_phone
                )
            except ValueError as ex:
                raise FoodItemUnavailableError(str(ex))

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

        # 2. Stage performance validation
        if not perf_signup_enabled:
            raise RegistrationError(
                "Stage performance sign-ups for this event are currently closed. Please reach out to the organizers for more information."
            )

        if not payload.performances:
            raise RegistrationError("At least one performance is required.")

        allow_duets = bool(get_setting("allow_duets", getattr(settings.signup, "allow_duets", True)))
        if not allow_duets:
            for p in payload.performances:
                ptype = (p.performance_type or "").strip().lower()
                if ptype != "solo" or (p.partner_name and p.partner_name.strip()):
                    raise RegistrationError("Duet and group performances are currently disabled for this event (Solo only).")

        # Guardian validation
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
                raise RegistrationError(f"Guardian name is required for {payload.age_group} participants.")
            if not guardian_phone or not validate_phone(guardian_phone):
                raise RegistrationError(f"A valid 10-digit guardian phone number is required for {payload.age_group} participants.")
            if not contact_phone:
                contact_phone = guardian_phone
            elif not validate_phone(contact_phone):
                raise RegistrationError("A valid 10-digit phone number is required.")
        else:
            if not contact_phone or not validate_phone(contact_phone):
                raise RegistrationError("A valid 10-digit phone number is required.")

        # Quota limits
        existing_counts = db_service.count_performances_for_performer(clean_name)
        req_total = len(payload.performances)
        req_solo = sum(1 for p in payload.performances if "solo" in (p.performance_type or "").lower())

        max_perf = int(get_setting("max_performances_per_participant", settings.signup.max_performances_per_participant))
        if existing_counts["total"] + req_total > max_perf:
            raise PerformerLimitReachedError(
                f"Registration exceeds limit. Maximum allowed is {max_perf} performance(s) per participant (currently registered: {existing_counts['total']})."
            )

        max_solo = int(get_setting("max_solo_per_participant", settings.signup.max_solo_per_participant))
        if existing_counts["solo"] + req_solo > max_solo:
            raise PerformerLimitReachedError(
                f"Solo limit exceeded. Maximum allowed is {max_solo} solo performance per participant (currently registered: {existing_counts['solo']})."
            )

        # Duet partner validation
        all_perfs = db_service.get_all_performances()
        registered_names = {
            (p.get("performer_name") or "").strip().lower()
            for p in all_perfs
            if p.get("performer_name")
        }
        for p in payload.performances:
            ptype = (p.performance_type or "").strip().capitalize()
            p_name = p.partner_name.strip() if p.partner_name else ""
            p_phone = p.partner_phone.strip() if p.partner_phone else ""
            if ptype == "Duet":
                if not p_name:
                    raise RegistrationError("Partner name is required for Duet performance.")
                if p_name.lower() not in registered_names:
                    if not p_phone or not validate_phone(p_phone):
                        raise RegistrationError(
                            f"A valid 10-digit phone number is required for partner '{p_name}' since they are not registered."
                        )

        # 3. Create performances
        created_ids = []
        for p in payload.performances:
            ptype = (p.performance_type or "Solo").strip().capitalize()
            partner = p.partner_name.strip() if p.partner_name else None
            partner_ag = p.partner_age_group.strip() if p.partner_age_group else None
            partner_ph = p.partner_phone.strip() if p.partner_phone else ""
            song = p.song_title.strip() if p.song_title else ""
            movie = p.movie_name.strip() if p.movie_name else None
            notes = p.stage_notes.strip() if p.stage_notes else ""
            track_status = "Acoustic" if p.is_acoustic else "Pending"

            entry_id = db_service.create_performance(
                performer_name=clean_name,
                performance_type=ptype,
                partner_name=partner,
                partner_age_group=partner_ag,
                contact_info=contact_phone,
                partner_phone=partner_ph,
                song_title=song,
                movie_name=movie,
                age_group=payload.age_group,
                guardian_name=guardian_name if requires_guardian else "",
                guardian_phone=guardian_phone if requires_guardian else "",
                stage_notes=notes,
                track_status=track_status,
                created_via="signup_portal"
            )
            created_ids.append(entry_id)

        # 4. Handle food contribution if selected
        food_signup_id = None
        if food_signup_enabled and payload.food_signup and payload.food_signup.item_id:
            try:
                food_signup_id = db_service.claim_food_item(
                    item_id=payload.food_signup.item_id,
                    signer_name=clean_name,
                    dish_description=payload.food_signup.dish_description or "",
                    signer_phone=contact_phone
                )
            except ValueError as ex:
                logger.warning("Food claim warning during signup: %s", ex)

        backup_service.trigger_backup()

        # Audit log
        perf_descs = [f"{p.performance_type or 'Solo'}: '{p.song_title or 'Song TBD'}'" for p in payload.performances]
        summary_text = f"Registered {len(created_ids)} performance(s) ({', '.join(perf_descs)})"
        dump_dict = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        db_service.log_activity(
            action_type="signup",
            performer_name=clean_name,
            entry_id=",".join(created_ids),
            summary=summary_text,
            details=json.dumps(dump_dict),
            source="public_signup"
        )

        return {
            "status": "success",
            "performer_name": clean_name,
            "entry_ids": created_ids,
            "food_signup_id": food_signup_id,
            "message": "Registration completed successfully! Welcome to Paattukoottam."
        }


registration_service = RegistrationService()
