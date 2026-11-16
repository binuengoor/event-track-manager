import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.db_service import db_service
from app.services.admin_service import admin_service

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
            {"performance_type": "Duet", "song_title": "Song 2", "partner_name": "Partner A", "partner_phone": "555-444-1111"},
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
                "partner_phone": "555-666-7777",
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
    assert perf["partner_phone"] == "555-666-7777"

    # Test auto-resolution of existing partner's age group when omitted (and no partner_phone needed for registered partner)
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

def test_signup_phone_mandatory_for_participant(client):
    import uuid
    name = f"Phone Test {uuid.uuid4().hex[:6]}"

    # 1. Missing phone for Senior must fail
    res_empty = client.post("/api/signup", json={
        "performer_name": name,
        "contact_info": "",
        "age_group": "Senior",
        "performances": [{"performance_type": "Solo", "song_title": "Song 1"}]
    })
    assert res_empty.status_code == 400
    assert "phone" in res_empty.json()["detail"].lower()

    # 2. Too short / non-phone must fail
    res_short = client.post("/api/signup", json={
        "performer_name": name,
        "contact_info": "12345",
        "age_group": "Senior",
        "performances": [{"performance_type": "Solo", "song_title": "Song 1"}]
    })
    assert res_short.status_code == 400
    assert "phone" in res_short.json()["detail"].lower()

    # 3. Junior registration with valid guardian phone succeeds and inherits phone
    jname = f"Junior AutoPhone {uuid.uuid4().hex[:6]}"
    res_junior = client.post("/api/signup", json={
        "performer_name": jname,
        "contact_info": "",
        "age_group": "Junior",
        "guardian_name": "Guardian Person",
        "guardian_phone": "(555) 987-6543",
        "performances": [{"performance_type": "Solo", "song_title": "Song 1"}]
    })
    assert res_junior.status_code == 200
    eid = res_junior.json()["entry_ids"][0]
    p = db_service.get_performance_by_id(eid)
    assert p["contact_info"] == "(555) 987-6543"
    assert p["guardian_phone"] == "(555) 987-6543"

def test_signup_duet_custom_partner_phone_mandatory(client):
    import uuid
    pname = f"Duet Lead {uuid.uuid4().hex[:6]}"
    partner = f"Unregistered Partner {uuid.uuid4().hex[:6]}"

    # Custom partner without phone must fail
    res_no_partner_phone = client.post("/api/signup", json={
        "performer_name": pname,
        "contact_info": "555-123-4567",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Duet",
                "partner_name": partner,
                "partner_phone": "",
                "song_title": "Duet Song"
            }
        ]
    })
    assert res_no_partner_phone.status_code == 400
    assert "phone number is required for partner" in res_no_partner_phone.json()["detail"].lower()

    # Custom partner with invalid phone must fail
    res_bad_phone = client.post("/api/signup", json={
        "performer_name": pname,
        "contact_info": "555-123-4567",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Duet",
                "partner_name": partner,
                "partner_phone": "123",
                "song_title": "Duet Song"
            }
        ]
    })
    assert res_bad_phone.status_code == 400
    assert "phone number is required for partner" in res_bad_phone.json()["detail"].lower()

    # Custom partner with valid phone succeeds
    res_good = client.post("/api/signup", json={
        "performer_name": pname,
        "contact_info": "555-123-4567",
        "age_group": "Senior",
        "performances": [
            {
                "performance_type": "Duet",
                "partner_name": partner,
                "partner_phone": "(555) 321-7654",
                "song_title": "Duet Song"
            }
        ]
    })
    assert res_good.status_code == 200
    eid = res_good.json()["entry_ids"][0]
    p = db_service.get_performance_by_id(eid)
    assert p["partner_name"] == partner
    assert p["partner_phone"] == "(555) 321-7654"

def test_signup_food_only_attendee_success(client):
    import uuid
    # 1. Create a food group and item for testing
    group_id = db_service.add_food_group(f"Potluck Group {uuid.uuid4().hex[:6]}")
    item_id = db_service.add_food_item(f"Special Dish {uuid.uuid4().hex[:6]}", group_id)

    attendee_name = f"Attendee {uuid.uuid4().hex[:6]}"
    attendee_phone = "(555) 888-7777"

    payload = {
        "registration_type": "food_only",
        "performer_name": attendee_name,
        "contact_info": attendee_phone,
        "performances": [],
        "food_signup": {
            "item_id": item_id,
            "dish_description": "Homemade Payasam"
        }
    }

    res = client.post("/api/signup", json=payload)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "success"
    assert data["registration_type"] == "food_only"
    assert data["performer_name"] == attendee_name
    assert data["entry_ids"] == []
    assert data["food_signup_id"] is not None

    # Verify they are NOT in performances table
    all_perfs = db_service.get_all_performances()
    perf_names = {p["performer_name"] for p in all_perfs}
    assert attendee_name not in perf_names

    # Verify they are NOT in registered_performers config list
    cfg_res = client.get("/api/signup/config")
    assert cfg_res.status_code == 200
    reg_performers = cfg_res.json()["registered_performers"]
    assert attendee_name not in reg_performers

    # Verify they ARE in food signups
    food_signup = db_service.get_food_signup_for_signer(attendee_name)
    assert food_signup is not None
    assert food_signup["item_id"] == item_id
    assert food_signup["dish_description"] == "Homemade Payasam"
    assert food_signup["signer_phone"] == attendee_phone

    # Clean up
    db_service.delete_food_item(item_id, force=True)
    db_service.delete_food_group(group_id)

