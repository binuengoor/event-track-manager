import os
import io
import time
import logging
from datetime import datetime
from typing import List, Optional, Any

from app.config import settings
from app.schemas import PerformanceEntry
from app.services.db_service import db_service

logger = logging.getLogger("google-drive")


class GoogleDriveClient:
    """Manages Google Drive v3 file operations: upload, download, archiving, and track reconciliation."""

    def __init__(self, drive_service: Optional[Any] = None, mock_mode: bool = False):
        self.drive = drive_service
        self.mock_mode = mock_mode
        self._last_reconcile = 0.0

    def reconcile_drive_tracks(self, entries: List[PerformanceEntry], force: bool = False) -> List[PerformanceEntry]:
        """Reconciles Google Drive Active folder backing tracks against performance entries directly in SQLite."""
        if self.mock_mode or not self.drive:
            return entries

        now = time.time()
        if not force and (now - self._last_reconcile) < 15.0:
            return entries
        self._last_reconcile = now

        try:
            folder_id = settings.google.drive_folders.active_folder_id
            if not folder_id:
                return entries

            q = f"'{folder_id}' in parents and trashed = false"
            res = self.drive.files().list(
                q=q,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                fields="files(id, name)"
            ).execute()
            active_files = res.get("files", [])
            active_file_ids = {f["id"] for f in active_files}

            prefix = getattr(settings, "entry_id_prefix", "PK") or "PK"
            active_by_entry = {}
            for f in active_files:
                fname = f.get("name", "")
                for part in fname.split("_"):
                    if part.startswith(f"{prefix}-") or part.startswith("PK-"):
                        active_by_entry[part] = f
                        break

            for p in entries:
                matched_file = None
                if p.drive_file_id and p.drive_file_id in active_file_ids:
                    matched_file = next((f for f in active_files if f["id"] == p.drive_file_id), None)
                elif p.entry_id in active_by_entry:
                    matched_file = active_by_entry[p.entry_id]

                if matched_file:
                    target_status = "Acoustic" if p.track_status == "Acoustic" else "Uploaded"
                    if p.drive_file_id != matched_file["id"] or p.drive_file_name != matched_file.get("name") or p.track_status != target_status:
                        p.drive_file_id = matched_file["id"]
                        p.drive_file_name = matched_file.get("name")
                        p.track_status = target_status
                        db_service.update_performance_field(p.entry_id, "drive_file_id", p.drive_file_id)
                        db_service.update_performance_field(p.entry_id, "drive_file_name", p.drive_file_name)
                        db_service.update_performance_field(p.entry_id, "track_status", p.track_status)
                else:
                    if p.track_status == "Uploaded" and p.drive_file_id and p.drive_file_id not in active_file_ids:
                        p.drive_file_id = None
                        p.drive_file_name = None
                        p.track_status = "Pending"
                        db_service.update_performance_field(p.entry_id, "drive_file_id", None)
                        db_service.update_performance_field(p.entry_id, "drive_file_name", None)
                        db_service.update_performance_field(p.entry_id, "track_status", "Pending")
        except Exception as ex:
            logger.warning("Drive track reconciliation failed: %s", ex)

        return entries

    def archive_all_active_files_for_entry(self, entry_id: str) -> List[str]:
        """Finds any files in Active/ folder that start with entry_id and moves them to Archive/."""
        if self.mock_mode or not self.drive:
            return []

        active_id = settings.google.drive_folders.active_folder_id
        archive_id = settings.google.drive_folders.archive_folder_id
        if not active_id or not archive_id:
            return []

        clean_id = entry_id.strip()
        timestamp_str = datetime.now().strftime("%Y%m%d-%H%M%S")
        archived = []

        try:
            query = f"'{active_id}' in parents and (name contains '{clean_id}') and trashed = false"
            res = self.drive.files().list(
                q=query,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                fields="files(id, name)"
            ).execute()
            files = res.get("files", [])

            for f in files:
                fid = f["id"]
                old_name = f.get("name", "")
                base, ext = os.path.splitext(old_name)
                new_name = f"{base}_archived_{timestamp_str}{ext}"

                self.drive.files().update(
                    fileId=fid,
                    addParents=archive_id,
                    removeParents=active_id,
                    body={"name": new_name},
                    supportsAllDrives=True
                ).execute()
                archived.append(fid)
                logger.info("Archived active file %s (%s -> %s) to Archive/ folder", fid, old_name, new_name)
            return archived
        except Exception as e:
            logger.warning("Error during archive_all_active_files_for_entry for %s: %s", entry_id, e)
            return []

    def upload_file_to_active(self, file_path: str, filename: str, entry_id: Optional[str] = None, mime_type: str = "audio/mpeg") -> str:
        if self.mock_mode or not self.drive:
            mock_id = f"mock_drive_{os.path.basename(file_path)}"
            logger.info("MOCK DRIVE: Uploaded %s to Active folder (mock ID: %s)", filename, mock_id)
            return mock_id

        if entry_id:
            self.archive_all_active_files_for_entry(entry_id)

        from googleapiclient.http import MediaFileUpload

        file_metadata = {
            "name": filename,
            "parents": [settings.google.drive_folders.active_folder_id]
        }
        media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)
        uploaded = self.drive.files().create(
            body=file_metadata,
            media_body=media,
            supportsAllDrives=True,
            fields="id, name"
        ).execute()

        file_id = uploaded.get("id")
        logger.info("Uploaded %s to Google Drive Active/ folder (ID: %s)", filename, file_id)
        return file_id

    def archive_previous_file(self, file_id: str, original_filename: str) -> bool:
        if self.mock_mode or not self.drive:
            logger.info("MOCK DRIVE: Moved file %s to Archive folder", file_id)
            return True

        timestamp_str = datetime.now().strftime("%Y%m%d-%H%M%S")
        base, ext = os.path.splitext(original_filename)
        archived_name = f"{base}_archived_{timestamp_str}{ext}"

        active_id = settings.google.drive_folders.active_folder_id
        archive_id = settings.google.drive_folders.archive_folder_id

        try:
            self.drive.files().update(
                fileId=file_id,
                addParents=archive_id,
                removeParents=active_id,
                body={"name": archived_name},
                supportsAllDrives=True
            ).execute()
            logger.info("Archived file %s -> %s in Archive/ folder", file_id, archived_name)
            return True
        except Exception as e:
            logger.warning("Could not archive file %s: %s", file_id, e)
            return False

    def download_file_bytes(self, file_id: str) -> Optional[bytes]:
        if self.mock_mode or not self.drive:
            return None

        from googleapiclient.http import MediaIoBaseDownload
        try:
            request = self.drive.files().get_media(fileId=file_id, supportsAllDrives=True)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            return fh.getvalue()
        except Exception as e:
            logger.error("Failed to download file %s from Google Drive: %s", file_id, e)
            return None

    def get_file_metadata(self, file_id: str) -> Optional[dict]:
        if self.mock_mode or not self.drive:
            return None
        try:
            return self.drive.files().get(fileId=file_id, fields="id, name, mimeType", supportsAllDrives=True).execute()
        except Exception as e:
            logger.warning("Could not get metadata for file %s: %s", file_id, e)
            return None
