import sqlite3
from pathlib import Path

import pytest

from app.repositories.schema import ensure_database
from app.repositories import migrations


def connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def test_fresh_and_existing_legacy_migrate_and_backup(tmp_path):
    fresh = connect(tmp_path / "fresh.db")
    ensure_database(fresh)
    assert fresh.execute("PRAGMA user_version").fetchone()[0] == migrations.SCHEMA_VERSION
    assert not (tmp_path / "backups").exists()
    fresh.close()

    legacy = connect(tmp_path / "event.db")
    legacy.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)")
    legacy.execute("INSERT INTO app_settings (key, value) VALUES ('event_name', 'Original')")
    legacy.commit()
    ensure_database(legacy)
    assert legacy.execute("PRAGMA user_version").fetchone()[0] == migrations.SCHEMA_VERSION
    assert legacy.execute("SELECT value FROM app_settings WHERE key='event_name'").fetchone()[0] == 'Original'
    backups = list((tmp_path / "backups").glob("pre-migration-*.db"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as old:
        assert old.execute("PRAGMA user_version").fetchone()[0] == 0
        assert old.execute("SELECT value FROM app_settings").fetchone()[0] == 'Original'
        assert old.execute("SELECT count(*) FROM sqlite_master WHERE name='performances'").fetchone()[0] == 0
    ensure_database(legacy)
    assert len(list((tmp_path / "backups").glob("pre-migration-*.db"))) == 1
    legacy.close()


def test_version_one_upgrade_preserves_data_and_backups_previous_schema(tmp_path, monkeypatch):
    conn = connect(tmp_path / "event.db")
    with monkeypatch.context() as prior:
        prior.setattr(migrations, "SCHEMA_VERSION", 1)
        ensure_database(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    conn.execute("INSERT INTO app_settings (key, value) VALUES ('event_name', 'Before upgrade')")
    conn.commit()
    old_columns = {row[1] for row in conn.execute("PRAGMA table_info(performances)")}
    assert "public_first_name_only" not in old_columns

    ensure_database(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == migrations.SCHEMA_VERSION
    assert conn.execute("SELECT value FROM app_settings WHERE key='event_name'").fetchone()[0] == 'Before upgrade'
    columns = {row[1] for row in conn.execute("PRAGMA table_info(performances)")}
    assert {"public_first_name_only", "partner_guardian_name", "partner_guardian_phone"} <= columns
    backups = list((tmp_path / "backups").glob("pre-migration-*.db"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as old:
        assert old.execute("PRAGMA user_version").fetchone()[0] == 1
        assert old.execute("SELECT value FROM app_settings WHERE key='event_name'").fetchone()[0] == 'Before upgrade'
        assert "public_first_name_only" not in {row[1] for row in old.execute("PRAGMA table_info(performances)")}
    ensure_database(conn)
    assert len(list((tmp_path / "backups").glob("pre-migration-*.db"))) == 1
    conn.close()


def test_version_two_failure_rolls_back_schema_and_version(tmp_path, monkeypatch):
    conn = connect(tmp_path / "event.db")
    with monkeypatch.context() as prior:
        prior.setattr(migrations, "SCHEMA_VERSION", 1)
        ensure_database(conn)
    conn.execute("INSERT INTO app_settings (key, value) VALUES ('event_name', 'Preserved')")
    conn.commit()

    def fail_after_alter(db):
        db.execute("ALTER TABLE performances ADD COLUMN public_first_name_only INTEGER DEFAULT 0")
        raise RuntimeError("failed during upgrade")

    monkeypatch.setitem(migrations.MIGRATIONS, 2, fail_after_alter)
    with pytest.raises(RuntimeError, match="failed during upgrade"):
        ensure_database(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    assert "public_first_name_only" not in {row[1] for row in conn.execute("PRAGMA table_info(performances)")}
    assert conn.execute("SELECT value FROM app_settings WHERE key='event_name'").fetchone()[0] == 'Preserved'
    backup = next((tmp_path / "backups").glob("pre-migration-*.db"))
    with sqlite3.connect(backup) as old:
        assert old.execute("PRAGMA user_version").fetchone()[0] == 1
        assert old.execute("SELECT value FROM app_settings WHERE key='event_name'").fetchone()[0] == 'Preserved'
    conn.close()


def test_failure_rolls_back_and_newer_version_refused(tmp_path, monkeypatch):
    conn = connect(tmp_path / "event.db")
    conn.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)")
    conn.commit()
    def fail(db):
        db.execute("CREATE TABLE should_rollback (id INTEGER)")
        raise ValueError("migration failed")
    with pytest.raises(ValueError, match="migration failed"):
        migrations.migrate(conn, fail)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
    assert not conn.execute("SELECT name FROM sqlite_master WHERE name='should_rollback'").fetchone()
    monkeypatch.setattr(migrations, "_snapshot", lambda *args: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError, match="disk full"):
        ensure_database(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
    conn.execute("PRAGMA user_version = 99")
    with pytest.raises(RuntimeError, match="newer than supported"):
        ensure_database(conn)
    conn.close()


def test_snapshot_is_taken_while_ordinary_writers_are_locked(tmp_path, monkeypatch):
    path = tmp_path / "event.db"
    conn = connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT INTO app_settings VALUES ('before', 'snapshot')")
    conn.commit()
    original = migrations._snapshot
    def snapshot_with_competing_writer(source, db_path):
        writer = sqlite3.connect(db_path, timeout=0.01)
        try:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                writer.execute("INSERT INTO app_settings VALUES ('during', 'unexpected')")
        finally:
            writer.close()
        original(source, db_path)
    monkeypatch.setattr(migrations, "_snapshot", snapshot_with_competing_writer)
    ensure_database(conn)
    backup = next((tmp_path / "backups").glob("pre-migration-*.db"))
    with sqlite3.connect(backup) as snapshot:
        assert snapshot.execute("SELECT value FROM app_settings WHERE key='before'").fetchone()[0] == "snapshot"
    conn.close()


def _google_era_db(path):
    """A version-2 database as the Google-era layout left it: drive_* columns, 'sheet' rows, old setting key."""
    conn = connect(path)
    with pytest.MonkeyPatch.context() as prior:
        prior.setattr(migrations, "SCHEMA_VERSION", 2)
        ensure_database(conn)
    conn.execute("INSERT INTO performances (entry_id, performer_name, drive_file_id, drive_file_name, created_via) "
                 "VALUES ('PK-001', 'Ravi Kumar', 'v10-5', '01_PK-001_Ravi_Song.mp3', 'sheet')")
    conn.execute("INSERT INTO performances (entry_id, performer_name, created_via) VALUES ('PK-002', 'Mala', 'performer_hub')")
    conn.execute("INSERT INTO app_settings (key, value) VALUES ('signup_sheet_url', 'https://example.org/list')")
    conn.commit()
    return conn


def test_google_era_database_migrates_to_current_names(tmp_path):
    conn = _google_era_db(tmp_path / "event.db")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(performances)")}
    assert {"drive_file_id", "drive_file_name"} <= cols and conn.execute("PRAGMA user_version").fetchone()[0] == 2
    ensure_database(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(performances)")}
    assert {"track_version", "track_file"} <= cols and not {"drive_file_id", "drive_file_name"} & cols
    row = dict(conn.execute("SELECT * FROM performances WHERE entry_id='PK-001'").fetchone())
    assert (row["track_version"], row["track_file"], row["created_via"]) == ("v10-5", "01_PK-001_Ravi_Song.mp3", "signup")
    assert conn.execute("SELECT created_via FROM performances WHERE entry_id='PK-002'").fetchone()[0] == "performer_hub"
    assert conn.execute("SELECT value FROM app_settings WHERE key='external_link_url'").fetchone()[0] == "https://example.org/list"
    assert conn.execute("SELECT count(*) FROM app_settings WHERE key='signup_sheet_url'").fetchone()[0] == 0
    backups = list((tmp_path / "backups").glob("pre-migration-*.db"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as old:      # the pre-migration copy keeps the old layout
        assert "drive_file_id" in {r[1] for r in old.execute("PRAGMA table_info(performances)")}
    ensure_database(conn)                         # idempotent: no second backup
    assert len(list((tmp_path / "backups").glob("pre-migration-*.db"))) == 1
    conn.close()


def test_old_snapshot_restores_into_new_code(tmp_path):
    import shutil
    _google_era_db(tmp_path / "old.db").close()
    restored = tmp_path / "restored" / "event.db"
    restored.parent.mkdir()
    shutil.copyfile(tmp_path / "old.db", restored)
    conn = connect(restored)
    ensure_database(conn)
    assert conn.execute("SELECT track_file FROM performances WHERE entry_id='PK-001'").fetchone()[0] == "01_PK-001_Ravi_Song.mp3"
    conn.close()


def test_failed_rename_migration_rolls_back(tmp_path, monkeypatch):
    conn = _google_era_db(tmp_path / "event.db")

    def boom(db):
        db.execute("ALTER TABLE performances RENAME COLUMN drive_file_id TO track_version")
        raise RuntimeError("rename failed")

    monkeypatch.setitem(migrations.MIGRATIONS, 3, boom)
    with pytest.raises(RuntimeError):
        ensure_database(conn)
    assert "drive_file_id" in {r[1] for r in conn.execute("PRAGMA table_info(performances)")}
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
    conn.close()
