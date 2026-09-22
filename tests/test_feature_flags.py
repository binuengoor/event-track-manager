import pytest
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.services.db_service import db_service

@pytest.fixture
def admin_client():
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    return c

@pytest.fixture
def client():
    return TestClient(app)

def test_apply_presets(admin_client):
    # 1. Apply Acoustic Preset
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "acoustic"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["preset"] == "acoustic"

    # Verify DB settings
    settings_data = admin_client.get("/api/admin/settings").json()
    assert settings_data["track_upload_enabled"] is False or settings_data["track_upload_enabled"] == "false"
    assert settings_data["food_signup_enabled"] is True or settings_data["food_signup_enabled"] == "true"

    # 2. Apply Solo Competition Preset
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "competition"})
    assert res.status_code == 200
    settings_data = admin_client.get("/api/admin/settings").json()
    assert settings_data["allow_duets"] is False or settings_data["allow_duets"] == "false"

    # 3. Apply Freeze Preset
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "freeze"})
    assert res.status_code == 200
    settings_data = admin_client.get("/api/admin/settings").json()
    assert settings_data["signup_enabled"] is False or settings_data["signup_enabled"] == "false"
    assert settings_data["performer_edits_enabled"] is False or settings_data["performer_edits_enabled"] == "false"

    # 4. Invalid preset returns 400
    bad_res = admin_client.post("/api/admin/apply-preset", json={"preset": "non_existent_preset"})
    assert bad_res.status_code == 400

    # 5. Restore Musical Night Preset
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "musical_night"})
    assert res.status_code == 200
    settings_data = admin_client.get("/api/admin/settings").json()
    assert settings_data["signup_enabled"] is True or settings_data["signup_enabled"] == "true"
    assert settings_data["track_upload_enabled"] is True or settings_data["track_upload_enabled"] == "true"
    assert settings_data["allow_duets"] is True or settings_data["allow_duets"] == "true"
    assert settings_data["performer_edits_enabled"] is True or settings_data["performer_edits_enabled"] == "true"

def test_track_upload_disabled_guard(admin_client, client):
    # Disable track upload
    admin_client.put("/api/admin/settings", json={"settings": {"track_upload_enabled": "false"}})

    # Attempt to upload track
    fake_file = ("test.mp3", b"dummy mp3 content", "audio/mpeg")
    res = client.post("/api/upload", data={"entry_id": "test-entry-123"}, files={"file": fake_file})
    assert res.status_code == 400
    assert "Backing track uploads are currently disabled" in res.json()["detail"]

    # Re-enable track upload
    admin_client.put("/api/admin/settings", json={"settings": {"track_upload_enabled": "true"}})

def test_duets_disabled_guard(admin_client, client):
    # Disable duets
    admin_client.put("/api/admin/settings", json={"settings": {"allow_duets": "false"}})

    # Attempt duet signup
    pname = f"Duet Primary {uuid.uuid4().hex[:6]}"
    payload = {
        "performer_name": pname,
        "contact_info": "555-111-9999",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Duet",
                "song_title": "Duet Song",
                "participant2_name": "Partner Singer"
            }
        ]
    }
    res = client.post("/api/signup", json=payload)
    assert res.status_code == 400
    assert "Duet and group performances are currently disabled" in res.json()["detail"]

    # Re-enable duets
    admin_client.put("/api/admin/settings", json={"settings": {"allow_duets": "true"}})

def test_performer_edits_disabled_guard(admin_client, client):
    # First, create a valid performance while enabled
    admin_client.put("/api/admin/settings", json={
        "settings": {
            "signup_enabled": "true",
            "performer_edits_enabled": "true"
        }
    })
    pname = f"Edit Test Performer {uuid.uuid4().hex[:6]}"
    signup_payload = {
        "performer_name": pname,
        "contact_info": "555-222-3333",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Solo",
                "song_title": "Initial Song Title"
            }
        ]
    }
    signup_res = client.post("/api/signup", json=signup_payload)
    assert signup_res.status_code == 200
    entry_id = signup_res.json()["entry_ids"][0]

    # Disable performer edits
    admin_client.put("/api/admin/settings", json={"settings": {"performer_edits_enabled": "false"}})

    # 1. Test PUT /api/signup/performance/{entry_id}
    put_res = client.put(f"/api/signup/performance/{entry_id}", json={
        "song_title": "Updated Song Title"
    })
    assert put_res.status_code == 400
    assert "Performer self-service editing is currently locked" in put_res.json()["detail"]

    # 2. Test POST /api/performer/performances
    post_res = client.post("/api/performer/performances", json={
        "performer_name": pname,
        "song_title": "Another Song"
    })
    assert post_res.status_code == 400
    assert "Performer self-service editing is currently locked" in post_res.json()["detail"]

    # 3. Test PUT /api/performer/rename
    rename_res = client.put("/api/performer/rename", json={
        "old_name": pname,
        "new_name": f"Renamed {pname}"
    })
    assert rename_res.status_code == 400
    assert "Performer self-service editing is currently locked" in rename_res.json()["detail"]

    # Re-enable performer edits
    admin_client.put("/api/admin/settings", json={"settings": {"performer_edits_enabled": "true"}})

