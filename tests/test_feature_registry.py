import pytest
from fastapi import HTTPException

from app import features


def test_registered_flags_use_config_fallback_and_live_overrides(monkeypatch):
    calls = []

    def resolve(key, fallback):
        calls.append((key, fallback))
        return False

    monkeypatch.setattr(features, "get_setting", resolve)
    for name, feature in features.FEATURES.items():
        assert features.feature_enabled(name) is False
        assert calls[-1] == (feature.setting, getattr(features.settings.signup, feature.config_field))

    monkeypatch.setattr(features, "get_setting", lambda key, fallback: True)
    assert features.feature_enabled("food_signup_enabled") is True
    features.require_feature("food_signup_enabled", "unavailable")


def test_guard_preserves_error_and_rejects_unknown_flags(monkeypatch):
    monkeypatch.setattr(features, "get_setting", lambda key, fallback: False)
    with pytest.raises(HTTPException) as error:
        features.require_feature("food_signup_enabled", "unavailable", status_code=403)
    assert (error.value.status_code, error.value.detail) == (403, "unavailable")
    with pytest.raises(KeyError):
        features.feature_enabled("typo_enabled")
