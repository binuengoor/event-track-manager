"""Feature flag definitions and guards for event-specific settings.

Persisted setting names and config fallbacks remain unchanged. Migrate callers
incrementally so existing presets and APIs keep their established behavior.
"""
from dataclasses import dataclass
from types import MappingProxyType

from fastapi import HTTPException

from app.config import get_setting, settings


@dataclass(frozen=True)
class Feature:
    setting: str
    config_field: str


FEATURES = MappingProxyType({
    name: Feature(name, name)
    for name in (
        "stage_performances_enabled", "signup_enabled", "food_signup_enabled",
        "track_upload_enabled", "allow_duets", "performer_edits_enabled",
        "live_display_enabled", "dashboard_enabled", "console_enabled",
        "payment_enabled",
    )
})


def feature_enabled(name: str) -> bool:
    """Resolve a registered flag using the existing DB/config precedence."""
    feature = FEATURES[name]
    fallback = getattr(settings.signup, feature.config_field)
    return bool(get_setting(feature.setting, fallback))


def require_feature(name: str, detail: str, status_code: int = 400) -> None:
    """Reject an operation when its registered feature is disabled."""
    if not feature_enabled(name):
        raise HTTPException(status_code=status_code, detail=detail)
