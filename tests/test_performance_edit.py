import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_edit_performance_details(client):
    import uuid
    ename = f"Edit Test Singer {uuid.uuid4().hex[:6]}"
    # 1. Create a performance via signup
    payload = {
        "performer_name": ename,
        "contact_info": "555-444-5555",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Solo",
                "song_title": "Original Title"
            }
        ]
    }
    signup_res = client.post("/api/signup", json=payload)
    assert signup_res.status_code == 200
    entry_id = signup_res.json()["entry_ids"][0]

    # 2. Update song title and details
    update_payload = {
        "song_title": "Updated Brand New Title",
        "partner_name": "New Partner"
    }
    put_res = client.put(f"/api/signup/performance/{entry_id}", json=update_payload)
    assert put_res.status_code == 200
    data = put_res.json()
    assert data["status"] == "success"

    # 3. Check /api/performances reflects the update
    all_res = client.get("/api/performances")
    assert all_res.status_code == 200
    found = [p for p in all_res.json() if p["entry_id"] == entry_id]
    assert len(found) == 1
    assert found[0]["song_title"] == "Updated Brand New Title"
    assert found[0]["partner_name"] == "New Partner"


def test_edit_performance_respects_solo_limit(client):
    import uuid
    from app.services.db_service import db_service
    db_service.set_app_setting("max_solo_per_participant", "1")
    db_service.set_app_setting("max_performances_per_participant", "2")
    pname = f"Solo Limit Tester {uuid.uuid4().hex[:6]}"
    res = client.post("/api/signup", json={
        "performer_name": pname,
        "contact_info": "555-111-2222",
        "age_group": "Senior",
        "performances": [
            {"performance_type": "Solo", "song_title": "Solo Song"},
            {"performance_type": "Duet", "song_title": "Duet Song", "partner_name": "Partner One", "partner_phone": "555-222-3333"}
        ]
    })
    assert res.status_code == 200
    duet_id = res.json()["entry_ids"][1]

    # Attempt to switch the duet to a second solo
    edit_res = client.put(f"/api/signup/performance/{duet_id}", json={"performance_type": "Solo"})
    assert edit_res.status_code == 400
    assert "Solo limit exceeded" in edit_res.json()["detail"]


def test_edit_performance_respects_partner_max_performances(client):
    import uuid
    from app.services.db_service import db_service
    db_service.set_app_setting("max_performances_per_participant", "2")
    busy_partner = f"Busy Partner {uuid.uuid4().hex[:6]}"
    res1 = client.post("/api/signup", json={
        "performer_name": busy_partner,
        "contact_info": "555-333-4444",
        "age_group": "Senior",
        "performances": [
            {"performance_type": "Solo", "song_title": "Busy Song 1"},
            {"performance_type": "Duet", "song_title": "Busy Song 2", "partner_name": "Friend", "partner_phone": "555-999-0000"}
        ]
    })
    assert res1.status_code == 200

    other_performer = f"Other Singer {uuid.uuid4().hex[:6]}"
    res2 = client.post("/api/signup", json={
        "performer_name": other_performer,
        "contact_info": "555-555-6666",
        "age_group": "Senior",
        "performances": [
            {"performance_type": "Solo", "song_title": "Other Song"}
        ]
    })
    assert res2.status_code == 200
    other_id = res2.json()["entry_ids"][0]

    # Attempt to add busy_partner as duet partner, exceeding their max performances
    edit_res = client.put(f"/api/signup/performance/{other_id}", json={
        "performance_type": "Duet",
        "partner_name": busy_partner
    })
    assert edit_res.status_code == 400
    assert "Registration exceeds limit" in edit_res.json()["detail"]