def test_signup_food_only_attendee_requires_food_item(client):
    import uuid
    attendee_name = f"Attendee No Food {uuid.uuid4().hex[:6]}"
    payload = {
        "registration_type": "food_only",
        "performer_name": attendee_name,
        "contact_info": "555-444-3333",
        "performances": [],
        "food_signup": None
    }
    res = client.post("/api/signup", json=payload)
    assert res.status_code == 400
    assert "potluck dish" in res.json()["detail"].lower()

def test_signup_food_only_attendee_requires_valid_phone(client):
    import uuid
    group_id = db_service.add_food_group(f"Phone Group {uuid.uuid4().hex[:6]}")
    item_id = db_service.add_food_item(f"Phone Dish {uuid.uuid4().hex[:6]}", group_id)

    attendee_name = f"Attendee Bad Phone {uuid.uuid4().hex[:6]}"
    payload = {
        "registration_type": "food_only",
        "performer_name": attendee_name,
        "contact_info": "1234",
        "performances": [],
        "food_signup": {
            "item_id": item_id,
            "dish_description": "Dish"
        }
    }
    res = client.post("/api/signup", json=payload)
    assert res.status_code == 400
    assert "phone" in res.json()["detail"].lower()

    # Clean up
    db_service.delete_food_item(item_id, force=True)
    db_service.delete_food_group(group_id)


# ------------------------------------------------------------------ several songs in one sign-up
def settings_set(key, value):
    admin_service.update_settings({key: value})


def _dish():
    group = db_service.add_food_group('Mains')
    return db_service.add_food_item('Rice', group)


def _signup(name, performances, item=None, phone='6105550177'):
    body = {'performer_name': name, 'contact_info': phone, 'age_group': 'Senior', 'performances': performances}
    if item:
        body['food_signup'] = {'item_id': item}
        body['registration_type'] = 'both'
    return TestClient(app).post('/api/signup', json=body)


def test_one_signup_can_register_every_allowed_song_with_a_single_dish():
    settings_set('max_performances_per_participant', 2)
    settings_set('max_solo_per_participant', 2)
    item = _dish()
    response = _signup('Many Songs', [
        {'performance_type': 'Solo', 'song_title': 'First'},
        {'performance_type': 'Solo', 'song_title': 'Second'},
    ], item=item)
    assert response.status_code == 200, response.text
    assert len(response.json()['entry_ids']) == 2
    assert sum(1 for p in db_service.get_all_performances() if p['performer_name'] == 'Many Songs') == 2


def test_signup_over_the_song_limit_is_refused():
    settings_set('max_performances_per_participant', 2)
    settings_set('max_solo_per_participant', 3)
    response = _signup('Too Many', [{'performance_type': 'Solo', 'song_title': str(i)} for i in range(3)], item=_dish())
    assert response.status_code == 400
    assert 'Maximum allowed is 2' in response.json()['detail']


def test_signing_up_again_points_to_my_entry_and_never_asks_for_a_second_dish():
    settings_set('max_performances_per_participant', 2)
    item = _dish()
    assert _signup('Repeat Singer', [{'performance_type': 'Solo', 'song_title': 'One'}], item=item).status_code == 200
    again = _signup('Repeat Singer', [{'performance_type': 'Solo', 'song_title': 'Two'}])   # no dish this time
    assert again.status_code == 409
    assert 'already signed up' in again.json()['detail'] and 'My Entry' in again.json()['detail']
    assert 'dish' not in again.json()['detail'].lower()


def test_someone_who_already_brought_a_dish_can_sign_up_to_perform_without_another():
    item = _dish()
    food = TestClient(app).post('/api/signup/food', json={'item_id': item, 'signer_name': 'Dish First', 'signer_phone': '6105550188'})
    assert food.status_code == 200, food.text
    response = _signup('Dish First', [{'performance_type': 'Solo', 'song_title': 'Later'}], phone='6105550188')
    assert response.status_code == 200, response.text
