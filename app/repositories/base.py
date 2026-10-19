import os
import sqlite3
import logging
import threading
from typing import Callable, Optional, Any
from contextlib import contextmanager

from app.config import settings

logger = logging.getLogger("db-repository")


class DatabaseManager:
    """Manages SQLite thread-local connections, WAL mode PRAGMAs, and transaction contexts."""

    def __init__(self, db_path_or_getter: Optional[Any] = None):
        self._custom_db_path: Optional[str] = None
        self._db_path_getter: Optional[Callable[[], str]] = None
        self._local = threading.local()
        if callable(db_path_or_getter):
            self._db_path_getter = db_path_or_getter
        elif isinstance(db_path_or_getter, str):
            self._custom_db_path = db_path_or_getter

    @property
    def db_path(self) -> str:
        if self._custom_db_path:
            return self._custom_db_path
        if self._db_path_getter:
            return self._db_path_getter()
        event_dir = settings.storage.event_dir or settings.storage.cache_dir
        os.makedirs(event_dir, exist_ok=True)
        path = os.path.join(event_dir, "event.db")
        self._migrate_legacy_db(path)
        return path

    def _migrate_legacy_db(self, new_path: str):
        """One-time copy of a database from an older layout (/db volume or inside the audio cache)."""
        if os.path.exists(new_path):
            return
        candidates = []
        if os.getenv("DB_DIR"):
            candidates.append(os.path.join(os.getenv("DB_DIR"), "event_data.db"))
        candidates += ["/db/event_data.db", os.path.join(settings.storage.cache_dir, "event_data.db")]
        for legacy in candidates:
            if not os.path.isfile(legacy) or os.path.abspath(legacy) == os.path.abspath(new_path):
                continue
            try:
                src = sqlite3.connect(legacy)
                dst = sqlite3.connect(new_path)
                src.backup(dst)  # includes any data still in the -wal file
                dst.close()
                src.close()
                logger.warning("Migrated database from %s to %s (old copy left in place; delete it when satisfied).", legacy, new_path)
                return
            except Exception as ex:
                logger.error("Legacy database migration from %s failed: %s", legacy, ex)

    @db_path.setter
    def db_path(self, val: Optional[str]):
        self._custom_db_path = val
        self.close_all()

    def get_connection(self) -> sqlite3.Connection:
        path = self.db_path
        conns = getattr(self._local, "connections", None)
        if conns is None:
            self._local.connections = {}
            conns = self._local.connections

        conn = conns.get(path)
        if conn is not None:
            try:
                conn.execute("SELECT 1")
            except (sqlite3.ProgrammingError, sqlite3.OperationalError):
                try:
                    conn.close()
                except Exception:
                    pass
                conn = None

        if conn is None:
            conn = sqlite3.connect(path, timeout=15.0, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.row_factory = sqlite3.Row
            conns[path] = conn

        return conn

    def close_all(self):
        """Closes all thread-local connections on the current thread."""
        conns = getattr(self._local, "connections", {})
        for conn in conns.values():
            try:
                conn.close()
            except Exception:
                pass
        self._local.connections = {}

    @contextmanager
    def transaction(self):
        """Context manager providing an atomic transaction block with automatic commit/rollback."""
        conn = self.get_connection()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


default_db_manager = DatabaseManager()


class BaseRepository:
    """Base class for domain repositories with shared database manager."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or default_db_manager

    def get_connection(self) -> sqlite3.Connection:
        return self.db.get_connection()

    @property
    def transaction(self):
        return self.db.transaction
