import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.admin_service import admin_service
from app.services.db_service import db_service


@pytest.fixture(autouse=True)
def reset_verification_and_event():
    admin_service.update_settings({"edit_verification_enabled": False, "event_passcode": ""})
    yield
    admin_service.update_settings({"edit_verification_enabled": False, "event_passcode": ""})


def test_pin_status_endpoint_auth_and_default():
    client = TestClient(app)
    # Public without auth -> 401
    assert client.get("/api/auth/pin-status").status_code == 401

    # With admin auth -> 200 and reports whether it is the shipped default
    res = client.get("/api/auth/pin-status", headers={"X-Admin-PIN": settings.admin_pin})
    assert res.status_code == 200
    data = res.json()
    assert "is_default" in data
    assert data["is_default"] == (settings.admin_pin == "2026")


def test_performer_edit_verification_off_by_default():
    client = TestClient(app)
    # Register a test performer
    res = client.post("/api/signup", json={
        "performer_name": "Alice Singer",
        "contact_info": "(610) 555-4321",
        "age_group": "Senior",
        "performances": [{
            "song_title": "Original Song",
            "performance_type": "Solo",
            "track_status": "Pending"
        }]
    })
    assert res.status_code == 200
    entry_id = res.json()["entry_ids"][0]

    try:
        # With edit verification OFF (default), editing does not require name/phone proof
        res = client.put(f"/api/signup/performance/{entry_id}", json={
            "song_title": "Updated Song No Proof"
        })
        assert res.status_code == 200
        perf = db_service.get_performance(entry_id)
        assert perf["song_title"] == "Updated Song No Proof"
    finally:
        db_service.delete_performance(entry_id)


def test_performer_edit_verification_when_enabled():
    admin_service.update_settings({"edit_verification_enabled": True})
    client = TestClient(app)

    res = client.post("/api/signup", json={
        "performer_name": "Bob Vocalist",
        "contact_info": "+1 215 555 9876",
        "age_group": "Senior",
        "performances": [{
            "song_title": "First Song",
            "performance_type": "Solo",
            "track_status": "Pending"
        }]
    })
    assert res.status_code == 200
    entry_id = res.json()["entry_ids"][0]

    try:
        # 1. Edit without proof -> 403
        res = client.put(f"/api/signup/performance/{entry_id}", json={
            "song_title": "Hacked Song"
        })
        assert res.status_code == 403
        assert "match" in res.json().get("detail", "").lower()

        # 2. Edit with wrong name -> 403
        res = client.put(f"/api/signup/performance/{entry_id}", json={
            "song_title": "Hacked Song",
            "signer_name": "Charlie",
            "signer_phone": "9876"
        })
        assert res.status_code == 403

        # 3. Edit with wrong phone -> 403
        res = client.put(f"/api/signup/performance/{entry_id}", json={
            "song_title": "Hacked Song",
            "signer_name": "Bob Vocalist",
            "signer_phone": "1234"
        })
        assert res.status_code == 403

        # 4. Edit with correct name and phone last 4 -> 200 OK
        res = client.put(f"/api/signup/performance/{entry_id}", json={
            "song_title": "Legit Updated Song",
            "signer_name": " bob   vocalist ",
            "signer_phone": "9876"
        })
        assert res.status_code == 200
        perf = db_service.get_performance(entry_id)
        assert perf["song_title"] == "Legit Updated Song"

        # 5. Admin override without proof succeeds
        res = client.put(
            f"/api/signup/performance/{entry_id}",
            json={"song_title": "Admin Updated Song"},
            headers={"X-Admin-PIN": settings.admin_pin}
        )
        assert res.status_code == 200
        perf = db_service.get_performance(entry_id)
        assert perf["song_title"] == "Admin Updated Song"
    finally:
        db_service.delete_performance(entry_id)
