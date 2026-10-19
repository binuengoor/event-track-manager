import os
import json
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings, load_config
from app.services.db_service import db_service
from app.services.event_manager import event_manager
from app.services.track_store import track_store

ADMIN = {"X-Admin-PIN": settings.admin_pin}


@pytest.fixture
def admin():
    c = TestClient(app)
    c.headers.update(ADMIN)
    return c


@pytest.fixture
def client():
    return TestClient(app)


def _signup(client, name, song="Song"):
    res = client.post("/api/signup", json={"performer_name": name, "contact_info": "6105550100", "age_group": "Senior",
                                           "performances": [{"performance_type": "Solo", "song_title": song}]})
    assert res.status_code == 200, res.text
    return res.json()["entry_ids"][0]


def _events(admin):
    return admin.get("/api/admin/events").json()


def test_event_endpoints_require_the_pin(client):
    assert client.get("/api/admin/events").status_code == 401
    assert client.post("/api/admin/events", json={"name": "X Event"}).status_code == 401
    assert client.post("/api/admin/events/test-event/activate").status_code == 401
    assert client.post("/api/admin/events/test-event/clear-media", json={"confirm": "test-event"}).status_code == 401


def test_the_current_event_is_listed_with_counts(admin, client):
    _signup(client, "Aarav Menon")
    data = _events(admin)
    assert data["switching_enabled"] is True and data["active"] == "test-event"
    ev = data["events"][0]
    assert ev["id"] == "test-event" and ev["active"] is True and ev["performances"] == 1 and ev["participants"] == 1


def test_new_event_is_empty_but_inherits_rules_and_potluck_menu(admin, client):
    admin.put("/api/admin/settings", json={"settings": {"max_performances_per_participant": 3, "event_name": "Old Show"}})
    admin.post("/api/admin/food-items/bulk", json={"text": "Mains:\nBiryani x2"})
    _signup(client, "Aarav Menon")
    item = next(i for i in admin.get("/api/admin/food-items").json() if i["name"] == "Biryani 1")
    client.post("/api/signup/food", json={"item_id": item["item_id"], "signer_name": "Aarav Menon", "signer_phone": "6105550100"})

    res = admin.post("/api/admin/events", json={"name": "Summer Talent Night 2027", "start_time": "06-14-2027 06:00PM", "venue": "Town Hall"})
    assert res.status_code == 200, res.text
    assert res.json()["active"] == "summer-talent-night-2027"

    info = client.get("/api/event-info").json()
    assert info["event_name"] == "Summer Talent Night 2027" and info["venue"] == "Town Hall"
    assert info["poster_url"] == "" and info["setup_completed"] is False
    assert admin.get("/api/admin/settings").json()["max_performances_per_participant"] == 3   # rules carried over
    assert client.get("/api/performances").json() == []                                       # no signups carried over
    items = admin.get("/api/admin/food-items").json()
    assert {i["name"] for i in items} >= {"Biryani 1", "Biryani 2"}                           # menu copied...
    assert not any(i["is_taken"] for i in items)                                              # ...claims are not
    assert _signup(client, "New Person") == "PK-001"                                          # numbering restarts


def test_blank_event_starts_with_no_potluck_menu(admin):
    admin.post("/api/admin/food-items/bulk", json={"text": "Dal"})
    admin.post("/api/admin/events", json={"name": "Blank One", "copy_from": "none"})
    assert admin.get("/api/admin/food-items").json() == []


def test_switching_back_restores_the_old_events_data_and_keeps_them_separate(admin, client):
    _signup(client, "Event A Singer")
    admin.post("/api/admin/events", json={"name": "Event B"})
    _signup(client, "Event B Singer")
    assert [p["performer_name"] for p in client.get("/api/performances").json()] == ["Event B Singer"]

    assert admin.post("/api/admin/events/test-event/activate").status_code == 200
    assert [p["performer_name"] for p in client.get("/api/performances").json()] == ["Event A Singer"]
    ids = {e["id"]: e for e in _events(admin)["events"]}
    assert set(ids) == {"test-event", "event-b"} and ids["test-event"]["active"] and not ids["event-b"]["active"]
    assert ids["event-b"]["performances"] == 1


def test_duplicate_names_get_unique_folders(admin):
    a = admin.post("/api/admin/events", json={"name": "Same Name"}).json()["event"]["id"]
    b = admin.post("/api/admin/events", json={"name": "Same Name"}).json()["event"]["id"]
    assert (a, b) == ("same-name", "same-name-2")


