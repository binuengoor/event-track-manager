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
    assert fresh.execute("PRAGMA user_version").fetchone()[0] == 1
    assert not (tmp_path / "backups").exists()
    fresh.close()

    legacy = connect(tmp_path / "event.db")
    legacy.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)")
    legacy.execute("INSERT INTO app_settings (key, value) VALUES ('event_name', 'Original')")
    legacy.commit()
    ensure_database(legacy)
    assert legacy.execute("PRAGMA user_version").fetchone()[0] == 1
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
