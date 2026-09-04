import sqlite3
import os
import json
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from app.config import settings
from pydantic import BaseModel

logger = logging.getLogger("db-service")

class DBService:
    def __init__(self):
        self._db_path = None
        self._ensure_db()

    @property
    def db_path(self) -> str:
        if not self._db_path:
            cache_dir = settings.storage.cache_dir
            os.makedirs(cache_dir, exist_ok=True)
            # Use stable database file
            self._db_path = os.path.join(cache_dir, "event_data.db")
        return self._db_path

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_db(self):
        try:
            with self._get_connection() as conn:
                conn.execute("""
                CREATE TABLE IF NOT EXISTS performances (
                    entry_id TEXT PRIMARY KEY,
                    performer_name TEXT NOT NULL,
                    performance_type TEXT DEFAULT 'Solo',
                    partner_name TEXT,
                    contact_info TEXT,
                    song_title TEXT DEFAULT '',
                    movie_name TEXT,
                    sequence_order INTEGER,
                    performance_status TEXT DEFAULT 'Upcoming',
                    track_status TEXT DEFAULT 'Pending',
                    duration TEXT,
                    drive_file_id TEXT,
                    drive_file_name TEXT,
                    last_updated TEXT,
                    row_index INTEGER DEFAULT 0,
                    is_song_name_missing INTEGER DEFAULT 0,
                    extra_tags_json TEXT DEFAULT '[]'
                )
                """)
                conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_perf_sequence ON performances (sequence_order)
                """)
                conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
                """)
                conn.commit()
        except Exception as ex:
            logger.error(f"Error initializing SQLite database at {self.db_path}: {ex}")

    def save_performances(self, entries: List[Any]):
        """Atomically saves or updates all performance entries."""
        try:
            with self._get_connection() as conn:
                # We do an UPSERT
                for p in entries:
                    extra_tags = getattr(p, "extra_tags", []) or []
                    conn.execute("""
                    INSERT INTO performances (
                        entry_id, performer_name, performance_type, partner_name, contact_info,
                        song_title, movie_name, sequence_order, performance_status, track_status,
                        duration, drive_file_id, drive_file_name, last_updated, row_index,
                        is_song_name_missing, extra_tags_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(entry_id) DO UPDATE SET
                        performer_name=excluded.performer_name,
                        performance_type=excluded.performance_type,
                        partner_name=excluded.partner_name,
                        contact_info=excluded.contact_info,
                        song_title=excluded.song_title,
                        movie_name=excluded.movie_name,
                        sequence_order=excluded.sequence_order,
                        performance_status=excluded.performance_status,
                        track_status=excluded.track_status,
                        duration=excluded.duration,
                        drive_file_id=excluded.drive_file_id,
                        drive_file_name=excluded.drive_file_name,
                        last_updated=excluded.last_updated,
                        row_index=excluded.row_index,
                        is_song_name_missing=excluded.is_song_name_missing,
                        extra_tags_json=excluded.extra_tags_json
                    """, (
                        p.entry_id,
                        p.performer_name,
                        p.performance_type,
                        getattr(p, "partner_name", None),
                        getattr(p, "contact_info", None),
                        p.song_title,
                        getattr(p, "movie_name", None),
                        p.sequence_order,
                        p.performance_status,
                        p.track_status,
                        p.duration,
                        p.drive_file_id,
                        getattr(p, "drive_file_name", None),
                        p.last_updated,
                        p.row_index,
                        1 if getattr(p, "is_song_name_missing", False) else 0,
                        json.dumps(extra_tags)
                    ))

                # Also delete entries that are no longer in the sheet
                incoming_ids = [p.entry_id for p in entries]
                if incoming_ids:
                    placeholders = ",".join("?" for _ in incoming_ids)
                    conn.execute(f"DELETE FROM performances WHERE entry_id NOT IN ({placeholders})", incoming_ids)

                conn.commit()
            self.set_last_sync_time()
        except Exception as ex:
            logger.error(f"Error saving performances to SQLite: {ex}")
            raise

    def get_all_performances(self) -> List[Dict[str, Any]]:
        """Returns all performance dictionaries ordered by sequence_order."""
        try:
            with self._get_connection() as conn:
                cursor = conn.execute("""
                SELECT * FROM performances 
                ORDER BY 
                    CASE WHEN sequence_order IS NULL OR sequence_order <= 0 THEN 9999 ELSE sequence_order END ASC,
                    row_index ASC
                """)
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    item = dict(r)
                    item["is_song_name_missing"] = bool(item["is_song_name_missing"])
                    try:
                        item["extra_tags"] = json.loads(item["extra_tags_json"]) if item["extra_tags_json"] else []
                    except Exception:
                        item["extra_tags"] = []
                    item.pop("extra_tags_json", None)
                    results.append(item)
                return results
        except Exception as ex:
            logger.error(f"Error fetching performances from SQLite: {ex}")
            return []

    def update_performance_field(self, entry_id: str, field_name: str, value: Any):
        """Updates a specific field of a performance in SQLite."""
        allowed_fields = {
            "performance_status", "track_status", "sequence_order", "duration",
            "drive_file_id", "drive_file_name", "last_updated", "song_title"
        }
        if field_name not in allowed_fields:
            raise ValueError(f"Field {field_name} not allowed for direct update")
        with self._get_connection() as conn:
            conn.execute(f"UPDATE performances SET {field_name} = ? WHERE entry_id = ?", (value, entry_id))
            conn.commit()

    def set_last_sync_time(self, ts: Optional[str] = None):
        if not ts:
            ts = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            conn.execute("""
            INSERT INTO sync_meta (key, value) VALUES ('last_synced_at', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """, (ts,))
            conn.commit()

    def get_last_sync_time(self) -> Optional[str]:
        try:
            with self._get_connection() as conn:
                row = conn.execute("SELECT value FROM sync_meta WHERE key='last_synced_at'").fetchone()
                return row["value"] if row else None
        except Exception:
            return None

    def set_dirty_sequence(self, is_dirty: bool = True):
        with self._get_connection() as conn:
            conn.execute("""
            INSERT INTO sync_meta (key, value) VALUES ('sequence_dirty', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """, ("1" if is_dirty else "0",))
            conn.commit()

    def is_sequence_dirty(self) -> bool:
        try:
            with self._get_connection() as conn:
                row = conn.execute("SELECT value FROM sync_meta WHERE key='sequence_dirty'").fetchone()
                return bool(row and row["value"] == "1")
        except Exception:
            return False

    def reset_database(self):
        """Drops and re-creates tables cleanly on user request."""
        with self._get_connection() as conn:
            conn.execute("DROP TABLE IF EXISTS performances")
            conn.execute("DROP TABLE IF EXISTS sync_meta")
            conn.commit()
        self._ensure_db()

db_service = DBService()
