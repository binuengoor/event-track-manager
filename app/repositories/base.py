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
        db_dir = settings.storage.db_dir or settings.storage.cache_dir
        os.makedirs(db_dir, exist_ok=True)
        path = os.path.join(db_dir, "event_data.db")
        self._migrate_legacy_db(path)
        return path

    def _migrate_legacy_db(self, new_path: str):
        """One-time move of the database from the old location (inside the audio cache)."""
        legacy = os.path.join(settings.storage.cache_dir, "event_data.db")
        if os.path.exists(new_path) or not os.path.isfile(legacy) or os.path.abspath(legacy) == os.path.abspath(new_path):
            return
        try:
            src = sqlite3.connect(legacy)
            dst = sqlite3.connect(new_path)
            src.backup(dst)  # includes any data still in the -wal file
            dst.close()
            src.close()
            logger.warning("Migrated database from %s to %s (legacy copy left in place; delete it).", legacy, new_path)
        except Exception as ex:
            logger.error("Legacy database migration failed: %s", ex)

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