def test_dashboard_disabled_guard(admin_client, client):
    # Disable dashboard
    admin_client.put("/api/admin/settings", json={"settings": {"dashboard_enabled": "false"}})

    res = client.get("/api/dashboard/performances")
    assert res.status_code == 200
    assert res.json() == []

    # Re-enable dashboard
    admin_client.put("/api/admin/settings", json={"settings": {"dashboard_enabled": "true"}})
    res_enabled = client.get("/api/dashboard/performances")
    assert res_enabled.status_code == 200

def test_payment_toggle_and_event_info(admin_client, client):
    # Disable payments
    admin_client.put("/api/admin/settings", json={
        "settings": {
            "payment_enabled": "false",
            "payment_url": "https://paypal.me/test"
        }
    })
    res = client.get("/api/event-info")
    assert res.status_code == 200
    data = res.json()
    assert data["payment_enabled"] is False
    assert data["payment_url"] == ""

    # Enable payments
    admin_client.put("/api/admin/settings", json={
        "settings": {
            "payment_enabled": "true",
            "payment_url": "https://paypal.me/test"
        }
    })
    res2 = client.get("/api/event-info")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["payment_enabled"] is True
    assert data2["payment_url"] == "https://paypal.me/test"

def test_potluck_preset_signup_flow(admin_client, client):
    # 1. Apply Potluck Preset
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "potluck"})
    assert res.status_code == 200

    # Verify settings: performance signup is disabled, food signup is enabled
    settings_data = admin_client.get("/api/admin/settings").json()
    assert settings_data["signup_enabled"] is False or settings_data["signup_enabled"] == "false"
    assert settings_data["food_signup_enabled"] is True or settings_data["food_signup_enabled"] == "true"

    # Verify public /api/signup/config reflects this
    cfg = client.get("/api/signup/config").json()
    assert cfg["signup_enabled"] is False
    assert cfg["food_signup_enabled"] is True

    # 2. Submitting a performance should be rejected
    pname = f"Performer Attempt {uuid.uuid4().hex[:6]}"
    perf_payload = {
        "performer_name": pname,
        "contact_info": "555-000-1111",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Solo",
                "song_title": "Blocked Performance"
            }
        ]
    }
    perf_res = client.post("/api/signup", json=perf_payload)
    assert perf_res.status_code == 400
    assert "sign-ups for this event are currently closed" in perf_res.json()["detail"]

    # 3. Submitting an attendee/food-only registration should SUCCEED
    group_id = db_service.add_food_group(f"Potluck Group {uuid.uuid4().hex[:6]}")
    item_id = db_service.add_food_item(f"Potluck Curry {uuid.uuid4().hex[:4]}", group_id)

    attendee_name = f"Potluck Guest {uuid.uuid4().hex[:6]}"
    food_payload = {
        "registration_type": "food_only",
        "performer_name": attendee_name,
        "contact_info": "555-999-8888",
        "performances": [],
        "food_signup": {
            "item_id": item_id,
            "dish_description": "Spicy Biryani"
        }
    }
    food_res = client.post("/api/signup", json=food_payload)
    assert food_res.status_code == 200, food_res.text
    data = food_res.json()
    assert data["status"] == "success"
    assert data["registration_type"] == "food_only"
    assert data["performer_name"] == attendee_name
    assert data["food_signup_id"] is not None

    # 4. Switch to Solo Competition preset (Food disabled, performance enabled)
    comp_res = admin_client.post("/api/admin/apply-preset", json={"preset": "competition"})
    assert comp_res.status_code == 200

    # Attendee food-only signup should now be blocked
    food_blocked_res = client.post("/api/signup", json=food_payload)
    assert food_blocked_res.status_code == 400
    assert "Potluck food sign-up is currently disabled" in food_blocked_res.json()["detail"]

    # 5. Restore default Musical Night Preset
    admin_client.post("/api/admin/apply-preset", json={"preset": "musical_night"})

