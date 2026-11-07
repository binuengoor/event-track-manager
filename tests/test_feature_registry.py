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


def test_dataset_flags_follow_config_and_database_precedence(monkeypatch):
    from app.repositories.settings_repo import SettingsRepository
    from app.services.datasets import event_kind

    monkeypatch.setattr(features.settings.signup, "stage_performances_enabled", False)
    monkeypatch.setattr(features.settings.signup, "food_signup_enabled", False)
    monkeypatch.setattr(SettingsRepository, "get_setting", lambda self, key: None)
    assert event_kind() == {"stage": False, "potluck": False}

    monkeypatch.setattr(SettingsRepository, "get_setting", lambda self, key: "true")
    assert event_kind() == {"stage": True, "potluck": True}


def test_presets_use_registered_flags_and_freeze_is_a_partial_patch():
    from app.services.presets import PRESET_CATALOG, preset_settings

    assert len(PRESET_CATALOG) == 8
    for preset in PRESET_CATALOG:
        flags = preset["flags"]
        assert set(flags) <= set(features.FEATURES)
        assert all(type(value) is bool for value in flags.values())
        if preset["id"] != "freeze":
            assert set(flags) == set(features.FEATURES)
    assert preset_settings("freeze") == {
        "signup_enabled": False,
        "food_signup_enabled": False,
        "track_upload_enabled": False,
        "performer_edits_enabled": False,
        "console_enabled": True,
    }
