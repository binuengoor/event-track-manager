import os
import io
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger("google-service")

class PerformanceEntry(BaseModel):
    entry_id: str
    performer_name: str
    performance_type: str = "Solo"
    partner_name: Optional[str] = None
    song_title: str
    movie_name: Optional[str] = None
    youtube_url: Optional[str] = None
    sequence_order: Optional[int] = None
    track_status: str = "Pending"
    drive_file_id: Optional[str] = None
    last_updated: Optional[str] = None
    row_index: int = 0

class GoogleService:
    def __init__(self):
        self.mock_mode = settings.mock_google_api
        self.sheets = None
        self.drive = None
        self._mock_data: List[PerformanceEntry] = []

        if self.mock_mode:
            logger.info("Initializing GoogleService in MOCK MODE (No external API calls)")
            self._init_mock_data()
        else:
            self._init_real_clients()

    def _init_mock_data(self):
        self._mock_data = [
            PerformanceEntry(
                entry_id="PK-002",
                performer_name="Joshua Sohan (Neeta Philip)",
                performance_type="Solo",
                partner_name=None,
                song_title="Puthumazha",
                movie_name="Sarvam Maya",
                youtube_url="https://www.youtube.com/watch?v=SNwHuc-4pao",
                sequence_order=1,
                track_status="Uploaded",
                drive_file_id="mock_drive_file_001",
                last_updated="2026-09-01T14:30:00",
                row_index=2
            ),
            PerformanceEntry(
                entry_id="PK-003",
                performer_name="Nandhini Sankar (Anu Sankar S)",
                performance_type="Solo",
                partner_name=None,
                song_title="Attuthottil",
                movie_name="Athiran",
                youtube_url=None,
                sequence_order=2,
                track_status="Pending",
                drive_file_id=None,
                last_updated=None,
                row_index=3
            ),
            PerformanceEntry(
                entry_id="PK-004",
                performer_name="Ishaan Anoop (Anoop M)",
                performance_type="Solo",
                partner_name=None,
                song_title="Malayalam Song",
                movie_name=None,
                youtube_url=None,
                sequence_order=3,
                track_status="Pending",
                drive_file_id=None,
                last_updated=None,
                row_index=4
            ),
            PerformanceEntry(
                entry_id="PK-020",
                performer_name="Akshara Jaikumar",
                performance_type="Acoustic",
                partner_name=None,
                song_title="Live Music",
                movie_name=None,
                youtube_url=None,
                sequence_order=19,
                track_status="Acoustic",
                drive_file_id=None,
                last_updated=None,
                row_index=20
            )
        ]

    def _init_real_clients(self):
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            creds_path = settings.google.service_account_json_path
            if not os.path.isfile(creds_path):
                raise FileNotFoundError(f"Service account file not found at {creds_path}")

            scopes = [
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"
            ]
            creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
            self.sheets = build("sheets", "v4", credentials=creds)
            self.drive = build("drive", "v3", credentials=creds)
            logger.info("Successfully connected to live Google Sheets and Google Drive via Service Account.")
        except Exception as e:
            logger.error("Failed to initialize Google clients (%s). Falling back to MOCK MODE.", e)
            self.mock_mode = True
            self._init_mock_data()

    def get_performances(self) -> List[PerformanceEntry]:
        if self.mock_mode:
            return self._mock_data

        cols = settings.columns
        try:
            result = self.sheets.spreadsheets().values().get(
                spreadsheetId=settings.google.sheet_id,
                range=settings.google.sheet_range
            ).execute()
            rows = result.get("values", [])
            entries: List[PerformanceEntry] = []

            for idx, row in enumerate(rows):
                row_index = idx + 2  # Row 1 is header

                def get_col(col_idx: int) -> str:
                    return str(row[col_idx]).strip() if 0 <= col_idx < len(row) else ""

                performer_name = get_col(cols.performer_name)
                if not performer_name:
                    continue

                entry_id = get_col(cols.entry_id) if cols.entry_id >= 0 else ""
                if not entry_id:
                    entry_id = f"PK-{row_index:03d}"

                # Parse sequence order
                seq_str = get_col(cols.sequence_order)
                seq_val = None
                if seq_str:
                    try:
                        seq_val = int(float(seq_str))
                    except ValueError:
                        seq_val = None

                # Song title with fallback to movie or generic
                song_title = get_col(cols.song_title)
                movie_name = get_col(cols.movie_name)
                if not song_title:
                    if movie_name:
                        song_title = f"{movie_name} (Track)"
                    else:
                        song_title = f"Performance #{seq_val or row_index}"

                # Normalize status
                raw_status = get_col(cols.track_status)
                perf_type = get_col(cols.performance_type) or "Solo"

                if raw_status.lower() in ("yes", "uploaded", "true"):
                    status = "Uploaded"
                elif raw_status.lower() in ("performed", "done"):
                    status = "Performed"
                elif "acoustic" in perf_type.lower() or "live" in song_title.lower():
                    status = "Acoustic"
                elif raw_status:
                    status = raw_status
                else:
                    status = "Pending"

                drive_id = get_col(cols.drive_file_id) or None
                last_up = get_col(cols.last_updated) or None
                yt_link = get_col(cols.youtube_url) or None

                entries.append(PerformanceEntry(
                    entry_id=entry_id,
                    performer_name=performer_name,
                    performance_type=perf_type,
                    partner_name=get_col(cols.partner_name) or None,
                    song_title=song_title,
                    movie_name=movie_name or None,
                    youtube_url=yt_link,
                    sequence_order=seq_val,
                    track_status=status,
                    drive_file_id=drive_id,
                    last_updated=last_up,
                    row_index=row_index
                ))
            return entries
        except Exception as e:
            logger.error("Error fetching performances from Google Sheet: %s", e)
            raise

    def get_stage_queue(self) -> List[PerformanceEntry]:
        performances = self.get_performances()
        sequenced = [p for p in performances if p.sequence_order is not None]
        sequenced.sort(key=lambda x: x.sequence_order)
        return sequenced

    def update_track_metadata(self, entry_id: str, file_id: str, status: str = "Uploaded") -> bool:
        now_iso = datetime.now().isoformat(timespec="seconds")
        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.drive_file_id = file_id
                    item.track_status = status
                    item.last_updated = now_iso
                    return True
            return False

        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)
        if not target:
            raise ValueError(f"Performance entry {entry_id} not found in Google Sheet")

        cols = settings.columns
        sheet_tab = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Song Sign-Up"

        def col_letter(col_idx: int) -> str:
            return chr(ord('A') + col_idx)

        updates = []
        # Update Track Uploaded column
        updates.append({
            "range": f"{sheet_tab}!{col_letter(cols.track_status)}{target.row_index}",
            "values": [["Yes"]]
        })
        # Update Drive File ID
        updates.append({
            "range": f"{sheet_tab}!{col_letter(cols.drive_file_id)}{target.row_index}",
            "values": [[file_id]]
        })
        # Update Last Updated
        updates.append({
            "range": f"{sheet_tab}!{col_letter(cols.last_updated)}{target.row_index}",
            "values": [[now_iso]]
        })

        self.sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=settings.google.sheet_id,
            body={
                "valueInputOption": "USER_ENTERED",
                "data": updates
            }
        ).execute()
        logger.info("Updated Google Sheet for %s (Row %d) with file_id: %s", entry_id, target.row_index, file_id)
        return True

    def update_status(self, entry_id: str, status: str) -> bool:
        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.track_status = status
                    return True
            return False

        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)
        if not target:
            raise ValueError(f"Performance entry {entry_id} not found in Google Sheet")

        cols = settings.columns
        sheet_tab = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Song Sign-Up"

        def col_letter(col_idx: int) -> str:
            return chr(ord('A') + col_idx)

        val_to_write = "Performed" if status == "Performed" else ("Yes" if status == "Uploaded" else status)
        cell = f"{sheet_tab}!{col_letter(cols.track_status)}{target.row_index}"

        self.sheets.spreadsheets().values().update(
            spreadsheetId=settings.google.sheet_id,
            range=cell,
            valueInputOption="USER_ENTERED",
            body={"values": [[val_to_write]]}
        ).execute()
        logger.info("Updated status for %s (Row %d) to %s", entry_id, target.row_index, val_to_write)
        return True

    def upload_file_to_active(self, file_path: str, filename: str, mime_type: str = "audio/mpeg") -> str:
        if self.mock_mode:
            mock_id = f"mock_drive_{os.path.basename(file_path)}"
            logger.info("MOCK DRIVE: Uploaded %s to Active folder (mock ID: %s)", filename, mock_id)
            return mock_id

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
        if self.mock_mode:
            logger.info("MOCK DRIVE: Moved file %s to Archive folder", file_id)
            return True

        timestamp_str = datetime.now().strftime("%Y%m%d-%H%M%S")
        base, ext = os.path.splitext(original_filename)
        archived_name = f"{base}_archived_{timestamp_str}{ext}"

        active_id = settings.google.drive_folders.active_folder_id
        archive_id = settings.google.drive_folders.archive_folder_id

        self.drive.files().update(
            fileId=file_id,
            addParents=archive_id,
            removeParents=active_id,
            body={"name": archived_name},
            supportsAllDrives=True
        ).execute()
        logger.info("Archived file %s -> %s in Archive/ folder", file_id, archived_name)
        return True

    def download_file_bytes(self, file_id: str) -> Optional[bytes]:
        if self.mock_mode:
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

google_service = GoogleService()
