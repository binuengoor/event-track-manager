import uuid
import json
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

def test_db_service_log_activity_and_query():
    uid = uuid.uuid4().hex[:6]
    name = f"Audit Performer {uid}"
    
    log_id = db_service.log_activity(
        action_type="test_action",
        performer_name=name,
        summary=f"Test summary for {name}",
        details=json.dumps({"field": "val", "uid": uid}),
        source="unit_test"
    )
    assert log_id.startswith("act_")

    # Fetch logs with days and search filter
    logs = db_service.get_activity_logs(days=1, search=uid)
    assert len(logs) >= 1
    found = next((l for l in logs if l["log_id"] == log_id), None)
    assert found is not None
    assert found["action_type"] == "test_action"
    assert found["performer_name"] == name
    assert found["source"] == "unit_test"

def test_admin_activity_logs_api(client):
    uid = uuid.uuid4().hex[:6]
    name = f"API Performer {uid}"

    db_service.log_activity(
        action_type="song_update",
        performer_name=name,
        summary=f"Updated song for {name}",
        details=json.dumps({"song": "New Song"}),
        source="performer_hub"
    )

    res = client.get(f"/api/admin/activity-logs?days=1&search={uid}")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert any(item["performer_name"] == name for item in data)

def test_potluck_only_signup_creates_activity_log(client):
    uid = uuid.uuid4().hex[:6]
    signer_name = f"Binish George Test {uid}"
    group_id = db_service.add_food_group(f"Rice Group {uid}")
    item_id = db_service.add_food_item(f"Veg Fried Rice {uid}", group_id)

    payload = {
        "performer_name": signer_name,
        "contact_info": "555-444-1212",
        "registration_type": "food_only",
        "performances": [],
        "food_signup": {
            "item_id": item_id,
            "dish_description": "" # Optional dish description!
        }
    }

    res = client.post("/api/signup", json=payload)
    assert res.status_code == 200, f"Signup failed: {res.text}"
    data = res.json()
    assert data["status"] == "success"
    assert data["registration_type"] == "food_only"

    # Verify activity log was recorded
    logs = db_service.get_activity_logs(days=1, search=signer_name)
    assert len(logs) >= 1
    signup_log = next((l for l in logs if l["action_type"] == "signup"), None)
    assert signup_log is not None
    assert signup_log["performer_name"] == signer_name
    assert "Veg Fried Rice" in signup_log["summary"]

def test_performer_rename_creates_activity_log(client):
    uid = uuid.uuid4().hex[:6]
    old_name = f"Old Name {uid}"
    new_name = f"New Name {uid}"

    # First add a performance for old_name
    entry_id = db_service.create_performance(
        performer_name=old_name,
        performance_type="Solo",
        song_title="Test Song"
    )

    # Call rename endpoint
    rename_res = client.put("/api/performer/rename", json={
        "old_name": old_name,
        "new_name": new_name
    })
    assert rename_res.status_code == 200
    assert rename_res.json()["status"] == "success"

    # Check activity log
    logs = db_service.get_activity_logs(days=1, search=new_name)
    rename_log = next((l for l in logs if l["action_type"] == "rename"), None)
    assert rename_log is not None
    assert rename_log["performer_name"] == new_name
    assert old_name in rename_log["summary"]
