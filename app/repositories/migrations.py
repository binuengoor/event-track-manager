"""Versioned, per-event SQLite schema initialization."""
import fcntl
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

SCHEMA_VERSION = 3

# Version 1 is the legacy-compatible baseline (schema._apply_baseline). Later versions are small, idempotent steps.
_PERFORMANCE_COLUMNS_V2 = (
    ("public_first_name_only", "INTEGER DEFAULT 0"),
    ("partner_guardian_name", "TEXT DEFAULT ''"),
    ("partner_guardian_phone", "TEXT DEFAULT ''"),
)


def _migrate_to_2(conn: sqlite3.Connection) -> None:
    """Adult 'first name only' opt-in and partner guardian contact, stored on the performance record."""
    exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='performances'").fetchone()
    if not exists:
        return
    have = {row[1] for row in conn.execute("PRAGMA table_info(performances)")}
    for name, definition in _PERFORMANCE_COLUMNS_V2:
        if name not in have:
            conn.execute(f"ALTER TABLE performances ADD COLUMN {name} {definition}")


def _migrate_to_3(conn: sqlite3.Connection) -> None:
    """Drops the Google-era names: file columns, created_via default/rows and the external link setting."""
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='performances'").fetchone():
        have = {row[1] for row in conn.execute("PRAGMA table_info(performances)")}
        for old, new in (("drive_file_id", "track_version"), ("drive_file_name", "track_file")):
            if old in have and new not in have:
                conn.execute(f"ALTER TABLE performances RENAME COLUMN {old} TO {new}")
        conn.execute("UPDATE performances SET created_via = 'signup' WHERE created_via = 'sheet'")
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_settings'").fetchone():
        old_row = conn.execute("SELECT value FROM app_settings WHERE key = 'signup_sheet_url'").fetchone()
        if old_row is not None:
            conn.execute("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('external_link_url', ?, datetime('now'))",
                         (old_row[0],))
            conn.execute("DELETE FROM app_settings WHERE key = 'signup_sheet_url'")


MIGRATIONS = {2: _migrate_to_2, 3: _migrate_to_3}
KNOWN_TABLES = {"performances", "sync_meta", "app_settings", "food_groups", "food_items",
                "food_signups", "backup_log", "activity_logs", "participants"}


@contextmanager
def _event_lock(path: str):
    if not path:
        yield
        return
    lock_path = path + ".migration.lock"
    with open(lock_path, "a", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _snapshot(conn: sqlite3.Connection, path: str) -> None:
    if not path:
        raise RuntimeError("Cannot back up an existing in-memory database before migration")
    folder = Path(path).parent / "backups"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    destination = folder / f"pre-migration-{stamp}-{uuid.uuid4().hex[:8]}.db"
    with sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True) as source:
        with sqlite3.connect(destination) as target:
            source.backup(target)
            if target.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise RuntimeError("Pre-migration database backup failed its integrity check")
    os.chmod(destination, 0o600)


def migrate(conn: sqlite3.Connection, baseline: Callable[[sqlite3.Connection], None]) -> None:
    """Apply the legacy-compatible baseline once, backing up before mutation.

    The file lock spans inspection, backup and migration for cooperating processes;
    the SQLite transaction makes the schema, backfill and version one atomic unit.
    """
    path = conn.execute("PRAGMA database_list").fetchone()[2]
    if conn.in_transaction:
        raise RuntimeError("Cannot migrate inside an existing database transaction")
    with _event_lock(path):
        try:
            # Reserve the writer before taking the snapshot so no application
            # write can slip between backup and schema migration. A separate
            # read-only connection takes the SQLite online backup (WAL-safe).
            conn.execute("BEGIN IMMEDIATE")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise RuntimeError(f"Database schema version {version} is newer than supported {SCHEMA_VERSION}")
            if version == SCHEMA_VERSION:
                conn.commit()
                return
            names = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if names and not names.intersection(KNOWN_TABLES):
                raise RuntimeError("Unrecognized event database; migration refused")
            if names:
                _snapshot(conn, path)
            if version < 1:
                baseline(conn)
                version = 1
            for target in range(version + 1, SCHEMA_VERSION + 1):
                MIGRATIONS[target](conn)
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