def test_all_presets_and_effective_behavior(admin_client, client):
    """Deep verification of all 5 presets and their live behavioral consequences across all endpoints."""
    # 1. MUSICAL NIGHT (Full Event)
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "musical_night"})
    assert res.status_code == 200
    info = client.get("/api/event-info").json()
    assert info["signup_enabled"] is True
    assert info["food_signup_enabled"] is True
    assert info["track_upload_enabled"] is True
    assert info["allow_duets"] is True
    assert info["performer_edits_enabled"] is True
    assert info["live_display_enabled"] is True
    assert info["dashboard_enabled"] is True

    live = client.get("/api/live-status").json()
    assert live["live_display_enabled"] is True

    # 2. ACOUSTIC / LIVE BAND (No Backing Tracks)
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "acoustic"})
    assert res.status_code == 200
    info = client.get("/api/event-info").json()
    assert info["track_upload_enabled"] is False
    assert info["signup_enabled"] is True
    assert info["food_signup_enabled"] is True

    # Backing track upload rejected
    upload_res = client.post("/api/upload", data={"entry_id": "any-id"}, files={"file": ("track.mp3", b"test", "audio/mpeg")})
    assert upload_res.status_code == 400
    assert "Backing track uploads are currently disabled" in upload_res.json()["detail"]

    # 3. SOLO COMPETITION (No Duets, No Food, Private Setlist)
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "competition"})
    assert res.status_code == 200
    info = client.get("/api/event-info").json()
    assert info["allow_duets"] is False
    assert info["food_signup_enabled"] is False
    assert info["dashboard_enabled"] is False

    # Solo sign-up succeeds in competition mode
    pname = f"Comp Solo {uuid.uuid4().hex[:6]}"
    solo_res = client.post("/api/signup", json={
        "performer_name": pname,
        "contact_info": "555-444-3333",
        "age_group": "Senior",
        "performances": [{"performance_type": "Solo", "song_title": "Solo Song"}]
    })
    assert solo_res.status_code == 200

    # Duets rejected
    duet_res = client.post("/api/signup", json={
        "performer_name": f"Duet {uuid.uuid4().hex[:6]}",
        "contact_info": "555-444-3334",
        "age_group": "Senior",
        "performances": [{"performance_type": "Duet", "song_title": "Duet", "partner_name": "Partner"}]
    })
    assert duet_res.status_code == 400
    assert "Duet and group performances are currently disabled" in duet_res.json()["detail"]

    # Dashboard setlist empty/hidden
    assert client.get("/api/dashboard/performances").json() == []

    # 4. POTLUCK (Community Food Only, No Stage Performances)
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "potluck"})
    assert res.status_code == 200
    info = client.get("/api/event-info").json()
    assert info["stage_performances_enabled"] is False
    assert info["console_enabled"] is False
    assert info["signup_enabled"] is False
    assert info["food_signup_enabled"] is True
    assert info["live_display_enabled"] is False
    assert info["track_upload_enabled"] is False
    assert info["performer_edits_enabled"] is False

    live = client.get("/api/live-status").json()
    assert live["live_display_enabled"] is False

    # Performer profile suppresses songs when stage performances are disabled
    profile = client.get(f"/api/performer/profile?name={pname}").json()
    assert profile["stage_performances_enabled"] is False
    assert profile["performances"] == []
    assert profile["other_songs"] == []

    # Names endpoint returns registered participant names
    names = client.get("/api/performer/names").json()
    assert isinstance(names, list)
    assert pname in names

    # 5. EVENT-DAY FREEZE (All Registrations and Self-Edits Locked)
    res = admin_client.post("/api/admin/apply-preset", json={"preset": "freeze"})
    assert res.status_code == 200
    info = client.get("/api/event-info").json()
    assert info["signup_enabled"] is False
    assert info["performer_edits_enabled"] is False

    # Rename performer locked
    rename_res = client.put("/api/performer/rename", json={"old_name": pname, "new_name": "New Name"})
    assert rename_res.status_code == 400
    assert "Performer self-service editing is currently locked" in rename_res.json()["detail"]

    # 6. RESTORE DEFAULT
    admin_client.post("/api/admin/apply-preset", json={"preset": "musical_night"})


