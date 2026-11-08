import pytest
from fastapi.testclient import TestClient
import uuid

from app.config import settings
from app.main import app
from app.services.db_service import db_service


@pytest.fixture
def admin():
    client = TestClient(app)
    client.headers.update({"X-Admin-PIN": settings.admin_pin})
    return client


def test_age_group_description_round_trips_to_signup_config(admin):
    age_groups = [
        {"name": "Junior", "description": "Under 13", "requires_guardian": True},
        {"name": "Senior", "description": "13 and older", "requires_guardian": False},
    ]
    saved = admin.put("/api/admin/settings", json={"settings": {"age_groups": age_groups}})
    assert saved.status_code == 200, saved.text
    assert admin.get("/api/admin/settings").json()["age_groups"] == age_groups

    public = admin.get("/api/signup/config").json()["age_groups"]
    assert public == age_groups


def test_legacy_age_group_entries_gain_empty_descriptions(admin):
    db_service.set_app_setting("age_groups", [
        {"name": "Junior", "requires_guardian": True},
        {"name": "Senior", "requires_guardian": False},
    ])

    expected = [
        {"name": "Junior", "description": "", "requires_guardian": True},
        {"name": "Senior", "description": "", "requires_guardian": False},
    ]
    assert admin.get("/api/signup/config").json()["age_groups"] == expected
    assert admin.get("/api/admin/settings").json()["age_groups"] == expected


def test_legacy_missing_guardian_flag_defaults_to_backend_false(admin):
    db_service.set_app_setting("age_groups", [{"name": "Junior"}])
    assert admin.get("/api/signup/config").json()["age_groups"] == [
        {"name": "Junior", "description": "", "requires_guardian": False},
    ]


@pytest.mark.parametrize("age_groups", [
    [{"name": "Junior", "description": 13, "requires_guardian": True}],
    [{"name": "Junior", "description": "x" * 201, "requires_guardian": True}],
    [{"name": "Junior", "description": "Under 13", "requires_guardian": "yes"}],
])
def test_age_group_description_and_guardian_types_are_validated(admin, age_groups):
    response = admin.put("/api/admin/settings", json={"settings": {"age_groups": age_groups}})
    assert response.status_code == 400, response.text


def test_duplicate_age_group_names_are_rejected_case_insensitively(admin):
    response = admin.put("/api/admin/settings", json={"settings": {"age_groups": [
        {"name": "Junior", "requires_guardian": True},
        {"name": " junior ", "requires_guardian": False},
    ]}})
    assert response.status_code == 400, response.text


def test_signup_rejects_unknown_performer_and_partner_age_groups(admin):
    suffix = uuid.uuid4().hex[:8]
    performer = admin.post("/api/signup", json={
        "performer_name": f"Unknown Age {suffix}", "contact_info": "6105550101", "age_group": "Mystery",
        "performances": [{"performance_type": "Solo", "song_title": "Song"}],
    })
    assert performer.status_code == 400
    assert "age group" in performer.json()["detail"].lower()

    partner = admin.post("/api/signup", json={
        "performer_name": f"Known Age {suffix}", "contact_info": "6105550102", "age_group": "Senior",
        "performances": [{
            "performance_type": "Duet", "song_title": "Song", "partner_name": f"Partner {suffix}",
            "partner_phone": "6105550103", "partner_age_group": "Mystery",
        }],
    })
    assert partner.status_code == 400
    assert "age group" in partner.json()["detail"].lower()


def test_signup_keeps_missing_age_groups_optional(admin):
    suffix = uuid.uuid4().hex[:8]
    solo = admin.post("/api/signup", json={
        "performer_name": f"No Age {suffix}", "contact_info": "6105550104",
        "performances": [{"performance_type": "Solo", "song_title": "Song"}],
    })
    assert solo.status_code == 200, solo.text

    duet = admin.post("/api/signup", json={
        "performer_name": f"No Partner Age {suffix}", "contact_info": "6105550105", "age_group": "Senior",
        "performances": [{
            "performance_type": "Duet", "song_title": "Song", "partner_name": f"Optional Partner {suffix}",
            "partner_phone": "6105550106",
        }],
    })
    assert duet.status_code == 200, duet.text
