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
        "signer_phone": "6105551234",
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
        "signer_phone": "6105551235",
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
        "signer_name": signer,
        "signer_phone": "6105551234",
        "dish_description": "Spicy Potato Samosas"
    })
    assert update_res.status_code == 200
    assert update_res.json()["status"] == "success"

    # 5. Release food signup
    del_res = client.request("DELETE", f"/api/signup/food/{signup_id}", json={"signer_name": signer, "signer_phone": "6105551234"})
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "success"

    # 6. Performer profile now has no food signup
    prof_res2 = client.get(f"/api/performer/profile?name={signer}")
    assert prof_res2.status_code == 200
    assert prof_res2.json()["food_signup"] is None

    # Clean up
    db_service.delete_food_item(item_id, force=True)
    db_service.delete_food_group(group_id)

def test_smart_food_resolution_and_performer_rename(client):
    """Verifies that smart food lookup handles partial/parenthetical names and renames cascade."""
    # 1. Setup food groups and items
    gid = db_service.add_food_group("Test Smart Group")
    item1 = db_service.add_food_item("Item Binu", gid)
    item2 = db_service.add_food_item("Item Ishan", gid)
    item3 = db_service.add_food_item("Item Reema", gid)
    item4 = db_service.add_food_item("Item Dhyan", gid)

    # Claim them with various realistic name formats
    client.post("/api/signup/food", json={"signer_name": "Binu", "signer_phone": "6105551234", "item_id": item1, "dish_description": "Shrimp"})
    client.post("/api/signup/food", json={"signer_name": "Ishan (Sarina)", "signer_phone": "6105551234", "item_id": item2, "dish_description": "Pulav"})
    client.post("/api/signup/food", json={"signer_name": "Reema Aby", "signer_phone": "6105551234", "item_id": item3, "dish_description": "Curry"})
    client.post("/api/signup/food", json={"signer_name": "Dhyan Menon & Greeshma", "signer_phone": "6105551234", "item_id": item4, "dish_description": "Bread"})

    # 2. Test get_food_signup_for_signer matching
    # Case A: Full name "Binu Pradeep" matches signup under "Binu"
    fs_binu = db_service.get_food_signup_for_signer("Binu Pradeep")
    assert fs_binu is not None
    assert fs_binu["item_id"] == item1

    # Case B: Performer "Ishan Ratheesh" matches signup under "Ishan (Sarina)"
    fs_ishan = db_service.get_food_signup_for_signer("Ishan Ratheesh")
    assert fs_ishan is not None
    assert fs_ishan["item_id"] == item2

    # Case C: Performer "Reema" matches signup under "Reema Aby"
    fs_reema = db_service.get_food_signup_for_signer("Reema")
    assert fs_reema is not None
    assert fs_reema["item_id"] == item3

    # Case D: "Dhyan Menon" matches, but "Dhyan Rakesh Madhavan" does NOT match
    fs_dhyan_menon = db_service.get_food_signup_for_signer("Dhyan Menon")
    assert fs_dhyan_menon is not None
    assert fs_dhyan_menon["item_id"] == item4

    fs_dhyan_other = db_service.get_food_signup_for_signer("Dhyan Rakesh Madhavan")
    assert fs_dhyan_other is None

    # 3. Test rename cascade: Renaming performer "Binu" to "Binu Pradeep" updates food signup
    p_id = db_service.create_performance("Binu", "Solo", song_title="Test Song")
    db_service.rename_performer("Binu", "Binu Pradeep")
    
    # Check that food signup was renamed
    fs_renamed = db_service.get_food_signup_for_signer("Binu Pradeep")
    assert fs_renamed is not None
    assert fs_renamed["signer_name"] == "Binu Pradeep"


def test_duet_performers_food_isolation(client):
    """Verifies that duet performers have completely independent food signups:
    - If Performer A signs up for food, Performer B does NOT inherit it.
    - If Performer B signs up for food, updating B's food does NOT overwrite A's food.
    - Updating A's food does NOT overwrite B's food.
    """
    uid = uuid.uuid4().hex[:6]
    performer_a = f"Niloufer Test {uid}"
    performer_b = f"Reema Test {uid}"

    # Create two food items
    group_id = db_service.add_food_group(f"Curry Group {uid}")
    item_veg = db_service.add_food_item(f"Veg Curry {uid}", group_id)
    item_nonveg = db_service.add_food_item(f"Non-Veg Curry {uid}", group_id)
    item_dessert = db_service.add_food_item(f"Dessert {uid}", group_id)

    # Register duet performance with Performer A as primary and Performer B as partner
    db_service.create_performance(
        performer_name=performer_a,
        performance_type="Duet",
        partner_name=performer_b,
        song_title=f"Duet Song {uid}",
        age_group="Senior",
        created_via="signup"
    )

    # Performer B claims Veg Curry
    claim_b = client.post("/api/signup/food", json={
        "signer_name": performer_b,
        "signer_phone": "6105550103",
        "item_id": item_veg,
        "dish_description": "Mixed Veg Curry"
    })
    assert claim_b.status_code == 200
    signup_b_id = claim_b.json()["signup_id"]

    # Performer A views profile in Performer Hub: must NOT inherit Performer B's food
    prof_a = client.get(f"/api/performer/profile?name={performer_a}").json()
    assert prof_a["food_signup"] is None

    # Performer B views profile: must see Veg Curry
    prof_b = client.get(f"/api/performer/profile?name={performer_b}").json()
    assert prof_b["food_signup"] is not None
    assert prof_b["food_signup"]["signup_id"] == signup_b_id
    assert prof_b["food_signup"]["item_id"] == item_veg

    # Now Performer A claims Non-Veg Curry
    claim_a = client.post("/api/signup/food", json={
        "signer_name": performer_a,
        "signer_phone": "6105550102",
        "item_id": item_nonveg,
        "dish_description": "Chicken Curry"
    })
    assert claim_a.status_code == 200
    signup_a_id = claim_a.json()["signup_id"]
    assert signup_a_id != signup_b_id

    # Performer B's food should still be Veg Curry
    prof_b_after = client.get(f"/api/performer/profile?name={performer_b}").json()
    assert prof_b_after["food_signup"]["signup_id"] == signup_b_id
    assert prof_b_after["food_signup"]["item_id"] == item_veg

    # Performer A updates their food to Dessert
    res_update_a = client.put(f"/api/signup/food/{signup_a_id}", json={
        "item_id": item_dessert,
        "signer_name": performer_a,
        "signer_phone": "6105550102",
        "dish_description": "Payasam"
    })
    assert res_update_a.status_code == 200

    # Performer B's food is STILL Veg Curry, untouched!
    prof_b_final = client.get(f"/api/performer/profile?name={performer_b}").json()
    assert prof_b_final["food_signup"]["signup_id"] == signup_b_id
    assert prof_b_final["food_signup"]["item_id"] == item_veg
    assert prof_b_final["food_signup"]["dish_description"] == "Mixed Veg Curry"


