import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.db_service import db_service


@pytest.fixture
def admin():
    client = TestClient(app)
    client.headers.update({"X-Admin-PIN": settings.admin_pin})
    return client


def active_id(admin):
    return admin.get("/api/admin/settings").json()["active_event_id"]


def test_wizard_progress_and_draft_are_exposed_and_persisted(admin):
    initial = admin.get("/api/admin/settings").json()
    assert initial["active_event_id"] == settings.event.id
    assert initial["wizard_step"] == 1
    assert initial["wizard_draft"] == {"preset": "musical_night", "basics": {}, "food": "", "rules": {}}

    draft = {
        "preset": "potluck",
        "basics": {"event_name": "Community Dinner"},
        "food": "Mains:\nRice",
        "rules": {"max_performances_per_participant": 2},
    }
    saved = admin.put("/api/admin/settings", json={"expected_event_id": initial["active_event_id"], "settings": {"wizard_step": 4, "wizard_draft": draft}})
    assert saved.status_code == 200, saved.text
    current = admin.get("/api/admin/settings").json()
    assert current["wizard_step"] == 4
    assert current["wizard_draft"] == draft


@pytest.mark.parametrize("bad_step", [0, 6, True, 1.5, "next", None])
def test_wizard_step_rejects_values_outside_one_through_five(admin, bad_step):
    response = admin.put("/api/admin/settings", json={"expected_event_id": active_id(admin), "settings": {"wizard_step": bad_step}})
    assert response.status_code == 400


@pytest.mark.parametrize("draft", [
    {"preset": "missing", "basics": {}, "food": "", "rules": {}},
    {"preset": "potluck", "basics": {"event_name": ["bad"]}, "food": "", "rules": {}},
    {"preset": "potluck", "basics": {}, "food": "x" * 20001, "rules": {}},
    {"preset": "potluck", "basics": {}, "food": "", "rules": {"allowed_media": ["exe"]}},
    {"preset": "potluck", "basics": {}, "food": "", "rules": {}, "extra": 1},
])
def test_wizard_draft_is_strictly_validated(admin, draft):
    response = admin.put("/api/admin/settings", json={"expected_event_id": active_id(admin), "settings": {"wizard_draft": draft}})
    assert response.status_code == 400


def test_completing_wizard_clears_progress_and_draft(admin):
    admin.put("/api/admin/settings", json={"expected_event_id": active_id(admin), "settings": {
        "wizard_step": 5,
        "wizard_draft": {"preset": "potluck", "basics": {"event_name": "Draft"}, "food": "Dal", "rules": {}},
    }})
    response = admin.put("/api/admin/settings", json={"settings": {"setup_completed": True}})
    assert response.status_code == 200
    current = admin.get("/api/admin/settings").json()
    assert current["setup_completed"] is True
    assert current["wizard_step"] == 1
    assert current["wizard_draft"] == {"preset": "musical_night", "basics": {}, "food": "", "rules": {}}


def test_new_event_starts_with_fresh_wizard_state(admin):
    admin.put("/api/admin/settings", json={"expected_event_id": active_id(admin), "settings": {
        "wizard_step": 4,
        "wizard_draft": {"preset": "potluck", "basics": {"event_name": "Old"}, "food": "Dal", "rules": {}},
    }})
    created = admin.post("/api/admin/events", json={"name": "Wizard Reset Event"})
    assert created.status_code == 200, created.text
    current = admin.get("/api/admin/settings").json()
    assert current["setup_completed"] is False
    assert current["wizard_step"] == 1
    assert current["wizard_draft"] == {"preset": "musical_night", "basics": {}, "food": "", "rules": {}}
    restored = admin.post("/api/admin/events/test-event/activate")
    assert restored.status_code == 200, restored.text
    old = admin.get("/api/admin/settings").json()
    assert old["wizard_step"] == 4
    assert old["wizard_draft"]["basics"] == {"event_name": "Old"}


def test_wizard_step_and_draft_write_as_one_transaction(admin):
    before = admin.get("/api/admin/settings").json()
    conn = db_service._get_connection()
    conn.execute("""CREATE TRIGGER fail_wizard_draft BEFORE INSERT ON app_settings
        WHEN NEW.key = 'wizard_draft' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END""")
    conn.commit()
    try:
        client = TestClient(app, raise_server_exceptions=False)
        client.headers.update({"X-Admin-PIN": settings.admin_pin})
        response = client.put("/api/admin/settings", json={"expected_event_id": before["active_event_id"], "settings": {
            "wizard_step": 5,
            "wizard_draft": {"preset": "potluck", "basics": {}, "food": "Dal", "rules": {}},
        }})
        assert response.status_code == 500
        after = admin.get("/api/admin/settings").json()
        assert after["wizard_step"] == before["wizard_step"]
        assert after["wizard_draft"] == before["wizard_draft"]
    finally:
        conn.execute("DROP TRIGGER IF EXISTS fail_wizard_draft")
        conn.commit()


def test_wizard_writes_reject_stale_event_ids_without_mutating_current_event(admin, monkeypatch):
    event_id = active_id(admin)
    monkeypatch.setattr(settings.event, "id", "different-event")
    response = admin.put("/api/admin/settings", json={"expected_event_id": event_id, "settings": {
        "wizard_step": 3,
        "wizard_draft": {"preset": "potluck", "basics": {}, "food": "Dal", "rules": {}},
    }})
    assert response.status_code == 409
    monkeypatch.setattr(settings.event, "id", event_id)


def test_wizard_progress_requires_event_id(admin):
    response = admin.put("/api/admin/settings", json={"settings": {"wizard_step": 2}})
    assert response.status_code == 400


def test_wizard_preset_and_food_guard_stale_event(admin, monkeypatch):
    event_id = active_id(admin)
    monkeypatch.setattr(settings.event, "id", "different-event")
    preset = admin.post("/api/admin/apply-preset", json={"preset": "potluck", "expected_event_id": event_id})
    food = admin.post("/api/admin/food-items/bulk", json={"text": "Dal", "expected_event_id": event_id})
    assert preset.status_code == 409
    assert food.status_code == 409
    monkeypatch.setattr(settings.event, "id", event_id)


def test_setup_completion_and_draft_reset_commit_atomically(admin):
    admin.put("/api/admin/settings", json={"expected_event_id": active_id(admin), "settings": {
        "wizard_step": 4,
        "wizard_draft": {"preset": "potluck", "basics": {"event_name": "Saved"}, "food": "Dal", "rules": {}},
    }})
    before = admin.get("/api/admin/settings").json()
    conn = db_service._get_connection()
    conn.execute("""CREATE TRIGGER fail_completion_reset BEFORE INSERT ON app_settings
        WHEN NEW.key = 'wizard_draft' AND json_extract(NEW.value, '$.preset') = 'musical_night'
        BEGIN SELECT RAISE(ABORT, 'injected reset failure'); END""")
    conn.commit()
    try:
        client = TestClient(app, raise_server_exceptions=False)
        client.headers.update({"X-Admin-PIN": settings.admin_pin})
        response = client.put("/api/admin/settings", json={"settings": {"setup_completed": True}})
        assert response.status_code == 500
        after = admin.get("/api/admin/settings").json()
        assert after["setup_completed"] is before["setup_completed"]
        assert after["wizard_step"] == before["wizard_step"]
        assert after["wizard_draft"] == before["wizard_draft"]
    finally:
        conn.execute("DROP TRIGGER IF EXISTS fail_completion_reset")
        conn.commit()
