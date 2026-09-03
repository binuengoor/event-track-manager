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
                entry_id="PK-001",
                performer_name="Rahul Nair",
                performance_type="Solo",
                partner_name=None,
                song_title="Tum Hi Ho",
                sequence_order=1,
                track_status="Uploaded",
                drive_file_id="mock_drive_file_001",
                last_updated="2026-09-01T14:30:00",
                row_index=2
            ),
            PerformanceEntry(
                entry_id="PK-002",
                performer_name="Ananya Menon",
                performance_type="Duet",
                partner_name="Vivek Krishna",
                song_title="Vaseegara",
                sequence_order=2,
                track_status="Pending",
                drive_file_id=None,
                last_updated=None,
                row_index=3
            ),
            PerformanceEntry(
                entry_id="PK-003",
                performer_name="Manoj Varma",
                performance_type="Acoustic",
                partner_name=None,
                song_title="Hotel California (Acoustic)",
                sequence_order=3,
                track_status="Acoustic",
                drive_file_id=None,
                last_updated=None,
                row_index=4
            ),
            PerformanceEntry(
                entry_id="PK-004",
                performer_name="Deepa Pillai",
                performance_type="Solo",
                partner_name=None,
                song_title="Aayiram Kannumai",
                sequence_order=4,
                track_status="Uploaded",
                drive_file_id="mock_drive_file_004",
                last_updated="2026-09-02T10:15:00",
                row_index=5
            ),
            PerformanceEntry(
                entry_id="PK-005",
                performer_name="Vivek Krishna",
                performance_type="Solo",
                partner_name=None,
                song_title="Pichai Paathiram",
                sequence_order=5,
                track_status="Pending",
                drive_file_id=None,
                last_updated=None,
                row_index=6
            ),
            PerformanceEntry(
                entry_id="PK-006",
                performer_name="Priya Thomas",
                performance_type="Duet",
                partner_name="Rahul Nair",
                song_title="Nenjukkul Peidhidum",
                sequence_order=6,
                track_status="Pending",
                drive_file_id=None,
                last_updated=None,
                row_index=7
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
            logger.info("Successfully authenticated with Google Sheets & Drive APIs via Service Account.")
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
                def get_col(col_idx: int) -> str:
                    return str(row[col_idx]).strip() if col_idx < len(row) else ""

                entry_id = get_col(cols.entry_id)
                performer_name = get_col(cols.performer_name)
                if not entry_id or not performer_name:
                    continue

                seq_str = get_col(cols.sequence_order)
                seq_val = int(seq_str) if seq_str.isdigit() else None

                entries.append(PerformanceEntry(
                    entry_id=entry_id,
                    performer_name=performer_name,
                    performance_type=get_col(cols.performance_type) or "Solo",
                    partner_name=get_col(cols.partner_name) or None,
                    song_title=get_col(cols.song_title) or "Untitled Song",
                    sequence_order=seq_val,
                    track_status=get_col(cols.track_status) or "Pending",
                    drive_file_id=get_col(cols.drive_file_id) or None,
                    last_updated=get_col(cols.last_updated) or None,
                    row_index=idx + 2  # Assuming 1-based indexing and headers in row 1
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

        cols = settings.columns
        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)
        if not target:
            raise ValueError(f"Performance entry {entry_id} not found in Google Sheet")

        def col_letter(col_idx: int) -> str:
            return chr(ord('A') + col_idx)

        # Update columns G (status), H (file_id), I (last_updated)
        sheet_tab = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Signups"
        start_col = col_letter(min(cols.track_status, cols.drive_file_id, cols.last_updated))
        end_col = col_letter(max(cols.track_status, cols.drive_file_id, cols.last_updated))
        update_range = f"{sheet_tab}!{start_col}{target.row_index}:{end_col}{target.row_index}"

        # Build values mapping row width
        max_idx = max(cols.track_status, cols.drive_file_id, cols.last_updated)
        min_idx = min(cols.track_status, cols.drive_file_id, cols.last_updated)
        width = max_idx - min_idx + 1
        row_vals = [""] * width
        row_vals[cols.track_status - min_idx] = status
        row_vals[cols.drive_file_id - min_idx] = file_id
        row_vals[cols.last_updated - min_idx] = now_iso

        body = {"values": [row_vals]}
        self.sheets.spreadsheets().values().update(
            spreadsheetId=settings.google.sheet_id,
            range=update_range,
            valueInputOption="USER_ENTERED",
            body=body
        ).execute()
        return True

    def update_status(self, entry_id: str, status: str) -> bool:
        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.track_status = status
                    return True
            return False

        cols = settings.columns
        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)
        if not target:
            raise ValueError(f"Performance entry {entry_id} not found in Google Sheet")

        def col_letter(col_idx: int) -> str:
            return chr(ord('A') + col_idx)

        sheet_tab = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Signups"
        cell = f"{sheet_tab}!{col_letter(cols.track_status)}{target.row_index}"

        self.sheets.spreadsheets().values().update(
            spreadsheetId=settings.google.sheet_id,
            range=cell,
            valueInputOption="USER_ENTERED",
            body={"values": [[status]]}
        ).execute()
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
