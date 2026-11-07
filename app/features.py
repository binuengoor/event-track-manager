"""Feature registry (spec 6.4): one place that defines every event feature flag.

Each Feature carries its persisted setting name, config fallback, admin label, default, area, whether the flag is
published in public payloads, and the features it requires. Persisted setting names and config fallbacks are
unchanged. Consumers derive from FEATURES instead of hand-copying lists:

* ``feature_enabled(name)``  - DB/config precedence AND all ``requires`` (the single place dependencies are enforced)
* ``require_feature(name)``  - FastAPI ``Depends`` factory; ``require_feature(name, detail)`` also still raises inline
* ``feature_defaults()``, ``bool_setting_names()``, ``public_flags()``, ``feature_labels()`` - helpers for
  default_app_settings, admin_service.BOOL_SETTINGS and public payloads.
"""
from dataclasses import dataclass
from types import MappingProxyType
from typing import Callable, Dict, Optional, Tuple

from fastapi import HTTPException

from app.config import get_setting, settings


@dataclass(frozen=True)
class Feature:
    setting: str
    config_field: str
    label: str = ""
    default: bool = True
    area: str = "general"
    public: bool = False
    requires: Tuple[str, ...] = ()


def _f(name: str, label: str, area: str, public: bool = True, requires: Tuple[str, ...] = ()) -> Tuple[str, Feature]:
    return name, Feature(name, name, label=label, default=True, area=area, public=public, requires=requires)


FEATURES = MappingProxyType(dict([
    _f("stage_performances_enabled", "Stage performances", "stage"),
    _f("signup_enabled", "Performer sign-up", "signup"),
    _f("food_signup_enabled", "Potluck food sign-up", "food"),
    _f("track_upload_enabled", "Backing track uploads", "stage", requires=("stage_performances_enabled",)),
    _f("allow_duets", "Duets and groups", "signup"),
    _f("performer_edits_enabled", "Performers can edit their entries", "signup"),
    _f("live_display_enabled", "Live audience screen", "display"),
    _f("dashboard_enabled", "Public dashboard", "display"),
    _f("console_enabled", "Sound console", "console"),
    _f("payment_enabled", "Payment links", "signup", public=False),
]))

# Registry sanity: every dependency must itself be registered.
for _feature in FEATURES.values():
    for _dep in _feature.requires:
        assert _dep in FEATURES, f"{_feature.setting} requires unknown feature {_dep}"


def feature_labels() -> Dict[str, str]:
    return {name: f.label for name, f in FEATURES.items()}


def feature_defaults() -> Dict[str, bool]:
    """Config value when present, else the registry default (seeded into a fresh event database)."""
    return {name: bool(getattr(settings.signup, f.config_field, f.default)) for name, f in FEATURES.items()}


def bool_setting_names() -> frozenset:
    return frozenset(FEATURES)


def _own_value(feature: Feature) -> bool:
    fallback = getattr(settings.signup, feature.config_field, feature.default)
    return bool(get_setting(feature.setting, fallback))


def feature_enabled(name: str) -> bool:
    """Resolve a registered flag (DB/config precedence) and enforce its ``requires`` chain."""
    feature = FEATURES[name]
    if not _own_value(feature):
        return False
    return all(feature_enabled(dep) for dep in feature.requires)


def public_flags() -> Dict[str, bool]:
    """Flags safe to publish to guests, resolved with dependencies applied."""
    return {name: feature_enabled(name) for name, f in FEATURES.items() if f.public}


def feature_required(name: str, detail: Optional[str] = None, status_code: int = 400) -> Callable[[], bool]:
    """FastAPI dependency factory: ``Depends(feature_required("food_signup_enabled", "Food sign-up is off."))``."""
    FEATURES[name]  # fail at import time on typos
    message = detail or f"{FEATURES[name].label} is currently disabled."

    def _dependency() -> bool:
        if not feature_enabled(name):
            raise HTTPException(status_code=status_code, detail=message)
        return True

    return _dependency


def require_feature(name: str, detail: Optional[str] = None, status_code: int = 400):
    """Two forms. ``require_feature(name, detail)`` raises immediately when disabled (existing call style).
    ``require_feature(name)`` with no detail returns a dependency for ``Depends(...)``."""
    dependency = feature_required(name, detail, status_code)
    if detail is None:
        return dependency
    dependency()
    return None
