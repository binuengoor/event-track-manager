import json
import logging
from typing import Dict, Any, List, Optional

from app.features import feature_enabled
from app.config import settings, get_setting
from app.exceptions import RegistrationError, PerformerLimitReachedError, FoodItemUnavailableError
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.privacy import NamePrivacy
from app.utils.name_matcher import split_signer_names
from app.utils.age_groups import normalize_age_groups
from app.schemas import SignupRequest, PerformanceUpdateRequest, validate_phone

logger = logging.getLogger("registration-service")


class RegistrationService:
    """Encapsulates participant signups, rules validation, and performance updates."""

    def get_signup_config(self) -> Dict[str, Any]:
        """Returns registration configuration, available food, and registered setlist for the public form."""
        age_groups = normalize_age_groups(get_setting("age_groups"), settings.signup.age_groups)

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
        privacy = NamePrivacy(perfs)
        registered_entries = []
        for p in perfs:
            people = ([p["performer_name"]] if p.get("performer_name") else []) + split_signer_names(p.get("partner_name"))
            registered_entries.extend({"name": privacy.name(person), "entry_id": p.get("entry_id")} for person in people)
        registered_names = sorted({entry["name"] for entry in registered_entries if entry["name"]})
        for item in all_items:
            registered_entries.extend({"name": privacy.name(person), "entry_id": None}
                                      for person in split_signer_names(item.get("signer_name")))
        existing_songs = [
            {
                "song_title": (p.get("song_title") or "").strip(),
                "performer_name": (privacy.name((p.get("performer_name") or "").strip()) or ""),
                "partner_name": (privacy.partners((p.get("partner_name") or "").strip()) or ""),
                "performance_type": p.get("performance_type", "Solo"),
                "entry_id": p.get("entry_id")
            }
            for p in perfs
            if p.get("song_title") and not p.get("is_song_name_missing")
        ]

        header_brand_title = get_setting("header_brand_title") or getattr(settings.event, "header_brand_title", "") or "Event"
        header_brand_subtitle = get_setting("header_brand_subtitle") or getattr(settings.event, "header_brand_subtitle", "Musical Night")

        return {
            "header_brand_title": header_brand_title,
            "header_brand_subtitle": header_brand_subtitle,
            "event_name": get_setting("event_name", settings.event.name),
            "event_subtitle": get_setting("event_subtitle", settings.event.subtitle),
            "poster_url": get_setting("event_poster_url", settings.event.poster_url),
            "payment_url": get_setting("payment_url", settings.event.payment_url) if feature_enabled("payment_enabled") else "",
            "signup_enabled": feature_enabled("signup_enabled"),
            "food_signup_enabled": feature_enabled("food_signup_enabled"),
            "track_upload_enabled": feature_enabled("track_upload_enabled"),
            "allow_duets": feature_enabled("allow_duets"),
            "performer_edits_enabled": feature_enabled("performer_edits_enabled"),
            "payment_enabled": feature_enabled("payment_enabled"),
            "food_serving_note": get_setting("food_serving_note", settings.signup.food_serving_note),
            "max_performances_per_participant": int(get_setting("max_performances_per_participant", settings.signup.max_performances_per_participant)),
            "max_solo_per_participant": int(get_setting("max_solo_per_participant", settings.signup.max_solo_per_participant)),
            "performance_types": perf_types,
            "age_groups": age_groups,
            "food_groups": visible_groups,
            "food_items": privacy.food_items(all_items),
            "registered_performers": registered_names,
            "registered_entries": registered_entries,
            "existing_songs": existing_songs
        }

    def register_participant(self, payload: SignupRequest) -> Dict[str, Any]:
        """Executes full participant registration with validation and quota enforcement."""
        perf_signup_enabled = feature_enabled("signup_enabled")
        food_signup_enabled = feature_enabled("food_signup_enabled")

        if not perf_signup_enabled and not food_signup_enabled:
            raise RegistrationError(
                "Thanks for your interest, but the sign-ups for this event are currently closed. Please reach out to the organizers for more information."
            )

        clean_name = payload.performer_name.strip()
        if not clean_name:
            raise RegistrationError("Name is required.")
        roster = db_service.get_all_performances()
        privacy = NamePrivacy(roster)
        try:
            clean_name = privacy.resolve_name(clean_name)
        except ValueError as exc:
            raise RegistrationError(str(exc))

        reg_type = (payload.registration_type or "performer").strip().lower()
        is_food_only = (reg_type in ("food_only", "food")) or (not payload.performances and payload.food_signup and payload.food_signup.item_id)
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
                "performer_name": privacy.name(clean_name),
                "entry_ids": [],
                "food_signup_id": food_signup_id,
                "message": "Thank you! Your potluck food contribution has been registered."
            }

        # 2. Stage performance validation
        if not perf_signup_enabled:
            raise RegistrationError(
                "Stage performance sign-ups for this event are currently closed. Please reach out to the organizers for more information."
            )

        if not payload.performances:
            raise RegistrationError("At least one performance is required.")

        age_groups = normalize_age_groups(get_setting("age_groups"), settings.signup.age_groups)
        age_groups_by_name = {group["name"].casefold(): group for group in age_groups}
        performer_age = (payload.age_group or "").strip()
        if performer_age:
            selected = age_groups_by_name.get(performer_age.casefold())
            if selected is None:
                raise RegistrationError(f"Unknown age group '{performer_age}'. Choose an age group from the current list.")
            payload.age_group = selected["name"]
        for performance in payload.performances:
            partner_age = (performance.partner_age_group or "").strip()
            if partner_age:
                selected = age_groups_by_name.get(partner_age.casefold())
                if selected is None:
                    raise RegistrationError(f"Unknown partner age group '{partner_age}'. Choose an age group from the current list.")
                performance.partner_age_group = selected["name"]

        # A shortened selection must not create a second person or change a
        # known junior into an adult to bypass guardian requirements.
        known_ages = set()
        for row in roster:
            if (row.get("performer_name") or "").strip().casefold() == clean_name.casefold() and row.get("age_group"):
                known_ages.add(row["age_group"].strip().casefold())
            elif any(name.casefold() == clean_name.casefold() for name in split_signer_names(row.get("partner_name"))) and row.get("partner_age_group"):
                known_ages.add(row["partner_age_group"].strip().casefold())
        if known_ages and (len(known_ages) > 1 or (payload.age_group or "").strip().casefold() not in known_ages):
            raise RegistrationError("The selected age group does not match the existing registration. Please contact an organizer.")

        allow_duets = feature_enabled("allow_duets")
        if not allow_duets:
            for p in payload.performances:
                ptype = (p.performance_type or "").strip().lower()
                if ptype != "solo" or (p.partner_name and p.partner_name.strip()):
                    raise RegistrationError("Duet and group performances are currently disabled for this event (Solo only).")

        # Guardian validation
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
        all_perfs = roster
        registered_names = {
            (p.get("performer_name") or "").strip().lower()
            for p in all_perfs
            if p.get("performer_name")
        }
        registered_names.update(name.casefold() for p in all_perfs for name in split_signer_names(p.get("partner_name")))
        registered_names.update(name.casefold() for item in db_service.get_all_food_items_with_signups()
                                for name in split_signer_names(item.get("signer_name")))
        partner_details = {}
        for p in payload.performances:
            ptype = (p.performance_type or "").strip().capitalize()
            p_name = p.partner_name.strip() if p.partner_name else ""
            if p_name:
                try:
                    people = split_signer_names(p_name)
                    p_name = " & ".join(privacy.resolve_name(person) for person in people)
                    p.partner_name = p_name
                except ValueError as exc:
                    raise RegistrationError(str(exc))
            p_phone = p.partner_phone.strip() if p.partner_phone else ""
            people = split_signer_names(p_name)
            if p.partner_same_person is False and any(person.casefold() in registered_names for person in people):
                raise RegistrationError("That name matches an existing registration. Enter a distinct full name or contact an organizer.")
            if p.partner_same_person is True and (not people or any(person.casefold() not in registered_names for person in people)):
                raise RegistrationError("The selected existing partner could not be identified. Please contact an organizer.")
            if len(people) > 1 and any(privacy.is_junior(person) for person in people):
                raise RegistrationError("Please ask an organizer to add group members who are juniors.")
            if len(people) == 1 and privacy.is_junior(people[0]):
                person = people[0]
                primary = next((row for row in all_perfs if (row.get("performer_name") or "").strip().casefold() == person.casefold() and (row.get("age_group") or "").strip().casefold() == "junior"), None)
                partner = next((row for row in all_perfs if len(split_signer_names(row.get("partner_name"))) == 1 and split_signer_names(row.get("partner_name"))[0].casefold() == person.casefold() and (row.get("partner_age_group") or "").strip().casefold() == "junior"), None)
                partner_guardian_name = (primary or {}).get("guardian_name") or (partner or {}).get("partner_guardian_name") or ""
                partner_guardian_phone = (primary or {}).get("guardian_phone") or (partner or {}).get("partner_guardian_phone") or ""
                if not partner_guardian_name or not partner_guardian_phone:
                    raise RegistrationError("The selected junior partner's guardian details are missing. Please contact an organizer.")
                if p.partner_age_group and p.partner_age_group.strip().casefold() != "junior":
                    raise RegistrationError("The selected partner's age group does not match the existing registration.")
                partner_details[id(p)] = ("Junior", partner_guardian_name, partner_guardian_phone)
            elif len(people) == 1 and any(
                ((ag.get("name") if isinstance(ag, dict) else ag.name) or "").strip().casefold() == (p.partner_age_group or "").strip().casefold()
                and bool(ag.get("requires_guardian") if isinstance(ag, dict) else ag.requires_guardian)
                for ag in age_groups
            ):
                partner_guardian_name = (p.partner_guardian_name or "").strip()
                partner_guardian_phone = (p.partner_guardian_phone or "").strip()
                if partner_guardian_name or partner_guardian_phone:
                    if not partner_guardian_name or not validate_phone(partner_guardian_phone):
                        raise RegistrationError("A junior partner needs a guardian name and valid phone number.")
                    partner_details[id(p)] = (p.partner_age_group, partner_guardian_name, partner_guardian_phone)
                elif (payload.guardian_name or "").strip() and validate_phone((payload.guardian_phone or "").strip()):
                    partner_details[id(p)] = (p.partner_age_group, payload.guardian_name.strip(), payload.guardian_phone.strip())
                else:
                    partner_details[id(p)] = (p.partner_age_group, "", "")
            if ptype == "Duet":
                if not p_name:
                    raise RegistrationError("Partner name is required for Duet performance.")
                if p_name.lower() not in registered_names:
                    if not p_phone or not validate_phone(p_phone):
                        raise RegistrationError(
                            f"A valid 10-digit phone number is required for partner '{p_name}' since they are not registered."
                        )

        if food_signup_enabled and not (payload.food_signup and (payload.food_signup.item_id or "").strip()):
            raise RegistrationError("Please select a potluck dish to register a performance.")

        # Claim the dish before creating performances so an unavailable slot cannot produce a dishless registration.
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
                raise FoodItemUnavailableError(str(ex))


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
            inherited = partner_details.get(id(p))
            if inherited:
                partner_ag = inherited[0]

            entry_id = db_service.create_performance(
                performer_name=clean_name,
                performance_type=ptype,
                partner_name=partner,
                partner_age_group=partner_ag,
                contact_info=contact_phone,
                partner_phone=partner_ph,
                partner_guardian_name=inherited[1] if inherited else "",
                partner_guardian_phone=inherited[2] if inherited else "",
                song_title=song,
                movie_name=movie,
                age_group=payload.age_group,
                guardian_name=guardian_name if requires_guardian else "",
                guardian_phone=guardian_phone if requires_guardian else "",
                public_first_name_only=bool(payload.public_first_name_only),
                stage_notes=notes,
                track_status=track_status,
                created_via="signup_portal"
            )
            created_ids.append(entry_id)

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
            "performer_name": NamePrivacy(db_service.get_all_performances()).name(clean_name),
            "entry_ids": created_ids,
            "food_signup_id": food_signup_id,
            "message": f"Registration completed successfully! Welcome to {get_setting('header_brand_title') or getattr(settings.event, 'header_brand_title', '') or 'the event'}."
        }


registration_service = RegistrationService()
