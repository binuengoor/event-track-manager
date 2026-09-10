import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.db_service import db_service

@pytest.fixture
def client():
    return TestClient(app)

def test_signup_config(client):
    res = client.get("/api/signup/config")
    assert res.status_code == 200
    data = res.json()
    assert "age_groups" in data
    assert "performance_types" in data
    assert "max_performances_per_participant" in data
    assert "max_solo_per_participant" in data
    assert "food_signup_enabled" in data
    assert "food_groups" in data
    assert "food_items" in data

def test_signup_solo_success(client):
    import uuid
    pname = f"Solo Singer {uuid.uuid4().hex[:6]}"
    payload = {
        "performer_name": pname,
        "contact_info": "555-111-2222",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Solo",
                "song_title": "Nilaave Vaa"
            }
        ]
    }
    res = client.post("/api/signup", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert len(data["entry_ids"]) == 1

def test_signup_guardian_requirement(client):
    import uuid
    jname = f"Junior Singer {uuid.uuid4().hex[:6]}"
    # Junior requires guardian name and phone
    payload = {
        "performer_name": jname,
        "contact_info": "555-333-4444",
        "age_group": "Junior",
        "performances": [
            {
                "performance_type": "Solo",
                "song_title": "Twinkle Twinkle"
            }
        ]
    }
    res = client.post("/api/signup", json=payload)
    assert res.status_code == 400
    assert "Guardian" in res.json()["detail"]

    # Now provide guardian
    payload["guardian_name"] = "Parent Singer"
    payload["guardian_phone"] = "555-999-8888"
    res2 = client.post("/api/signup", json=payload)
    assert res2.status_code == 200
    assert res2.json()["status"] == "success"

def test_signup_max_performances_and_solo_limit(client):
    import uuid
    # Ensure settings are set to standard defaults (max_solo=1, max_perfs=2)
    db_service.set_app_setting("max_solo_per_participant", "1")
    db_service.set_app_setting("max_performances_per_participant", "2")

    # Attempting 2 solos in one submission
    greedy_name = f"Greedy Singer {uuid.uuid4().hex[:6]}"
    payload = {
        "performer_name": greedy_name,
        "contact_info": "555-000-1111",
        "age_group": "Senior",
        "performances": [
            {"performance_type": "Solo", "song_title": "Song One"},
            {"performance_type": "Solo", "song_title": "Song Two"}
        ]
    }
    res = client.post("/api/signup", json=payload)
    assert res.status_code == 400
    assert "Solo" in res.json()["detail"]

    # Attempting 3 performances
    super_greedy_name = f"Super Greedy {uuid.uuid4().hex[:6]}"
    payload_3 = {
        "performer_name": super_greedy_name,
        "contact_info": "555-000-2222",
        "age_group": "Senior",
        "performances": [
            {"performance_type": "Solo", "song_title": "Song 1"},
            {"performance_type": "Duet", "song_title": "Song 2", "partner_name": "Partner A"},
            {"performance_type": "Group", "song_title": "Song 3"}
        ]
    }
    res3 = client.post("/api/signup", json=payload_3)
    assert res3.status_code == 400
    assert "exceeds limit" in res3.json()["detail"]

def test_signup_duet_partner_age_group(client):
    import uuid
    pname = f"Duet Primary {uuid.uuid4().hex[:6]}"
    partner_name = f"Brand New Partner {uuid.uuid4().hex[:6]}"
    payload = {
        "performer_name": pname,
        "contact_info": "555-444-5555",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Duet",
                "partner_name": partner_name,
                "partner_age_group": "Junior",
                "song_title": "Aayiram Kannumai"
            }
        ]
    }
    res = client.post("/api/signup", json=payload)
    assert res.status_code == 200
    entry_id = res.json()["entry_ids"][0]

    # Verify directly from database
    perf = db_service.get_performance_by_id(entry_id)
    assert perf is not None
    assert perf["performer_name"] == pname
    assert perf["partner_name"] == partner_name
    assert perf["partner_age_group"] == "Junior"

    # Test auto-resolution of existing partner's age group when omitted
    another_pname = f"Another Singer {uuid.uuid4().hex[:6]}"
    payload_auto = {
        "performer_name": another_pname,
        "contact_info": "555-777-8888",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Duet",
                "partner_name": pname,  # pname was registered as Senior
                "song_title": "Sundari Neeyum"
            }
        ]
    }
    res_auto = client.post("/api/signup", json=payload_auto)
    assert res_auto.status_code == 200
    entry_id_auto = res_auto.json()["entry_ids"][0]
    perf_auto = db_service.get_performance_by_id(entry_id_auto)
    assert perf_auto["partner_name"] == pname
    assert perf_auto["partner_age_group"] == "Senior"