def test_the_active_event_is_remembered_across_restarts(admin, tmp_path, monkeypatch):
    admin.post("/api/admin/events", json={"name": "Remembered"})
    marker = os.path.join(settings.storage.events_dir, ".active_event")
    assert open(marker).read().strip() == "remembered"
    monkeypatch.setenv("EVENTS_DIR", settings.storage.events_dir)
    monkeypatch.delenv("EVENT_DIR", raising=False)
    cfg = load_config()
    assert cfg.event.id == "remembered" and cfg.storage.event_dir.endswith(os.path.join("events", "remembered"))


def test_bad_ids_and_unknown_events_are_rejected(admin):
    assert admin.post("/api/admin/events/..%2Fetc/activate").status_code in (400, 404)
    assert admin.post("/api/admin/events/nope/activate").status_code == 400
    assert admin.post("/api/admin/events", json={"name": " "}).status_code == 400
    assert admin.post("/api/admin/events", json={"name": "Ok Name", "copy_from": "ghost"}).status_code == 400


def test_pinning_a_single_folder_turns_switching_off(admin, monkeypatch):
    monkeypatch.setenv("EVENT_DIR", settings.storage.event_dir)
    assert _events(admin)["switching_enabled"] is False
    assert admin.post("/api/admin/events", json={"name": "Nope Event"}).status_code == 400
    assert admin.post("/api/admin/events/test-event/activate").status_code == 400


def test_public_images_come_from_the_active_event(admin, client):
    open(os.path.join(settings.storage.event_dir, "poster.png"), "wb").write(b"A-POSTER")
    assert client.get("/data/poster.png").content == b"A-POSTER"
    admin.post("/api/admin/events", json={"name": "Other Event"})
    assert client.get("/data/poster.png").status_code == 404
    open(os.path.join(settings.storage.event_dir, "poster.png"), "wb").write(b"B-POSTER")
    assert client.get("/data/poster.png").content == b"B-POSTER"


def _track(entry_id, name=None, size=2048):
    path = os.path.join(track_store.tracks_dir, name or f"01_{entry_id}_x.mp3")
    open(path, "wb").write(b"a" * size)
    return path


def test_clear_media_deletes_files_but_keeps_every_record(admin, client):
    a, b = _signup(client, "Has Track"), _signup(client, "Also Track")
    _track(a); _track(b, size=1000)
    open(os.path.join(track_store.incoming_dir, "PK-009_pending.mp3"), "wb").write(b"i" * 100)
    os.makedirs(track_store.archive_dir, exist_ok=True)
    open(os.path.join(track_store.archive_dir, f"{a}_old_archived_1.mp3"), "wb").write(b"o" * 500)
    from app.services.event_service import event_service
    event_service.reconcile_tracks(force=True)
    assert db_service.get_performance(a)["track_status"] == "Uploaded"

    assert admin.post("/api/admin/events/test-event/clear-media", json={"confirm": "wrong"}).status_code == 400
    res = admin.post("/api/admin/events/test-event/clear-media", json={"confirm": "test-event"}).json()
    assert res["files_deleted"] == 4 and res["bytes_freed"] == 2048 + 1000 + 100 + 500
    assert track_store.find(a) is None and os.listdir(track_store.incoming_dir) == []
    perf = db_service.get_performance(a)
    assert perf["track_status"] == "Pending" and not perf["drive_file_id"] and perf["performer_name"] == "Has Track"
    assert len(client.get("/api/performances").json()) == 2                      # sign-ups untouched


def test_clear_media_keeps_acoustic_status_and_works_on_a_past_event(admin, client):
    eid = db_service.create_performance(performer_name="Guitar", song_title="Live", performance_type="Acoustic", track_status="Acoustic")
    old_tracks = track_store.tracks_dir
    open(os.path.join(old_tracks, f"01_{eid}_x.mp3"), "wb").write(b"z" * 300)
    admin.post("/api/admin/events", json={"name": "Next Event"})          # old event is no longer active
    res = admin.post("/api/admin/events/test-event/clear-media", json={"confirm": "test-event"}).json()
    assert res["files_deleted"] == 1 and not os.listdir(old_tracks)
    admin.post("/api/admin/events/test-event/activate")
    assert db_service.get_performance(eid)["track_status"] == "Acoustic"
    assert _events(admin)["events"][0]["media_files"] == 0
