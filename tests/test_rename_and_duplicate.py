import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.db_service import db_service

@pytest.fixture
def client():
    return TestClient(app)

def test_rename_performer_db_and_api(client):
    # Setup performer and performances
    entry1 = db_service.create_performance(
        performer_name="Original Performer",
        performance_type="Solo",
        song_title="Song Alpha"
    )
    entry2 = db_service.create_performance(
        performer_name="Someone Else",
        partner_name="Original Performer",
        performance_type="Duet",
        song_title="Song Beta"
    )
    entry_collision = db_service.create_performance(
        performer_name="Existing Collide",
        performance_type="Solo",
        song_title="Song Gamma"
    )

    try:
        # 1. Test collision rejection via API
        res_collision = client.put(
            "/api/performer/rename",
            json={"old_name": "Original Performer", "new_name": "Existing Collide"}
        )
        assert res_collision.status_code == 400
        assert "already registered" in res_collision.json()["detail"]

        # 2. Test invalid length
        res_short = client.put(
            "/api/performer/rename",
            json={"old_name": "Original Performer", "new_name": "A"}
        )
        assert res_short.status_code == 400

        # 3. Test successful rename
        res_ok = client.put(
            "/api/performer/rename",
            json={"old_name": "Original Performer", "new_name": "Renamed Performer"}
        )
        assert res_ok.status_code == 200
        data = res_ok.json()
        assert data["status"] == "success"
        assert data["new_name"] == "Renamed Performer"

        # Verify in DB: entry1 performer_name updated
        p1 = db_service.get_performance(entry1)
        assert p1["performer_name"] == "Renamed Performer"

        # Verify in DB: entry2 partner_name updated
        p2 = db_service.get_performance(entry2)
        assert p2["partner_name"] == "Renamed Performer"

        # 4. Check existing_songs in signup config
        res_cfg = client.get("/api/signup/config")
        assert res_cfg.status_code == 200
        cfg = res_cfg.json()
        assert "existing_songs" in cfg
        song_titles = [s["song_title"] for s in cfg["existing_songs"]]
        assert "Song Alpha" in song_titles

    finally:
        # Clean up
        db_service.delete_performance(entry1)
        db_service.delete_performance(entry2)
        db_service.delete_performance(entry_collision)


def test_signup_enable_disable_toggle(client):
    from app.config import settings
    headers = {"X-Admin-PIN": settings.admin_pin}

    try:
        # 1. Disable signup via admin API
        res = client.put("/api/admin/signup-toggle", json={"enabled": False}, headers=headers)
        assert res.status_code == 200
        assert res.json()["enabled"] is False

        # 2. Check signup config reflects disabled
        res_cfg = client.get("/api/signup/config")
        assert res_cfg.status_code == 200
        assert res_cfg.json()["signup_enabled"] is False

        # 3. Attempt signup while disabled
        signup_payload = {
            "performer_name": "Late Bird",
            "contact_info": "late@example.com",
            "age_group": "Senior",
            "performances": [
                {"performance_type": "Solo", "song_title": "Late Song"}
            ]
        }
        res_signup = client.post("/api/signup", json=signup_payload)
        assert res_signup.status_code == 400
        assert "sign-ups for this event are currently closed" in res_signup.json()["detail"]

        # 4. Re-enable signup
        res_on = client.put("/api/admin/signup-toggle", json={"enabled": True}, headers=headers)
        assert res_on.status_code == 200
        assert res_on.json()["enabled"] is True

        res_cfg2 = client.get("/api/signup/config")
        assert res_cfg2.status_code == 200
        assert res_cfg2.json()["signup_enabled"] is True

        # 5. Attempt signup while enabled -> succeeds
        res_signup2 = client.post("/api/signup", json=signup_payload)
        assert res_signup2.status_code == 200
        assert res_signup2.json()["status"] == "success"

        # Cleanup created performance
        for p in db_service.get_all_performances():
            if p["performer_name"] == "Late Bird":
                db_service.delete_performance(p["entry_id"])

    finally:
        # Ensure signup is left enabled
        client.put("/api/admin/signup-toggle", json={"enabled": True}, headers=headers)
