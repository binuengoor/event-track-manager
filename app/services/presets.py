"""Event-type presets: one click turns the right modules on/off and sets sensible rules.

Each preset lists *every* feature flag it cares about, so applying one gives a predictable result. Data is never
deleted by a preset; it only changes which pages/actions are open and the sign-up rules.
"""
from typing import Any, Dict, List

FLAG_KEYS = [
    "stage_performances_enabled", "signup_enabled", "food_signup_enabled", "track_upload_enabled",
    "allow_duets", "performer_edits_enabled", "live_display_enabled", "dashboard_enabled",
    "console_enabled", "payment_enabled",
]

SETTING_LABELS: Dict[str, str] = {
    "stage_performances_enabled": "Stage performances",
    "signup_enabled": "Performer sign-up",
    "food_signup_enabled": "Potluck food sign-up",
    "track_upload_enabled": "Backing track uploads",
    "allow_duets": "Duets and groups",
    "performer_edits_enabled": "Performers can edit their entries",
    "live_display_enabled": "Live audience screen",
    "dashboard_enabled": "Public dashboard",
    "console_enabled": "Sound console",
    "payment_enabled": "Payment links",
    "max_performances_per_participant": "Songs per person",
    "max_solo_per_participant": "Solo songs per person",
    "performance_types": "Performance types",
    "allowed_media": "Allowed track types",
}


def _flags(**on: bool) -> Dict[str, bool]:
    base = {k: False for k in FLAG_KEYS}
    base.update(on)
    return base


PRESET_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "musical_night", "name": "Full event", "icon": "party-popper", "accent": "orange",
        "tagline": "Everything on: sign-up, tracks, console, live screen and potluck.",
        "flags": _flags(stage_performances_enabled=True, signup_enabled=True, food_signup_enabled=True,
                        track_upload_enabled=True, allow_duets=True, performer_edits_enabled=True,
                        live_display_enabled=True, dashboard_enabled=True, console_enabled=True, payment_enabled=True),
        "rules": {"max_performances_per_participant": 2, "max_solo_per_participant": 1,
                  "performance_types": ["Solo", "Duet", "Group"], "allowed_media": ["audio", "video"]},
    },
    {
        "id": "show_no_potluck", "name": "Show, no potluck", "icon": "mic-2", "accent": "indigo",
        "tagline": "The whole stage show without any food sign-up.",
        "flags": _flags(stage_performances_enabled=True, signup_enabled=True, food_signup_enabled=False,
                        track_upload_enabled=True, allow_duets=True, performer_edits_enabled=True,
                        live_display_enabled=True, dashboard_enabled=True, console_enabled=True, payment_enabled=True),
        "rules": {"max_performances_per_participant": 2, "max_solo_per_participant": 1,
                  "performance_types": ["Solo", "Duet", "Group"], "allowed_media": ["audio", "video"]},
    },
    {
        "id": "potluck", "name": "Potluck only", "icon": "utensils", "accent": "emerald",
        "tagline": "Community dinner. Just the food board and food sign-up.",
        "flags": _flags(food_signup_enabled=True, dashboard_enabled=True),
        "rules": {},
    },
    {
        "id": "acoustic", "name": "Acoustic / live band", "icon": "guitar", "accent": "sky",
        "tagline": "Live instruments. No backing tracks; the console runs the order and notes.",
        "flags": _flags(stage_performances_enabled=True, signup_enabled=True, food_signup_enabled=True,
                        track_upload_enabled=False, allow_duets=True, performer_edits_enabled=True,
                        live_display_enabled=True, dashboard_enabled=True, console_enabled=True, payment_enabled=True),
        "rules": {"max_performances_per_participant": 2, "max_solo_per_participant": 2},
    },
    {
        "id": "karaoke_video", "name": "Karaoke / video night", "icon": "tv", "accent": "pink",
        "tagline": "Audio or video backing tracks, several songs per person, stage monitor ready.",
        "flags": _flags(stage_performances_enabled=True, signup_enabled=True, food_signup_enabled=False,
                        track_upload_enabled=True, allow_duets=True, performer_edits_enabled=True,
                        live_display_enabled=True, dashboard_enabled=True, console_enabled=True, payment_enabled=False),
        "rules": {"max_performances_per_participant": 4, "max_solo_per_participant": 4,
                  "performance_types": ["Solo", "Duet", "Group"], "allowed_media": ["audio", "video"]},
    },
    {
        "id": "competition", "name": "Solo competition", "icon": "trophy", "accent": "purple",
        "tagline": "One solo act each, no public setlist, no food.",
        "flags": _flags(stage_performances_enabled=True, signup_enabled=True, food_signup_enabled=False,
                        track_upload_enabled=True, allow_duets=False, performer_edits_enabled=True,
                        live_display_enabled=True, dashboard_enabled=False, console_enabled=True, payment_enabled=True),
        "rules": {"max_performances_per_participant": 1, "max_solo_per_participant": 1,
                  "performance_types": ["Solo"], "allowed_media": ["audio", "video"]},
    },
    {
        "id": "rehearsal", "name": "Rehearsal / sound check", "icon": "sliders", "accent": "amber",
        "tagline": "Console and uploads only. Public pages and sign-up closed.",
        "flags": _flags(stage_performances_enabled=True, signup_enabled=False, food_signup_enabled=False,
                        track_upload_enabled=True, allow_duets=True, performer_edits_enabled=True,
                        live_display_enabled=False, dashboard_enabled=False, console_enabled=True, payment_enabled=False),
        "rules": {},
    },
    {
        "id": "freeze", "name": "Show-day freeze", "icon": "lock", "accent": "rose",
        "tagline": "Locks sign-up, food and edits. The console keeps running.",
        "flags": {"signup_enabled": False, "food_signup_enabled": False, "track_upload_enabled": False,
                  "performer_edits_enabled": False, "console_enabled": True},
        "rules": {},
    },
]

PRESETS_BY_ID = {p["id"]: p for p in PRESET_CATALOG}


def preset_settings(preset_id: str) -> Dict[str, Any]:
    p = PRESETS_BY_ID[preset_id]
    return {**p["flags"], **p["rules"]}


def _display(key: str, value: Any) -> str:
    if isinstance(value, bool):
        return "On" if value else "Off"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) or "none"
    return str(value)


def diff_against(preset_id: str, current: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Human-readable list of what applying the preset would change right now."""
    changes = []
    for key, new in preset_settings(preset_id).items():
        old = current.get(key)
        if key in FLAG_KEYS and old is None:
            old = True  # flags default to on
        if isinstance(old, str) and old.lower() in ("true", "false"):
            old = old.lower() == "true"
        if old != new:
            changes.append({"key": key, "label": SETTING_LABELS.get(key, key), "from": _display(key, old), "to": _display(key, new)})
    return changes
