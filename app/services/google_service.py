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
    sequence_order: Optional[int] = None
    performance_status: str = "Upcoming" # Col K: Upcoming, On Stage, Performed, On Hold
    track_status: str = "Pending"        # Col L: Uploaded, Pending, Acoustic
    duration: Optional[str] = None      # Col M: Duration (Minutes)
    drive_file_id: Optional[str] = None # Col N: Drive File ID
    last_updated: Optional[str] = None  # Col O: Last Updated
    row_index: int = 0
    is_song_name_missing: bool = False

class GoogleService:
    def __init__(self):
        self.mock_mode = settings.mock_google_api
        self.sheets = None
        self.drive = None
        self.is_xlsx = False
        self._mock_data: List[PerformanceEntry] = []
        self.active_entry_id: Optional[str] = None

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
                sequence_order=1,
                performance_status="On Stage",
                track_status="Uploaded",
                duration="04:28",
                drive_file_id="mock_drive_file_001",
                last_updated="2026-09-01T14:30:00",
                row_index=2,
                is_song_name_missing=False
            ),
            PerformanceEntry(
                entry_id="PK-003",
                performer_name="Nandhini Sankar (Anu Sankar S)",
                performance_type="Solo",
                partner_name=None,
                song_title="Attuthottil",
                movie_name="Athiran",
                sequence_order=2,
                performance_status="Upcoming",
                track_status="Pending",
                duration=None,
                drive_file_id=None,
                last_updated=None,
                row_index=3,
                is_song_name_missing=False
            ),
            PerformanceEntry(
                entry_id="PK-004",
                performer_name="Ishaan Anoop (Anoop M)",
                performance_type="Solo",
                partner_name=None,
                song_title="Performance #3 (Song title missing)",
                movie_name=None,
                sequence_order=3,
                performance_status="Upcoming",
                track_status="Pending",
                duration=None,
                drive_file_id=None,
                last_updated=None,
                row_index=4,
                is_song_name_missing=True
            ),
            PerformanceEntry(
                entry_id="PK-020",
                performer_name="Akshara Jaikumar",
                performance_type="Acoustic",
                partner_name=None,
                song_title="Live Music",
                movie_name=None,
                sequence_order=4,
                performance_status="Upcoming",
                track_status="Acoustic",
                duration=None,
                drive_file_id=None,
                last_updated=None,
                row_index=20,
                is_song_name_missing=False
            )
        ]
        self.active_entry_id = None

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

            meta = self.drive.files().get(
                fileId=settings.google.sheet_id,
                supportsAllDrives=True,
                fields="id, name, mimeType"
            ).execute()
            mime = meta.get("mimeType", "")
            self.is_xlsx = ("spreadsheetml.sheet" in mime or meta.get("name", "").endswith(".xlsx"))
            logger.info("Connected to target sheet: %s (Type: %s, is_xlsx=%s)", meta.get("name"), mime, self.is_xlsx)
        except Exception as e:
            logger.error("Failed to initialize Google clients (%s). Falling back to MOCK MODE.", e)
            self.mock_mode = True
            self._init_mock_data()

    def get_performances(self) -> List[PerformanceEntry]:
        if self.mock_mode:
            return self._mock_data

        cols = settings.columns
        tab_name = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Song Sign-Up"

        try:
            raw_rows = []
            if self.is_xlsx:
                import openpyxl
                content = self.drive.files().get_media(fileId=settings.google.sheet_id, supportsAllDrives=True).execute()
                wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
                ws = wb[tab_name] if tab_name in wb.sheetnames else wb.active
                for r in ws.iter_rows(min_row=2, values_only=True):
                    raw_rows.append([str(c).strip() if c is not None else "" for c in r])
            else:
                result = self.sheets.spreadsheets().values().get(
                    spreadsheetId=settings.google.sheet_id,
                    range=settings.google.sheet_range
                ).execute()
                raw_rows = result.get("values", [])

            entries: List[PerformanceEntry] = []
            for idx, row in enumerate(raw_rows):
                row_index = idx + 2

                def get_col(col_idx: int) -> str:
                    return str(row[col_idx]).strip() if 0 <= col_idx < len(row) else ""

                performer_name = get_col(cols.performer_name)
                if not performer_name or performer_name.lower().startswith("singer"):
                    continue

                entry_id = get_col(cols.entry_id) if cols.entry_id >= 0 else ""
                if not entry_id:
                    entry_id = f"PK-{row_index:03d}"

                # Parse sequence order if already set
                seq_str = get_col(cols.sequence_order)
                seq_val = None
                if seq_str:
                    try:
                        seq_val = int(float(seq_str))
                    except ValueError:
                        seq_val = None

                # Song title
                raw_song_title = get_col(cols.song_title)
                movie_name = get_col(cols.movie_name)
                is_missing = not bool(raw_song_title)

                if raw_song_title:
                    song_title = raw_song_title
                elif movie_name:
                    song_title = f"{movie_name} (Song title missing)"
                else:
                    song_title = f"Performance (Song title missing)"

                perf_type = get_col(cols.performance_type) or "Solo"

                # Performance Status (Col K)
                raw_perf_status = get_col(cols.performance_status)
                if not raw_perf_status or raw_perf_status.startswith("http"):
                    perf_status = "Upcoming"
                elif raw_perf_status.lower() in ("performed", "done", "completed"):
                    perf_status = "Performed"
                elif raw_perf_status.lower() in ("on stage", "live", "playing"):
                    perf_status = "On Stage"
                elif raw_perf_status.lower() in ("skipped", "hold", "on hold"):
                    perf_status = "On Hold"
                else:
                    perf_status = "Upcoming"

                # Track Status (Col L)
                raw_track_status = get_col(cols.track_status)
                if raw_track_status.lower() in ("yes", "uploaded", "true"):
                    track_status = "Uploaded"
                elif "acoustic" in perf_type.lower() or "live" in song_title.lower() or raw_track_status.lower() == "acoustic":
                    track_status = "Acoustic"
                elif raw_track_status.lower() in ("performed", "done"):
                    # fallback if track uploaded col had performed
                    track_status = "Uploaded"
                elif raw_track_status:
                    track_status = raw_track_status
                else:
                    track_status = "Pending"

                duration_val = get_col(cols.duration) or None
                drive_id = get_col(cols.drive_file_id) or None
                last_up = get_col(cols.last_updated) or None

                entries.append(PerformanceEntry(
                    entry_id=entry_id,
                    performer_name=performer_name,
                    performance_type=perf_type,
                    partner_name=get_col(cols.partner_name) or None,
                    song_title=song_title,
                    movie_name=movie_name or None,
                    sequence_order=seq_val,
                    performance_status=perf_status,
                    track_status=track_status,
                    duration=duration_val,
                    drive_file_id=drive_id,
                    last_updated=last_up,
                    row_index=row_index,
                    is_song_name_missing=is_missing
                ))

            # Sequence backfill logic:
            # If any rows are missing sequence numbers, fill them from top to bottom
            used_seqs = set(p.sequence_order for p in entries if p.sequence_order is not None)
            missing_items = []
            next_seq = 1
            for p in entries:
                if p.sequence_order is None:
                    while next_seq in used_seqs:
                        next_seq += 1
                    p.sequence_order = next_seq
                    used_seqs.add(next_seq)
                    missing_items.append({"entry_id": p.entry_id, "sequence_order": next_seq})

            # Fix song titles for missing titles with their sequence
            for p in entries:
                if p.is_song_name_missing and "Performance (Song" in p.song_title:
                    p.song_title = f"Performance #{p.sequence_order} (Song title missing)"

            return entries
        except Exception as e:
            logger.error("Error fetching performances from Google Sheet: %s", e)
            raise

    def get_stage_queue(self) -> List[PerformanceEntry]:
        performances = self.get_performances()
        # Sort all entries by sequence_order
        performances.sort(key=lambda x: x.sequence_order if x.sequence_order is not None else 9999)
        return performances

    def get_live_status(self) -> Dict[str, Any]:
        queue = self.get_stage_queue()
        now_performing = None
        up_next = []
        upcoming = []
        performed = []
        on_hold = []

        # Find active performance only if explicitly cued
        if self.active_entry_id:
            now_performing = next((p for p in queue if p.entry_id == self.active_entry_id), None)

        now_id = now_performing.entry_id if now_performing else None

        for p in queue:
            if p.entry_id == now_id:
                continue
            if p.performance_status == "Performed":
                performed.append(p)
            elif p.performance_status == "On Hold":
                on_hold.append(p)
            else:
                if len(up_next) < 2:
                    up_next.append(p)
                else:
                    upcoming.append(p)

        return {
            "event_name": settings.event.name,
            "now_performing": now_performing,
            "up_next": up_next,
            "upcoming": upcoming,
            "performed": performed,
            "on_hold": on_hold,
            "total_count": len(queue),
            "completed_count": len(performed)
        }

    def set_active_performance(self, entry_id: str) -> bool:
        self.active_entry_id = entry_id
        # Optionally update performance_status in sheet
        self.update_status(entry_id, "On Stage")
        return True

    def update_track_metadata(self, entry_id: str, file_id: str, status: str = "Uploaded", duration_str: Optional[str] = None) -> bool:
        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.drive_file_id = file_id
                    item.track_status = status
                    item.duration = duration_str or item.duration
                    item.last_updated = now_iso
                    return True
            return False

        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)
        if not target:
            raise ValueError(f"Performance entry {entry_id} not found in Google Sheet")

        cols = settings.columns
        tab_name = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Song Sign-Up"

        if self.is_xlsx:
            import openpyxl
            from googleapiclient.http import MediaIoBaseUpload

            content = self.drive.files().get_media(fileId=settings.google.sheet_id, supportsAllDrives=True).execute()
            wb = openpyxl.load_workbook(io.BytesIO(content))
            ws = wb[tab_name] if tab_name in wb.sheetnames else wb.active

            row = target.row_index
            # Col L: Track Uploaded = "Yes"
            ws.cell(row=row, column=cols.track_status + 1, value="Yes")
            if duration_str:
                ws.cell(row=row, column=cols.duration + 1, value=duration_str)
            ws.cell(row=row, column=cols.drive_file_id + 1, value=file_id)
            ws.cell(row=row, column=cols.last_updated + 1, value=now_iso)

            out_buf = io.BytesIO()
            wb.save(out_buf)
            out_buf.seek(0)

            media = MediaIoBaseUpload(out_buf, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable=True)
            self.drive.files().update(fileId=settings.google.sheet_id, media_body=media, supportsAllDrives=True).execute()
            logger.info("Updated Excel sheet for %s (Row %d) with file_id: %s, duration: %s", entry_id, row, file_id, duration_str)
            return True
        else:
            def col_letter(col_idx: int) -> str:
                return chr(ord('A') + col_idx)

            updates = [
                {"range": f"{tab_name}!{col_letter(cols.track_status)}{target.row_index}", "values": [["Yes"]]},
                {"range": f"{tab_name}!{col_letter(cols.drive_file_id)}{target.row_index}", "values": [[file_id]]},
                {"range": f"{tab_name}!{col_letter(cols.last_updated)}{target.row_index}", "values": [[now_iso]]}
            ]
            if duration_str:
                updates.append({"range": f"{tab_name}!{col_letter(cols.duration)}{target.row_index}", "values": [[duration_str]]})

            self.sheets.spreadsheets().values().batchUpdate(
                spreadsheetId=settings.google.sheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": updates}
            ).execute()
            logger.info("Updated Google Sheet for %s (Row %d) with file_id: %s", entry_id, target.row_index, file_id)
            return True

    def update_status(self, entry_id: str, status: str) -> bool:
        """Updates Performance Status (Col K) and optionally Track Status (Col L)."""
        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.performance_status = status
                    return True
            return False

        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)
        if not target:
            raise ValueError(f"Performance entry {entry_id} not found in Google Sheet")

        cols = settings.columns
        tab_name = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Song Sign-Up"

        # Determine value to write to Col K (Performance Status)
        val_to_write = status
        if status in ("Uploaded", "Upcoming", "Reset"):
            val_to_write = "Upcoming"
        elif status == "Performed":
            val_to_write = "Performed"
        elif status in ("Skipped", "On Hold"):
            val_to_write = "On Hold"
        elif status in ("On Stage", "Live"):
            val_to_write = "On Stage"

        if self.is_xlsx:
            import openpyxl
            from googleapiclient.http import MediaIoBaseUpload

            content = self.drive.files().get_media(fileId=settings.google.sheet_id, supportsAllDrives=True).execute()
            wb = openpyxl.load_workbook(io.BytesIO(content))
            ws = wb[tab_name] if tab_name in wb.sheetnames else wb.active

            ws.cell(row=target.row_index, column=cols.performance_status + 1, value=val_to_write)
            out_buf = io.BytesIO()
            wb.save(out_buf)
            out_buf.seek(0)

            media = MediaIoBaseUpload(out_buf, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable=True)
            self.drive.files().update(fileId=settings.google.sheet_id, media_body=media, supportsAllDrives=True).execute()
            logger.info("Updated performance status for %s (Row %d) to %s in Excel sheet", entry_id, target.row_index, val_to_write)
            return True
        else:
            def col_letter(col_idx: int) -> str:
                return chr(ord('A') + col_idx)

            cell = f"{tab_name}!{col_letter(cols.performance_status)}{target.row_index}"
            self.sheets.spreadsheets().values().update(
                spreadsheetId=settings.google.sheet_id,
                range=cell,
                valueInputOption="USER_ENTERED",
                body={"values": [[val_to_write]]}
            ).execute()
            logger.info("Updated performance status for %s (Row %d) to %s in Google Sheet", entry_id, target.row_index, val_to_write)
            return True

    def update_sequence_orders(self, items: List[Dict[str, Any]], sync_only: bool = False) -> int:
        item_map = {it["entry_id"]: int(it["sequence_order"]) for it in items if "entry_id" in it and "sequence_order" in it}
        if self.mock_mode:
            for p in self._mock_data:
                if p.entry_id in item_map:
                    p.sequence_order = item_map[p.entry_id]
            return len(item_map)

        performances = self.get_performances()
        cols = settings.columns
        tab_name = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Song Sign-Up"

        if self.is_xlsx:
            import openpyxl
            from googleapiclient.http import MediaIoBaseUpload

            content = self.drive.files().get_media(fileId=settings.google.sheet_id, supportsAllDrives=True).execute()
            wb = openpyxl.load_workbook(io.BytesIO(content))
            ws = wb[tab_name] if tab_name in wb.sheetnames else wb.active

            for p in performances:
                if p.entry_id in item_map:
                    ws.cell(row=p.row_index, column=cols.sequence_order + 1, value=item_map[p.entry_id])

            out_buf = io.BytesIO()
            wb.save(out_buf)
            out_buf.seek(0)

            media = MediaIoBaseUpload(out_buf, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", resumable=True)
            self.drive.files().update(fileId=settings.google.sheet_id, media_body=media, supportsAllDrives=True).execute()
            logger.info("Updated sequence order for %d items in Excel sheet", len(item_map))
            return len(item_map)
        else:
            def col_letter(col_idx: int) -> str:
                return chr(ord('A') + col_idx)

            updates = []
            for p in performances:
                if p.entry_id in item_map:
                    cell = f"{tab_name}!{col_letter(cols.sequence_order)}{p.row_index}"
                    updates.append({"range": cell, "values": [[item_map[p.entry_id]]]})

            if updates:
                self.sheets.spreadsheets().values().batchUpdate(
                    spreadsheetId=settings.google.sheet_id,
                    body={"valueInputOption": "USER_ENTERED", "data": updates}
                ).execute()
            logger.info("Updated sequence order for %d items in Google Sheet", len(item_map))
            return len(item_map)

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
