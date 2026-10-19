import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from app.config import settings, get_setting
from app.services.db_service import db_service
from app.services.export_service import export_service

logger = logging.getLogger("backup-service")


import time

class BackupService:
    def __init__(self):
        self._backup_task: Optional[asyncio.Task] = None
        self._pending_backup = False
        self._last_trigger_time: Optional[float] = None
        self._is_backing_up = False
        self._shutdown = False

    def start(self):
        """Starts the background debounce listener task."""
        if self._backup_task is None or self._backup_task.done():
            self._shutdown = False
            self._backup_task = asyncio.create_task(self._debounce_loop())
            logger.info("BackupService background loop started.")

    async def stop(self):
        """Gracefully stops the background loop."""
        self._shutdown = True
        if self._backup_task and not self._backup_task.done():
            self._backup_task.cancel()
            try:
                await self._backup_task
            except asyncio.CancelledError:
                pass
            logger.info("BackupService background loop stopped.")

    def trigger_backup(self):
        """Debounced trigger called whenever data is mutated."""
        enabled = get_setting("backup_enabled", settings.backup.enabled)
        if not enabled:
            return

        self._pending_backup = True
        self._last_trigger_time = time.time()
        logger.debug("Backup triggered; debounce timer reset.")

    async def _debounce_loop(self):
        """Watches for pending backups and executes after debounce delay."""
        while not self._shutdown:
            try:
                await asyncio.sleep(1.0)
                if not self._pending_backup or self._is_backing_up:
                    continue

                debounce_secs = getattr(settings.backup, "debounce_seconds", 10)
                now = time.time()
                if self._last_trigger_time and (now - self._last_trigger_time) >= debounce_secs:
                    self._pending_backup = False
                    await self.backup_now()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in backup debounce loop: %s", e)
                await asyncio.sleep(2.0)

    async def backup_now(self, force: bool = False) -> Dict[str, Any]:
        """Writes signups.xlsx/csv and a database snapshot into the event folder."""
        if self._is_backing_up:
            return {"status": "in_progress", "message": "Backup already running"}

        self._is_backing_up = True
        self._pending_backup = False
        log_id = db_service.log_backup_start()

        try:
            res = await asyncio.to_thread(export_service.export_now, True, force)
            rows_backed = res.get("rows_backed", 0)
            db_service.log_backup_success(log_id, rows_backed)
            db_service.set_last_sync_time()
            logger.info("Export completed: %d rows", rows_backed)
            return {
                "status": "success",
                "rows_backed": rows_backed,
                "files": res.get("files"),
                "snapshot": res.get("snapshot"),
                "event_dir": res.get("event_dir"),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            err_msg = str(e)
            logger.error("Export failed: %s", err_msg)
            db_service.log_backup_error(log_id, err_msg)
            return {"status": "error", "error": err_msg}
        finally:
            self._is_backing_up = False

    def get_backup_status(self) -> Dict[str, Any]:
        """Returns the current backup service status and recent backup history."""
        last_info = db_service.get_last_backup_info()
        history = db_service.get_backup_history(limit=10)
        enabled = get_setting("backup_enabled", settings.backup.enabled)
        return {
            "enabled": bool(enabled),
            "is_backing_up": self._is_backing_up,
            "has_pending_trigger": self._pending_backup,
            "backup_target_sheet": "signups.xlsx",
            "event_dir": settings.storage.event_dir,
            "last_backup": last_info,
            "history": history
        }


backup_service = BackupService()
