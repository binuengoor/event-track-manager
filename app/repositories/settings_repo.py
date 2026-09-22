import json
import logging
from typing import Dict, Any, Optional
from app.repositories.base import BaseRepository

logger = logging.getLogger("settings-repo")


class SettingsRepository(BaseRepository):
    """Repository for managing key-value application settings stored in SQLite."""

    def get_setting(self, key: str) -> Optional[str]:
        try:
            with self.get_connection() as conn:
                row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
                return row["value"] if row else None
        except Exception as ex:
            logger.error(f"Error reading app setting {key}: {ex}")
            return None

    def set_setting(self, key: str, value: Any):
        val_str = value if isinstance(value, str) else json.dumps(value)
        with self.get_connection() as conn:
            conn.execute("""
            INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
            """, (key, val_str))
            conn.commit()

    def get_all_settings(self) -> Dict[str, str]:
        try:
            with self.get_connection() as conn:
                rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
                return {r["key"]: r["value"] for r in rows}
        except Exception as ex:
            logger.error(f"Error fetching all app settings: {ex}")
            return {}

    def seed_settings(self, defaults: Dict[str, Any]):
        """Seeds app_settings table with defaults if keys do not already exist."""
        try:
            with self.get_connection() as conn:
                for k, v in defaults.items():
                    val_str = v if isinstance(v, str) else json.dumps(v)
                    conn.execute("""
                    INSERT OR IGNORE INTO app_settings (key, value, updated_at)
                    VALUES (?, ?, datetime('now'))
                    """, (k, val_str))
                conn.commit()
        except Exception as ex:
            logger.error(f"Error seeding app settings: {ex}")
