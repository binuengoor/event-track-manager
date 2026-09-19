import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.services.db_service import db_service

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
        "contact_info": "555-222-3333",
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
        "partner_phone": "555-888-9999",
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

def test_admin_participants_duet_partner_food_and_edit(client):
    import uuid
    primary_name = f"Ryan Test {uuid.uuid4().hex[:4]}"
    partner_name = f"Rohan Test {uuid.uuid4().hex[:4]}"

    # Signup duet
    signup_payload = {
        "performer_name": primary_name,
        "contact_info": "484-340-7359",
        "age_group": "Junior",
        "guardian_name": "Parent Test",
        "guardian_phone": "484-340-7359",
        "performances": [
            {
                "performance_type": "Duet",
                "partner_name": partner_name,
                "partner_phone": "484-340-7359",
                "song_title": "Dil Ke Chain",
                "movie_name": "Aap Ki Kasam",
                "is_acoustic": False
            }
        ]
    }
    res = client.post("/api/signup", json=signup_payload)
    assert res.status_code == 200

    # Query admin participants
    res_parts = client.get("/api/admin/participants")
    assert res_parts.status_code == 200
    all_parts = res_parts.json()
    perf = next((p for p in all_parts if p["performer_name"] == primary_name), None)
    assert perf is not None
    assert perf["partner_name"] == partner_name
    assert "partner_food_signup" in perf

    # Update duet partner name via admin endpoint
    new_partner_name = f"{partner_name} Jr"
    put_res = client.put(f"/api/admin/participants/{perf['entry_id']}", json={
        "partner_name": new_partner_name
    })
    assert put_res.status_code == 200

    # Verify updated
    res_parts2 = client.get("/api/admin/participants")
    perf2 = next(p for p in res_parts2.json() if p["entry_id"] == perf["entry_id"])
    assert perf2["partner_name"] == new_partner_name

def test_duet_partner_does_not_inherit_primary_food(client):
    import uuid
    from app.services.db_service import db_service

    primary_name = f"Singer Primary {uuid.uuid4().hex[:4]}"
    partner_name = f"Singer Partner {uuid.uuid4().hex[:4]}"

    # Fetch an available food item to claim
    all_items = db_service.get_all_food_items_with_signups()
    open_item = next((it for it in all_items if not it["is_taken"]), None)
    food_payload = {"item_id": open_item["item_id"], "dish_description": "Family Dish"} if open_item else None

    # Signup primary with duet and food
    signup_payload = {
        "performer_name": primary_name,
        "contact_info": "484-555-0199",
        "age_group": "Senior",
        "food_signup": food_payload,
        "performances": [
            {
                "performance_type": "Duet",
                "partner_name": partner_name,
                "partner_phone": "484-555-0198",
                "song_title": "Duet Melody",
                "is_acoustic": False
            }
        ]
    }
    res = client.post("/api/signup", json=signup_payload)
    assert res.status_code == 200

    # Query admin participants
    parts = client.get("/api/admin/participants").json()
    primary_perf = next((p for p in parts if p["performer_name"] == primary_name), None)
    assert primary_perf is not None
    if open_item:
        assert primary_perf["food_signup"] is not None
        assert primary_perf["food_signup"]["item_id"] == open_item["item_id"]

    # Partner should NOT have primary's food in partner_food_signup
    assert primary_perf["partner_food_signup"] is None

    # Performer hub lookup for partner should be None for food
    partner_profile = client.get(f"/api/performer/profile?name={partner_name}").json()
    assert partner_profile["food_signup"] is None


def test_admin_summary_metrics(client):
    """Verifies that /api/admin/summary accurately calculates unique participants,
    distinguishes acts vs people, and counts duet partners."""
    # Register 1 junior solo
    res1 = client.post("/api/signup", json={
        "performer_name": "Kid One",
        "age_group": "Junior",
        "guardian_name": "Parent One",
        "guardian_phone": "555-111-0001",
        "performances": [{"performance_type": "Solo", "song_title": "Kid Song 1"}]
    })
    assert res1.status_code == 200

    # Register 1 junior duet with another junior partner
    res2 = client.post("/api/signup", json={
        "performer_name": "Kid Two",
        "age_group": "Junior",
        "guardian_name": "Parent Two",
        "guardian_phone": "555-111-0002",
        "performances": [{
            "performance_type": "Duet",
            "partner_name": "Kid Three",
            "partner_age_group": "Junior",
            "partner_phone": "555-111-0004",
            "song_title": "Kid Duet"
        }]
    })
    assert res2.status_code == 200

    # Register 1 senior solo
    res3 = client.post("/api/signup", json={
        "performer_name": "Adult One",
        "contact_info": "555-111-0003",
        "age_group": "Senior",
        "performances": [{"performance_type": "Solo", "song_title": "Adult Song 1"}]
    })
    assert res3.status_code == 200

    summary = client.get("/api/admin/summary").json()

    # Kid Three was only a partner, but must be counted in total_participants and juniors
    assert summary["total_participants"] >= 4
    assert summary["juniors"] >= 3  # Kid One, Kid Two, Kid Three
    assert summary["seniors"] >= 1  # Adult One
    assert summary["total_participants"] == summary["juniors"] + summary["seniors"]
    assert "junior_acts" in summary
    assert "senior_acts" in summary
    assert summary["junior_acts"] >= 2
    assert summary["senior_acts"] >= 1
    assert summary["total_performances"] == summary["junior_acts"] + summary["senior_acts"]
    assert summary["solo"] >= 2
    assert summary["duet"] >= 1


def test_admin_junior_duet_partner_food_inheritance(client):
    """Verifies that in /api/admin/participants, a junior duet partner inherits
    their guardian's food signup if they don't have their own individual food signup."""
    uid = uuid.uuid4().hex[:6]
    guardian_name = f"Parent Tina {uid}"
    child_primary = f"Ryan Child {uid}"
    child_partner = f"Rohan Child {uid}"

    group_id = db_service.add_food_group(f"Appetizers {uid}")
    item_id = db_service.add_food_item(f"Chicken 65 {uid}", group_id)

    # Guardian claims food
    db_service.claim_food_item(item_id, guardian_name, dish_description="Crispy Chicken")

    # Junior duet registered under guardian
    res = client.post("/api/signup", json={
        "performer_name": child_primary,
        "age_group": "Junior",
        "guardian_name": guardian_name,
        "guardian_phone": "555-444-3333",
        "performances": [{
            "performance_type": "Duet",
            "partner_name": child_partner,
            "partner_phone": "555-444-3333",
            "partner_age_group": "Junior",
            "song_title": "Family Duet"
        }]
    })
    assert res.status_code == 200

    parts = client.get("/api/admin/participants").json()
    perf = next(p for p in parts if p["performer_name"] == child_primary)

    # Primary child inherits guardian food
    assert perf["food_signup"] is not None
    assert perf["food_signup"]["item_id"] == item_id

    # Partner child also inherits guardian food in partner_food_signup
    assert perf["partner_food_signup"] is not None
    assert perf["partner_food_signup"]["item_id"] == item_id




