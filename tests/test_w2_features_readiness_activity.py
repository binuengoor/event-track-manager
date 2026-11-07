import os
import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import features
from app.features import FEATURES
from app.services import presets
from app.services.db_service import db_service


def test_every_feature_has_default_label_area_and_valid_requires():
    for name, f in FEATURES.items():
        assert f.setting == name and isinstance(f.default, bool)
        assert f.label and f.area and isinstance(f.public, bool)
        assert all(dep in FEATURES for dep in f.requires)
    assert features.feature_labels().keys() == FEATURES.keys()
    assert features.bool_setting_names() == frozenset(FEATURES)
    assert features.public_flags().keys() <= FEATURES.keys()


def test_every_feature_is_covered_by_presets():
    assert presets.FLAG_KEYS == list(FEATURES)
    for preset in presets.PRESET_CATALOG:
        if preset["id"] != "freeze":
            assert set(preset["flags"]) == set(FEATURES), preset["id"]
    for name in FEATURES:
        assert presets.SETTING_LABELS[name] == FEATURES[name].label


def test_default_app_settings_derive_from_registry():
    from app.services.event_manager import default_app_settings
    defaults = default_app_settings()
    for name in FEATURES:
        assert isinstance(defaults[name], bool), name


def test_requires_are_enforced_in_one_place(monkeypatch):
    values = {"stage_performances_enabled": False, "track_upload_enabled": True}
    monkeypatch.setattr(features, "get_setting", lambda key, fallback: values.get(key, True))
    assert features.feature_enabled("track_upload_enabled") is False
    assert features.public_flags()["track_upload_enabled"] is False
    with pytest.raises(HTTPException):
        features.require_feature("track_upload_enabled", "off")
    values["stage_performances_enabled"] = True
    assert features.feature_enabled("track_upload_enabled") is True


def test_every_requires_edge_is_enforced(monkeypatch):
    for name, f in FEATURES.items():
        for dep in f.requires:
            monkeypatch.setattr(features, "get_setting", lambda key, fallback, dep=dep: key != dep)
            assert features.feature_enabled(name) is False, (name, dep)


def test_require_feature_works_as_a_dependency_and_inline(monkeypatch):
    app = FastAPI()

    @app.get("/x", dependencies=[Depends(features.require_feature("food_signup_enabled"))])
    def x():
        return {"ok": True}

    client = TestClient(app)
    monkeypatch.setattr(features, "get_setting", lambda key, fallback: True)
    assert client.get("/x").status_code == 200
    monkeypatch.setattr(features, "get_setting", lambda key, fallback: False)
    res = client.get("/x")
    assert res.status_code == 400 and "disabled" in res.json()["detail"]
    with pytest.raises(HTTPException) as err:
        features.require_feature("food_signup_enabled", "custom", status_code=403)
    assert (err.value.status_code, err.value.detail) == (403, "custom")


def test_readiness_has_ffprobe_and_keeps_ids(monkeypatch):
    import asyncio
    from app.services import readiness_service as rs

    async def healthy():
        return {"status": "healthy"}
    monkeypatch.setattr(rs.downloader_client, "check_health", healthy)
    ids = [c["id"] for c in asyncio.run(rs.readiness_service.run())["checks"]]
    for keep in ("pin", "storage", "disk", "db_integrity", "ffmpeg", "downloader", "track_files", "backup", "incoming", "wizard"):
        assert keep in ids
    assert "ffprobe" in ids
    monkeypatch.setattr(rs.shutil, "which", lambda n: None if n == "ffprobe" else "/bin/x")
    assert rs.readiness_service._ffprobe()["status"] == "error"
    assert rs.readiness_service._ffmpeg()["status"] == "ok"


@pytest.mark.parametrize("free_gb,expected", [(0.5, "error"), (1.5, "warn"), (2.5, "ok"), (4, "ok")])
def test_disk_thresholds(monkeypatch, free_gb, expected):
    from collections import namedtuple
    from app.services import readiness_service as rs
    usage = namedtuple("u", "total used free")
    monkeypatch.setattr(rs.shutil, "disk_usage", lambda p: usage(0, 0, int(free_gb * 1024 ** 3)))
    assert rs.readiness_service._disk()["status"] == expected


def test_track_files_checks_expected_size():
    from app.services.readiness_service import readiness_service
    from app.services.track_store import track_store
    res = TestClient(__import__("app.main", fromlist=["app"]).app).post("/api/signup", json={
        "performer_name": "Sized", "age_group": "Senior", "contact_info": "610-555-0123",
        "performances": [{"performance_type": "Solo", "song_title": "S"}]})
    eid = res.json()["entry_ids"][0]
    path = os.path.join(track_store.tracks_dir, f"{eid}_Sized_S.mp3")
    open(path, "wb").write(b"x" * 100)
    db_service.update_performance_field(eid, "drive_file_name", os.path.basename(path))
    db_service.update_performance_field(eid, "drive_file_id", "v100-1700000000")
    assert readiness_service._track_files()["status"] == "ok"
    db_service.update_performance_field(eid, "drive_file_id", "v999-1700000000")
    check = readiness_service._track_files()
    assert check["status"] == "error" and eid in check["detail"] and "size" in check["detail"]
    db_service.update_performance_field(eid, "drive_file_id", "legacy-opaque-id")  # size unknown: not flagged
    assert readiness_service._track_files()["status"] == "ok"


def test_activity_role_is_recorded_and_returned():
    db_service.log_activity("a", "Guest One", "guest did", source="performer_hub")
    db_service.log_activity("b", "", "admin did", source="admin", role="admin")
    db_service.log_activity("c", "Guest One", "admin on guest", source="upload", role="admin")
    db_service.log_activity("d", "", "system did")
    db_service.log_activity("e", "Guest One", "explicit guest", source="signup", role="guest")
    rows = {r["action_type"]: r for r in db_service.get_activity_logs(days=1)}
    assert {k: rows[k]["role"] for k in "abcde"} == {"a": "guest", "b": "admin", "c": "admin", "d": "system", "e": "guest"}
    assert rows["c"]["source"] == "admin:upload"
    with pytest.raises(ValueError):
        db_service.log_activity("f", "", "x", role="root")


def test_admin_actions_no_longer_hardcode_admin_as_performer():
    from app.main import app
    from app.config import settings
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    eid = c.post("/api/signup", json={"performer_name": "Pay Me", "age_group": "Senior", "contact_info": "610-555-0123",
                                      "performances": [{"performance_type": "Solo", "song_title": "S"}]}).json()["entry_ids"][0]
    singers = c.get("/api/admin/payments").json()["singers"]
    res = c.put("/api/admin/payments", json={"updates": [{"participant_id": singers[0]["participant_id"], "paid": True}]})
    assert res.status_code == 200
    logs = c.get("/api/admin/activity-logs?days=1&search=payment").json()
    assert logs and logs[0]["performer_name"] != "Admin" and logs[0]["role"] == "admin"