@pytest.mark.potluck
def test_family_dish_check_and_junior_share(client):
    uid = uuid.uuid4().hex[:6]
    parent = f"Priya Nair {uid}"
    child = f"Anika Nair {uid}"
    parent_phone = "6105554321"

    group_id = db_service.add_food_group(f"Family Group {uid}")
    item_id = db_service.add_food_item(f"Samosa {uid}", group_id)

    # Parent signs up as Senior + claims a dish
    res_parent = client.post("/api/signup", json={
        "performer_name": parent,
        "contact_info": parent_phone,
        "age_group": "Senior",
        "registration_type": "both",
        "performances": [{"performance_type": "Solo", "song_title": f"Parent Song {uid}", "is_acoustic": True}],
        "food_signup": {"item_id": item_id, "dish_description": "Samosa"},
    })
    assert res_parent.status_code == 200, res_parent.text

    # Family dish check matches by guardian phone and never leaks phone digits
    chk_phone = client.post("/api/signup/family-dish-check", json={
        "guardian_name": "Someone Else",
        "guardian_phone": parent_phone,
        "contact_info": "",
    })
    assert chk_phone.status_code == 200
    matched = chk_phone.json()["matched_dish"]
    assert matched is not None
    assert matched["item_id"] == item_id
    assert "4321" not in str(matched)
    assert "610555" not in str(matched)

    # Family dish check also matches by guardian name alone
    chk_name = client.post("/api/signup/family-dish-check", json={
        "guardian_name": parent,
        "guardian_phone": "6105550000",
        "contact_info": "",
    })
    assert chk_name.status_code == 200
    assert chk_name.json()["matched_dish"]["item_id"] == item_id

    # Junior signs up sharing parent's dish (no last4 needed when guardian matches)
    res_child = client.post("/api/signup", json={
        "performer_name": child,
        "contact_info": parent_phone,
        "age_group": "Junior",
        "guardian_name": parent,
        "guardian_phone": parent_phone,
        "registration_type": "both",
        "performances": [{"performance_type": "Solo", "song_title": f"Child Song {uid}", "is_acoustic": True}],
        "food_signup": {"item_id": item_id, "share_existing": True},
    })
    assert res_child.status_code == 200, res_child.text

    items_after = db_service.get_all_food_items_with_signups()
    shared = next(it for it in items_after if it["item_id"] == item_id)
    assert parent in shared["signer_name"]
    assert child in shared["signer_name"]


@pytest.mark.potluck
def test_adult_share_existing_dish_requires_valid_last4(client):
    uid = uuid.uuid4().hex[:6]
    spouse_a = f"Arun Menon {uid}"
    spouse_b = f"Meera Menon {uid}"

    group_id = db_service.add_food_group(f"Adult Family Group {uid}")
    item_id = db_service.add_food_item(f"Biryani {uid}", group_id)

    res_a = client.post("/api/signup", json={
        "performer_name": spouse_a,
        "contact_info": "6105559876",
        "age_group": "Senior",
        "registration_type": "both",
        "performances": [{"performance_type": "Solo", "song_title": f"Song A {uid}", "is_acoustic": True}],
        "food_signup": {"item_id": item_id, "dish_description": "Biryani"},
    })
    assert res_a.status_code == 200, res_a.text

    # Wrong last 4 digits must be rejected
    res_bad = client.post("/api/signup", json={
        "performer_name": spouse_b,
        "contact_info": "6105551111",
        "age_group": "Senior",
        "registration_type": "both",
        "performances": [{"performance_type": "Solo", "song_title": f"Song B {uid}", "is_acoustic": True}],
        "food_signup": {"item_id": item_id, "share_existing": True, "family_phone_last4": "0000"},
    })
    assert res_bad.status_code == 400

    # Correct last 4 digits links Spouse B onto the same dish
    res_ok = client.post("/api/signup", json={
        "performer_name": spouse_b,
        "contact_info": "6105551111",
        "age_group": "Senior",
        "registration_type": "both",
        "performances": [{"performance_type": "Solo", "song_title": f"Song B {uid}", "is_acoustic": True}],
        "food_signup": {"item_id": item_id, "share_existing": True, "family_phone_last4": "9876"},
    })
    assert res_ok.status_code == 200, res_ok.text

    items_after = db_service.get_all_food_items_with_signups()
    shared = next(it for it in items_after if it["item_id"] == item_id)
    assert spouse_a in shared["signer_name"]
    assert spouse_b in shared["signer_name"]





