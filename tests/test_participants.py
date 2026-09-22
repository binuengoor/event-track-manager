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


def test_participant_lifecycle_and_roster(client):
    # 1. Sign up performer with solo performance
    res = client.post("/api/signup", json={
        "performer_name": "Roster Performer",
        "contact_info": "484-555-9988",
        "age_group": "Senior",
        "performances": [
            {"performance_type": "Solo", "song_title": "Roster Solo"}
        ]
    })
    assert res.status_code == 200
    entry_id = res.json()["entry_ids"][0]

    # Verify participant created in participants table
    part = db_service.get_participant("Roster Performer")
    assert part is not None
    assert part["name"] == "Roster Performer"
    assert part["phone"] == "484-555-9988"
    part_id = part["participant_id"]
    assert part_id.startswith("pt_")

    # Verify performance links to participant_id
    perf = db_service.get_performance(entry_id)
    assert perf["participant_id"] == part_id

    # 2. Add second performance for same participant via Performer Hub
    res_add = client.post("/api/performer/performances", json={
        "performer_name": "Roster Performer",
        "performance_type": "Duet",
        "partner_name": "Duet Partner Person",
        "partner_phone": "484-555-1122",
        "song_title": "Roster Duet"
    })
    assert res_add.status_code == 200
    entry_id_2 = res_add.json()["entry_id"]

    perf2 = db_service.get_performance(entry_id_2)
    assert perf2["participant_id"] == part_id

    # Verify partner also has a participant record
    partner_part = db_service.get_participant("Duet Partner Person")
    assert partner_part is not None
    assert partner_part["phone"] == "484-555-1122"

    # 3. Test canonical roster endpoint
    roster_res = client.get("/api/admin/roster")
    assert roster_res.status_code == 200
    roster = roster_res.json()
    assert isinstance(roster, list)

    target_in_roster = next((p for p in roster if p["name"] == "Roster Performer"), None)
    assert target_in_roster is not None
    assert target_in_roster["total_performances"] >= 2
    perf_titles = [p["song_title"] for p in target_in_roster["performances"]]
    assert "Roster Solo" in perf_titles
    assert "Roster Duet" in perf_titles

    # 4. Test participant rename cascade
    rename_res = client.put("/api/performer/rename", json={
        "old_name": "Roster Performer",
        "new_name": "Roster Performer Renamed"
    })
    assert rename_res.status_code == 200

    # Old name should no longer exist
    assert db_service.get_participant("Roster Performer") is None
    # New name should exist with same participant_id
    renamed_part = db_service.get_participant("Roster Performer Renamed")
    assert renamed_part is not None
    assert renamed_part["participant_id"] == part_id

    # Clean up
    db_service.delete_performance(entry_id)
    db_service.delete_performance(entry_id_2)
