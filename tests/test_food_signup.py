import pytest
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.services.db_service import db_service

@pytest.fixture
def client():
    return TestClient(app)

def test_food_claim_update_release(client):
    uid = uuid.uuid4().hex[:6]
    signer = f"Foodie Tester {uid}"
    dish_name = f"Test Samosa Dish {uid}"
    # Ensure a fresh item exists
    group_id = db_service.add_food_group(f"Test Food Group {uid}")
    item_id = db_service.add_food_item(dish_name, group_id)

    # 1. Claim food item
    claim_payload = {
        "signer_name": signer,
        "item_id": item_id,
        "dish_description": "Crispy Veggie Samosas"
    }
    res = client.post("/api/signup/food", json=claim_payload)
    assert res.status_code == 200
    signup_data = res.json()
    assert signup_data["status"] == "success"
    signup_id = signup_data["signup_id"]

    # 2. Race condition: Another user attempts to claim the same item -> 409
    res_conflict = client.post("/api/signup/food", json={
        "signer_name": f"Late Foodie {uid}",
        "item_id": item_id,
        "dish_description": "Duplicate attempt"
    })
    assert res_conflict.status_code == 409

    # 3. Check performer profile returns the claimed food item
    prof_res = client.get(f"/api/performer/profile?name={signer}")
    assert prof_res.status_code == 200
    prof_data = prof_res.json()
    assert prof_data["food_signup"] is not None
    assert prof_data["food_signup"]["item_name"] == dish_name
    assert prof_data["food_signup"]["dish_description"] == "Crispy Veggie Samosas"

    # 4. Update food signup dish description
    update_res = client.put(f"/api/signup/food/{signup_id}", json={
        "item_id": item_id,
        "dish_description": "Spicy Potato Samosas"
    })
    assert update_res.status_code == 200
    assert update_res.json()["status"] == "success"

    # 5. Release food signup
    del_res = client.delete(f"/api/signup/food/{signup_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "success"

    # 6. Performer profile now has no food signup
    prof_res2 = client.get(f"/api/performer/profile?name={signer}")
    assert prof_res2.status_code == 200
    assert prof_res2.json()["food_signup"] is None

    # Clean up
    db_service.delete_food_item(item_id, force=True)
    db_service.delete_food_group(group_id)

def test_sync_food_from_sheet(client):
    sheet_sample = [
        ["Serving Portion :\nPlease plan based on Attendance"],
        ["Food Item Type", "Name of Singer/Parent/Family", "Food Description"],
        ["Sync Test Veg Appetizer 99", "", ""],
        ["Sync Test Non-Veg Appetizer 99", "Subin Sugunan", "Chicken Fry"],
        ["Sync Test Veg Pulav 99", "Ishan (Sarina)", ""],
        ["Sync Test Dessert 99", "", ""]
    ]
    db_service.sync_food_from_sheet(sheet_sample, serving_portion_note="Plan for 50 people")

    # Verify items were created and categorized
    all_items = db_service.get_all_food_items_with_signups()
    item_names = {it["name"] for it in all_items}
    assert "Sync Test Veg Appetizer 99" in item_names
    assert "Sync Test Non-Veg Appetizer 99" in item_names
    assert "Sync Test Veg Pulav 99" in item_names
    assert "Sync Test Dessert 99" in item_names

    # Verify claimed signups
    non_veg_app = next(it for it in all_items if it["name"] == "Sync Test Non-Veg Appetizer 99")
    assert non_veg_app["is_taken"] is True
    assert non_veg_app["signer_name"] == "Subin Sugunan"
    assert non_veg_app["dish_description"] == "Chicken Fry"
    assert non_veg_app["group_name"] == "Appetizers"

    # Verify open item
    veg_app = next(it for it in all_items if it["name"] == "Sync Test Veg Appetizer 99")
    assert veg_app["is_taken"] is False

    # Verify serving note
    note = db_service.get_app_setting("food_serving_note")
    assert note == "Plan for 50 people"


