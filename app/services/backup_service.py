import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from app.config import settings, get_setting
from app.services.db_service import db_service
from app.services.google_service import google_service

logger = logging.getLogger("backup-service")


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
        loop = asyncio.get_event_loop()
        self._last_trigger_time = loop.time()
        logger.debug("Backup triggered; debounce timer reset.")

    async def _debounce_loop(self):
        """Watches for pending backups and executes after debounce delay."""
        while not self._shutdown:
            try:
                await asyncio.sleep(1.0)
                if not self._pending_backup or self._is_backing_up:
                    continue

                debounce_secs = getattr(settings.backup, "debounce_seconds", 10)
                now = asyncio.get_event_loop().time()
                if self._last_trigger_time and (now - self._last_trigger_time) >= debounce_secs:
                    self._pending_backup = False
                    await self.backup_now()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in backup debounce loop: %s", e)
                await asyncio.sleep(2.0)

    async def backup_now(self) -> Dict[str, Any]:
        """Performs an immediate backup snapshot of SQLite data to Google Sheet."""
        if self._is_backing_up:
            return {"status": "in_progress", "message": "Backup already running"}

        self._is_backing_up = True
        self._pending_backup = False
        log_id = db_service.log_backup_start()

        try:
            folder_id = (
                settings.backup.drive_folder_id
                or getattr(settings.google.drive_folders, "archive_folder_id", "")
                or getattr(settings.google.drive_folders, "active_folder_id", "")
            )
            event_id = get_setting("event_id", settings.event.id)
            sheet_title = f"{event_id}_backup"

            # Consistent snapshot from SQLite
            performances = db_service.get_all_performances()
            food_items = db_service.get_all_food_items_with_signups()

            # Execute write via google_service
            res = google_service.create_or_update_backup_sheet(
                folder_id=folder_id,
                title=sheet_title,
                performances=performances,
                food_items=food_items
            )

            rows_backed = res.get("rows_backed", len(performances) + len(food_items))
            db_service.log_backup_success(log_id, rows_backed)
            logger.info("Backup successfully completed: %d rows", rows_backed)
            return {
                "status": "success",
                "rows_backed": rows_backed,
                "sheet_title": sheet_title,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "file_id": res.get("file_id")
            }
        except Exception as e:
            err_msg = str(e)
            logger.error("Backup failed: %s", err_msg)
            db_service.log_backup_error(log_id, err_msg)
            return {
                "status": "error",
                "error": err_msg
            }
        finally:
            self._is_backing_up = False

    def get_backup_status(self) -> Dict[str, Any]:
        """Returns the current backup service status and recent backup history."""
        last_info = db_service.get_last_backup_info()
        history = db_service.get_backup_history(limit=10)
        enabled = get_setting("backup_enabled", settings.backup.enabled)
        event_id = get_setting("event_id", settings.event.id)

        return {
            "enabled": bool(enabled),
            "is_backing_up": self._is_backing_up,
            "has_pending_trigger": self._pending_backup,
            "backup_target_sheet": f"{event_id}_backup",
            "last_backup": last_info,
            "history": history
        }


backup_service = BackupService()
