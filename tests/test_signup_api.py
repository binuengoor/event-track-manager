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
