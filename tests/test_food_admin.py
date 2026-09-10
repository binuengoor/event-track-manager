import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings

@pytest.fixture
def client():
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    return c

def test_admin_food_groups_and_items_crud(client):
    # 1. Create a group
    res_g = client.post("/api/admin/food-groups", json={"name": "Special Drinks"})
    assert res_g.status_code == 200
    group_id = res_g.json()["group_id"]

    # 2. Create an item in the group
    res_i = client.post("/api/admin/food-items", json={"name": "Mango Lassi", "group_id": group_id})
    assert res_i.status_code == 200
    item_id = res_i.json()["item_id"]

    # 3. Attempt to delete group with items -> 400 blocked
    del_g_fail = client.delete(f"/api/admin/food-groups/{group_id}")
    assert del_g_fail.status_code == 400
    assert "items" in del_g_fail.json()["detail"].lower()

    # 4. Edit item
    res_edit_i = client.put(f"/api/admin/food-items/{item_id}", json={"name": "Sweet Mango Lassi"})
    assert res_edit_i.status_code == 200

    # 5. Delete item
    del_i = client.delete(f"/api/admin/food-items/{item_id}")
    assert del_i.status_code == 200

    # 6. Now delete empty group -> success
    del_g_ok = client.delete(f"/api/admin/food-groups/{group_id}")
    assert del_g_ok.status_code == 200

def test_admin_food_toggle_and_serving_note(client):
    # Serving note update
    res_note = client.put("/api/admin/food-serving-note", json={"text": "Bring 20 servings in foil tray"})
    assert res_note.status_code == 200
    assert res_note.json()["status"] == "success"

    # Check via public signup config
    cfg_res = client.get("/api/signup/config")
    assert cfg_res.status_code == 200
    assert cfg_res.json()["food_serving_note"] == "Bring 20 servings in foil tray"

    # Food toggle
    res_toggle = client.put("/api/admin/food-toggle", json={"enabled": False})
    assert res_toggle.status_code == 200
    assert res_toggle.json()["status"] == "success"

    cfg_res2 = client.get("/api/signup/config")
    assert cfg_res2.json()["food_signup_enabled"] is False

    # Restore food toggle
    client.put("/api/admin/food-toggle", json={"enabled": True})
