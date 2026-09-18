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


def test_admin_food_claim_and_rename_cascade(client):
    import uuid
    from app.services.db_service import db_service

    uid = uuid.uuid4().hex[:6]
    # 1. Create a food group and item
    res_g = client.post("/api/admin/food-groups", json={"name": f"Desserts {uid}"})
    group_id = res_g.json()["group_id"]
    res_i = client.post("/api/admin/food-items", json={"name": f"Gulab Jamun {uid}", "group_id": group_id})
    item_id = res_i.json()["item_id"]

    # 2. Admin directly assigns to a non-participant attendee "Subin Attendee"
    res_claim = client.put(f"/api/admin/food-items/{item_id}", json={
        "signer_name": f"Subin Attendee {uid}",
        "signer_phone": "2155551234",
        "dish_description": "25 pcs"
    })
    assert res_claim.status_code == 200
    fs = db_service.get_food_signup_for_signer(f"Subin Attendee {uid}")
    assert fs is not None
    assert fs["signer_phone"] == "2155551234"

    # 3. Rename non-participant: only food signup should update
    res_ren = client.put(f"/api/admin/food-items/{item_id}", json={
        "signer_name": f"Subin NewName {uid}",
        "signer_phone": "2155551234"
    })
    assert res_ren.status_code == 200
    fs_updated = db_service.get_food_signup_for_signer(f"Subin NewName {uid}")
    assert fs_updated is not None
    assert db_service.get_food_signup_for_signer(f"Subin Attendee {uid}") is None

    # 4. Now test with a stage performer: rename cascades to performances
    entry_id = db_service.create_performance(
        performer_name=f"Singer Rahul {uid}",
        performance_type="Solo",
        song_title="Test Song",
        age_group="Senior",
        created_via="signup"
    )
    # Assign food item to Singer Rahul
    client.put(f"/api/admin/food-items/{item_id}", json={
        "signer_name": f"Singer Rahul {uid}",
        "signer_phone": "2155559999"
    })
    # Admin updates name on food to "Rahul Sharma"
    res_ren_perf = client.put(f"/api/admin/food-items/{item_id}", json={
        "signer_name": f"Rahul Sharma {uid}",
        "signer_phone": "2155559999"
    })
    assert res_ren_perf.status_code == 200

    # Performer record in SQLite must have been renamed to "Rahul Sharma"
    p_row = db_service.get_performance(entry_id)
    assert p_row["performer_name"] == f"Rahul Sharma {uid}"

    # 5. Release claim
    res_rel = client.put(f"/api/admin/food-items/{item_id}", json={"release_claim": True})
    assert res_rel.status_code == 200
    assert db_service.get_food_signup_for_signer(f"Rahul Sharma {uid}") is None


def test_family_food_sharing_and_unlinking(client):
    import uuid
    from app.services.db_service import db_service

    uid = uuid.uuid4().hex[:6]
    # Create food item
    res_g = client.post("/api/admin/food-groups", json={"name": f"Rice Items {uid}"})
    group_id = res_g.json()["group_id"]
    res_i = client.post("/api/admin/food-items", json={"name": f"Kerala Biryani {uid}", "group_id": group_id})
    item_id = res_i.json()["item_id"]

    p1_name = f"Parent Singer {uid}"
    p2_name = f"Child Singer {uid}"

    # Create two family performers
    p1_id = db_service.create_performance(
        performer_name=p1_name,
        performance_type="Solo",
        song_title="Song 1",
        age_group="Senior",
        contact_info="2155550001",
        created_via="signup"
    )
    p2_id = db_service.create_performance(
        performer_name=p2_name,
        performance_type="Solo",
        song_title="Song 2",
        age_group="Junior",
        guardian_name=p1_name,
        guardian_phone="2155550001",
        created_via="signup"
    )

    # 1. Assign Parent Singer to food item via admin participant edit
    res_link1 = client.put(f"/api/admin/participants/{p1_id}", json={
        "food_item_id": item_id
    })
    assert res_link1.status_code == 200

    fs1 = db_service.get_food_signup_for_signer(p1_name)
    assert fs1 is not None
    assert fs1["item_id"] == item_id
    assert fs1["signer_name"] == p1_name

    # 2. Assign Child Singer to same already-claimed food item (family sharing)
    res_link2 = client.put(f"/api/admin/participants/{p2_id}", json={
        "food_item_id": item_id
    })
    assert res_link2.status_code == 200

    # Food item signer_name should now contain both signers
    all_items = db_service.get_all_food_items_with_signups()
    claimed = next(i for i in all_items if i["item_id"] == item_id)
    assert p1_name in claimed["signer_name"]
    assert p2_name in claimed["signer_name"]
    assert "&" in claimed["signer_name"]

    # Both performers can find their food signup
    assert db_service.get_food_signup_for_signer(p1_name) is not None
    assert db_service.get_food_signup_for_signer(p2_name) is not None

    # Admin participants list displays the food signup for both
    res_parts = client.get("/api/admin/participants")
    assert res_parts.status_code == 200
    parts_data = res_parts.json()
    p1_data = next(p for p in parts_data if p["entry_id"] == p1_id)
    p2_data = next(p for p in parts_data if p["entry_id"] == p2_id)
    assert p1_data["food_signup"]["item_id"] == item_id
    assert p2_data["food_signup"]["item_id"] == item_id

    # 3. Unlink Child Singer: Parent Singer should remain the sole signer
    res_unlink = client.put(f"/api/admin/participants/{p2_id}", json={
        "food_item_id": ""
    })
    assert res_unlink.status_code == 200

    all_items_after = db_service.get_all_food_items_with_signups()
    claimed_after = next(i for i in all_items_after if i["item_id"] == item_id)
    assert claimed_after["signer_name"] == p1_name
    assert db_service.get_food_signup_for_signer(p2_name) is None
    assert db_service.get_food_signup_for_signer(p1_name) is not None
