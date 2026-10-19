import io
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services import presets as preset_lib
from app.services.admin_service import admin_service
from app.services.db_service import db_service


@pytest.fixture
def admin():
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    return c


@pytest.fixture
def client():
    return TestClient(app)


def test_catalog_has_the_three_core_presets_plus_scenarios():
    ids = {p["id"] for p in preset_lib.PRESET_CATALOG}
    assert {"musical_night", "show_no_potluck", "potluck"} <= ids
    assert {"acoustic", "karaoke_video", "competition", "rehearsal", "freeze"} <= ids
    for p in preset_lib.PRESET_CATALOG:
        if p["id"] != "freeze":
            assert set(p["flags"]) == set(preset_lib.FLAG_KEYS), p["id"]  # every flag decided explicitly


def test_every_preset_passes_settings_validation():
    for pid in preset_lib.PRESETS_BY_ID:
        admin_service._validate_settings(preset_lib.preset_settings(pid))


def test_show_no_potluck_preset_turns_food_off_and_keeps_the_rest(admin, client):
    res = admin.post("/api/admin/apply-preset", json={"preset": "show_no_potluck"})
    assert res.status_code == 200
    info = client.get("/api/event-info").json()
    assert info["food_signup_enabled"] is False
    assert info["signup_enabled"] and info["track_upload_enabled"] and info["console_enabled"] and info["live_display_enabled"]


def test_full_event_preset_turns_everything_back_on(admin, client):
    admin.post("/api/admin/apply-preset", json={"preset": "potluck"})
    admin.post("/api/admin/apply-preset", json={"preset": "musical_night"})
    info = client.get("/api/event-info").json()
    assert all(info[k] for k in ("signup_enabled", "food_signup_enabled", "track_upload_enabled", "console_enabled", "live_display_enabled", "dashboard_enabled"))


def test_preset_preview_lists_exact_changes(admin):
    admin.post("/api/admin/apply-preset", json={"preset": "musical_night"})
    listing = {p["id"]: p for p in admin.get("/api/admin/presets").json()}
    changes = {c["label"]: (c["from"], c["to"]) for c in listing["show_no_potluck"]["changes"]}
    assert changes == {"Potluck food sign-up": ("On", "Off")}
    assert listing["musical_night"]["changes"] == []  # already applied


def test_competition_preset_also_sets_rules(admin):
    res = admin.post("/api/admin/apply-preset", json={"preset": "competition"}).json()
    s = admin.get("/api/admin/settings").json()
    assert s["max_performances_per_participant"] == 1 and s["max_solo_per_participant"] == 1
    assert s["performance_types"] == ["Solo"]
    assert any(c["label"] == "Songs per person" for c in res["changes"])
    assert s["active_preset"] == "competition"


def test_presets_require_the_pin(client):
    assert client.get("/api/admin/presets").status_code == 401
    assert client.post("/api/admin/food-items/bulk", json={"text": "x"}).status_code == 401


def test_parse_food_lines_groups_and_quantities():
    items = admin_service.parse_food_lines("Appetizers:\nSamosa x3\n- Spring rolls\nMains:\nBiryani (2)\nRice×2\nDal")
    assert [(i["group"], i["name"]) for i in items] == [
        ("Appetizers", "Samosa 1"), ("Appetizers", "Samosa 2"), ("Appetizers", "Samosa 3"), ("Appetizers", "Spring rolls"),
        ("Mains", "Biryani 1"), ("Mains", "Biryani 2"), ("Mains", "Rice 1"), ("Mains", "Rice 2"), ("Mains", "Dal"),
    ]


