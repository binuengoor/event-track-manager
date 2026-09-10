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
