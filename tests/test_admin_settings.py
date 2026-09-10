import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings

@pytest.fixture
def client():
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    return c

def test_admin_settings_crud_and_live_override(client):
    # 1. Fetch settings
    res = client.get("/api/admin/settings")
    assert res.status_code == 200
    curr_settings = res.json()
    assert "event_name" in curr_settings

    # 2. Update event name and time range
    put_res = client.put("/api/admin/settings", json={
        "settings": {
            "event_name": "Test Paattukoottam 2026 Special",
            "time_range": "4:30 PM - 9:30 PM EDT"
        }
    })
    assert put_res.status_code == 200
    assert put_res.json()["status"] == "success"

    # 3. Check public /api/event-info immediately reflects new name without app restart
    pub_res = client.get("/api/event-info")
    assert pub_res.status_code == 200
    pub_data = pub_res.json()
    assert pub_data["event_name"] == "Test Paattukoottam 2026 Special"
    assert pub_data["time_range"] == "4:30 PM - 9:30 PM EDT"

    # 4. Summary stats
    summary_res = client.get("/api/admin/summary")
    assert summary_res.status_code == 200
    s_data = summary_res.json()
    assert "total_participants" in s_data
    assert "total_performances" in s_data
    assert "food_total" in s_data

def test_header_branding_character_limits(client):
    # Header title > 35 chars must fail
    res_bad_title = client.put("/api/admin/settings", json={
        "settings": {"header_brand_title": "A" * 36}
    })
    assert res_bad_title.status_code == 400
    assert "35 characters" in res_bad_title.json()["detail"]

    # Header subtitle > 45 chars must fail
    res_bad_sub = client.put("/api/admin/settings", json={
        "settings": {"header_brand_subtitle": "B" * 46}
    })
    assert res_bad_sub.status_code == 400
    assert "45 characters" in res_bad_sub.json()["detail"]

    # Valid header branding update
    res_ok = client.put("/api/admin/settings", json={
        "settings": {
            "header_brand_title": "EMA Paattukoottam",
            "header_brand_subtitle": "Musical Night"
        }
    })
    assert res_ok.status_code == 200

    # Verify reflected in /api/event-info
    info = client.get("/api/event-info").json()
    assert info["header_brand_title"] == "EMA Paattukoottam"
    assert info["header_brand_subtitle"] == "Musical Night"

def test_add_performance_flow(client):
    import uuid
    unique_name = f"Test Performer AddFlow {uuid.uuid4().hex[:6]}"
    # First create a test participant via /api/signup
    signup_payload = {
        "performer_name": unique_name,
        "contact_info": "test@test.com",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Solo",
                "song_title": "First Song",
                "movie_name": "Movie 1",
                "is_acoustic": False
            }
        ]
    }
    signup_res = client.post("/api/signup", json=signup_payload)
    assert signup_res.status_code == 200

    # Add 2nd performance as Duet
    add_payload = {
        "performer_name": unique_name,
        "performance_type": "Duet",
        "partner_name": "Test Partner",
        "song_title": "Second Duet Song",
        "movie_name": "Movie 2",
        "is_acoustic": True,
        "stage_notes": "Live violin"
    }
    add_res = client.post("/api/performer/performances", json=add_payload)
    assert add_res.status_code == 200
    assert add_res.json()["status"] == "success"
    new_entry_id = add_res.json()["entry_id"]

    # Verify 3rd performance is rejected (limit is 2)
    add_3rd_res = client.post("/api/performer/performances", json=add_payload)
    assert add_3rd_res.status_code == 400
    assert "Maximum performances limit" in add_3rd_res.json()["detail"]