def test_bulk_add_creates_groups_skips_duplicates_and_keeps_claims(admin):
    first = admin.post("/api/admin/food-items/bulk", json={"text": "Mains:\nBiryani x2\nDal"}).json()
    assert first["added"] == 3 and first["groups_created"] == 1
    item = next(i for i in admin.get("/api/admin/food-items").json() if i["name"] == "Biryani 1")
    claim = admin.post("/api/signup/food", json={"item_id": item["item_id"], "signer_name": "Rohan Iyer", "signer_phone": "6105550100"})
    assert claim.status_code == 200
    second = admin.post("/api/admin/food-items/bulk", json={"text": "Mains:\nBiryani x2\nDal\nNaan"}).json()
    assert second["added"] == 1 and sorted(second["skipped"]) == ["Biryani 1", "Biryani 2", "Dal"]
    after = next(i for i in admin.get("/api/admin/food-items").json() if i["name"] == "Biryani 1")
    assert after["signer_name"] == "Rohan Iyer"


def test_bulk_add_rejects_empty_and_oversized_input(admin):
    assert admin.post("/api/admin/food-items/bulk", json={"text": "   \n  "}).status_code == 400
    assert admin.post("/api/admin/food-items/bulk", json={"text": "\n".join(f"Item{i}" for i in range(301))}).status_code == 400


def test_allowed_media_is_enforced_on_upload(admin, client):
    eid = db_service.create_performance(performer_name="Media Test", song_title="Song", performance_type="Solo", contact_info="6105550100")
    assert admin.put("/api/admin/settings", json={"settings": {"allowed_media": ["audio"]}}).status_code == 200
    res = client.post("/api/upload", data={"entry_id": eid, "submission_type": "file", "media_type": "video"},
                      files={"file": ("clip.mp4", io.BytesIO(b"x" * 50), "video/mp4")})
    assert res.status_code == 400 and "audio" in res.json()["detail"]
    assert client.get("/api/event-info").json()["allowed_media"] == ["audio"]


def test_allowed_media_validation(admin):
    assert admin.put("/api/admin/settings", json={"settings": {"allowed_media": []}}).status_code == 400
    assert admin.put("/api/admin/settings", json={"settings": {"allowed_media": ["audio", "hologram"]}}).status_code == 400
    assert admin.put("/api/admin/settings", json={"settings": {"setup_completed": True}}).status_code == 200


# --------------------------------------------------------------------------- readiness
def test_readiness_requires_pin_and_reports_default_pin_and_missing_tracks(admin, client, monkeypatch):
    assert client.get("/api/admin/readiness").status_code == 401
    monkeypatch.setattr(settings, "admin_pin", "2026")
    db_service.create_performance(performer_name="No Track", song_title="Song", performance_type="Solo", contact_info="6105550100")
    db_service.create_performance(performer_name="No Title", song_title="", performance_type="Solo", contact_info="6105550100")
    data = admin.get("/api/admin/readiness", headers={"X-Admin-PIN": "2026"}).json()
    by_id = {c["id"]: c for c in data["checks"]}
    assert by_id["pin"]["status"] == "warn" and "2026" in by_id["pin"]["detail"]
    assert by_id["storage"]["status"] == "ok"
    assert by_id["tracks"]["status"] == "warn" and "No Track" in by_id["tracks"]["detail"]
    assert by_id["songs"]["status"] == "warn" and "No Title" in by_id["songs"]["detail"]
    assert data["overall"] in ("warn", "error") and data["counts"]["warn"] >= 3


def test_readiness_flags_unmatched_incoming_files(admin):
    from app.services.track_store import track_store
    import os
    open(os.path.join(track_store.incoming_dir, "mystery.mp3"), "wb").write(b"x")
    by_id = {c["id"]: c for c in admin.get("/api/admin/readiness").json()["checks"]}
    assert by_id["incoming"]["status"] == "warn" and "mystery.mp3" in by_id["incoming"]["detail"]


def test_readiness_storage_error_when_folder_not_writable(admin, monkeypatch):
    monkeypatch.setattr(settings.storage, "event_dir", "/proc/definitely/not/writable")
    by_id = {c["id"]: c for c in admin.get("/api/admin/readiness").json()["checks"]}
    assert by_id["storage"]["status"] == "error"
