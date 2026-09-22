import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from app.repositories.base import BaseRepository

logger = logging.getLogger("audit-repo")


class AuditRepository(BaseRepository):
    """Repository for managing activity audit trail and database backup logs."""

    # =========================================================================
    # BACKUP LOGS
    # =========================================================================

    def log_backup_start(self) -> int:
        with self.get_connection() as conn:
            cursor = conn.execute("""
            INSERT INTO backup_log (triggered_at, status) VALUES (datetime('now'), 'pending')
            """)
            conn.commit()
            return cursor.lastrowid

    def log_backup_success(self, log_id: int, rows_backed: int):
        with self.get_connection() as conn:
            conn.execute("""
            UPDATE backup_log 
            SET completed_at = datetime('now'), status = 'success', rows_backed = ?
            WHERE id = ?
            """, (rows_backed, log_id))
            conn.commit()

    def log_backup_error(self, log_id: int, error_msg: str):
        with self.get_connection() as conn:
            conn.execute("""
            UPDATE backup_log 
            SET completed_at = datetime('now'), status = 'failed', error_msg = ?
            WHERE id = ?
            """, (error_msg, log_id))
            conn.commit()

    def get_backup_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("""
                SELECT * FROM backup_log ORDER BY id DESC LIMIT ?
                """, (limit,))
                return [dict(r) for r in cursor.fetchall()]
        except Exception as ex:
            logger.error(f"Error fetching backup history: {ex}")
            return []

    def get_last_backup_info(self) -> Optional[Dict[str, Any]]:
        try:
            with self.get_connection() as conn:
                row = conn.execute("""
                SELECT * FROM backup_log ORDER BY id DESC LIMIT 1
                """).fetchone()
                return dict(row) if row else None
        except Exception as ex:
            logger.error(f"Error fetching last backup info: {ex}")
            return None

    # =========================================================================
    # ACTIVITY / AUDIT LOGS
    # =========================================================================

    def log_activity(
        self,
        action_type: str,
        performer_name: str,
        summary: str,
        entry_id: str = "",
        details: str = "",
        source: str = "system"
    ) -> str:
        try:
            log_id = f"act_{uuid.uuid4().hex[:10]}"
            now_iso = datetime.now(timezone.utc).isoformat()
            with self.get_connection() as conn:
                conn.execute("""
                INSERT INTO activity_logs (log_id, timestamp, action_type, performer_name, entry_id, summary, details, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    log_id,
                    now_iso,
                    action_type.strip().lower(),
                    performer_name.strip(),
                    entry_id.strip() if entry_id else "",
                    summary.strip(),
                    details.strip() if details else "",
                    source.strip().lower()
                ))
                conn.commit()
            return log_id
        except Exception as ex:
            logger.error(f"Failed to log activity: {ex}")
            return ""

    def get_activity_logs(
        self,
        days: Optional[int] = 7,
        limit: int = 300,
        search: str = "",
        action_type: str = ""
    ) -> List[Dict[str, Any]]:
        try:
            with self.get_connection() as conn:
                query = "SELECT log_id, timestamp, action_type, performer_name, entry_id, summary, details, source FROM activity_logs WHERE 1=1"
                params = []

                if days and days > 0:
                    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
                    query += " AND timestamp >= ?"
                    params.append(cutoff)

                if action_type and action_type.strip() and action_type.strip().lower() != "all":
                    query += " AND action_type = ?"
                    params.append(action_type.strip().lower())

                if search and search.strip():
                    term = f"%{search.strip().lower()}%"
                    query += " AND (LOWER(performer_name) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(entry_id) LIKE ? OR LOWER(details) LIKE ?)"
                    params.extend([term, term, term, term])

                query += " ORDER BY timestamp DESC LIMIT ?"
                params.append(limit)

                rows = conn.execute(query, params).fetchall()
                return [dict(r) for r in rows]
        except Exception as ex:
            logger.error(f"Failed to fetch activity logs: {ex}")
            return []
