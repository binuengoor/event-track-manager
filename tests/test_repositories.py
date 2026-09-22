import pytest
import sqlite3
from app.repositories.base import DatabaseManager
from app.repositories.schema import ensure_database
from app.repositories.settings_repo import SettingsRepository
from app.repositories.participant_repo import ParticipantRepository
from app.repositories.food_repo import FoodRepository
from app.repositories.performance_repo import PerformanceRepository
from app.repositories.audit_repo import AuditRepository
from app.schemas import PerformanceEntry


@pytest.fixture
def test_db(tmp_path):
    db_path = str(tmp_path / "test_modular.db")
    db_manager = DatabaseManager(db_path)
    with db_manager.get_connection() as conn:
        ensure_database(conn)
    return db_manager


def test_database_manager_pragmas(test_db):
    with test_db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode")
        mode = cursor.fetchone()[0].lower()
        assert mode in ("wal", "memory")

        cursor.execute("PRAGMA foreign_keys")
        fk = cursor.fetchone()[0]
        assert fk == 1


def test_settings_repository(test_db):
    repo = SettingsRepository(test_db)
    # Set and get
    repo.set_setting("theme_color", "#ff5500")
    assert repo.get_setting("theme_color") == "#ff5500"

    # Default fallback
    assert repo.get_setting("non_existent") is None

    # Get all
    repo.set_setting("event_title", "Gala 2026")
    all_settings = repo.get_all_settings()
    assert all_settings["theme_color"] == "#ff5500"
    assert all_settings["event_title"] == "Gala 2026"


def test_participant_repository(test_db):
    repo = ParticipantRepository(test_db)

    # Create participant
    part_id = repo.get_or_create_participant("Alice Smith", phone="555-1234", age_group="Adult")
    assert part_id is not None
    assert part_id.startswith("pt_")

    # Fetch existing
    part_dup_id = repo.get_or_create_participant("Alice Smith")
    assert part_dup_id == part_id

    # Lookup by id
    p1 = repo.get_participant(part_id)
    assert p1 is not None
    assert p1["name"] == "Alice Smith"

    # Lookup by name
    p_by_name = repo.get_participant("Alice Smith")
    assert p_by_name["participant_id"] == part_id

    # Update participant
    renamed = repo.update_participant(part_id, name="Alice Johnson")
    assert renamed is True
    updated = repo.get_participant(part_id)
    assert updated["name"] == "Alice Johnson"


def test_food_repository(test_db):
    repo = FoodRepository(test_db)

    # Create group and item
    gid = repo.add_food_group("Desserts")
    assert gid is not None
    assert gid.startswith("fg_")

    item_id = repo.add_food_item("Chocolate Cake", gid)
    assert item_id is not None
    assert item_id.startswith("fi_")

    # Claim item
    signup_id = repo.claim_food_item(
        item_id=item_id,
        signer_name="Baker Bob",
        signer_phone="555-9999",
        dish_description="Triple chocolate fudge cake"
    )
    assert signup_id is not None
    assert signup_id.startswith("fs_")

    # Verify claim in list
    items = repo.get_all_food_items_with_signups()
    claimed_item = next(it for it in items if it["item_id"] == item_id)
    assert claimed_item["is_taken"] is True
    assert claimed_item["signer_name"] == "Baker Bob"

    # Release signup
    released = repo.release_food_signup(signup_id)
    assert released is True

    items_after = repo.get_all_food_items_with_signups()
    released_item = next(it for it in items_after if it["item_id"] == item_id)
    assert released_item["is_taken"] is False


def test_performance_repository(test_db):
    repo = PerformanceRepository(test_db)

    entry = PerformanceEntry(
        entry_id="TEST-001",
        performer_name="Bob Dylan",
        performance_type="Solo",
        partner_name=None,
        song_title="Blowin in the Wind",
        movie_name=None,
        sequence_order=1,
        performance_status="Upcoming",
        track_status="Pending",
        row_index=2
    )

    # Save
    repo.save_performances([entry])

    # Fetch
    all_p = repo.get_all_performances()
    assert len(all_p) >= 1
    matched = next(p for p in all_p if p["entry_id"] == "TEST-001")
    assert matched["performer_name"] == "Bob Dylan"
    assert matched["song_title"] == "Blowin in the Wind"

    # Update field
    repo.update_performance_field("TEST-001", "performance_status", "On Stage")
    active = repo.get_all_performances()
    assert next(p for p in active if p["entry_id"] == "TEST-001")["performance_status"] == "On Stage"

    # Active Entry tracking
    repo.set_active_entry_id("TEST-001")
    assert repo.get_active_entry_id() == "TEST-001"
    repo.set_active_entry_id(None)
    assert repo.get_active_entry_id() is None


def test_audit_repository(test_db):
    repo = AuditRepository(test_db)

    # Log activity
    log_id = repo.log_activity(
        action_type="status_change",
        performer_name="Stage Manager",
        summary="Cued performance TEST-001",
        entry_id="TEST-001",
        details="Moved to On Stage",
        source="console"
    )
    assert log_id is not None
    assert isinstance(log_id, str)
    assert log_id.startswith("act_")

    logs = repo.get_activity_logs(limit=10)
    assert len(logs) >= 1
    assert logs[0]["summary"] == "Cued performance TEST-001"

    # Log backup cycle
    b_id = repo.log_backup_start()
    assert b_id is not None
    assert isinstance(b_id, int)
    assert b_id > 0
    repo.log_backup_success(b_id, rows_backed=42)

    history = repo.get_backup_history(limit=5)
    assert len(history) >= 1
    assert history[0]["status"] == "success"
    assert history[0]["rows_backed"] == 42
