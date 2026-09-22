import os
import io
import re
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

from app.config import settings
from app.schemas import PerformanceEntry
from app.services.db_service import db_service, is_placeholder_song_title
from app.services.google.auth import init_google_clients
from app.services.google.drive_client import GoogleDriveClient
from app.services.google.sheet_client import GoogleSheetClient
from app.services.google.sync import create_or_update_backup_sheet

logger = logging.getLogger("google-service")


class GoogleService:
    """
    Facade managing Google Sheets and Drive synchronization.
    Delegates Drive operations to GoogleDriveClient, Sheet operations to GoogleSheetClient,
    and auth to init_google_clients. Maintains full backward compatibility.
    """

    def __init__(self):
        self.mock_mode = settings.mock_google_api
        self.sheets = None
        self.drive = None
        self.is_xlsx = False
        self._mock_data: List[PerformanceEntry] = []

        if self.mock_mode:
            logger.info("Initializing GoogleService in MOCK MODE (No external API calls)")
            self._init_mock_data()
        else:
            self._init_real_clients()

        self._drive_client = GoogleDriveClient(self.drive, mock_mode=self.mock_mode)
        self._sheet_client = GoogleSheetClient(self.sheets, self.drive, is_xlsx=self.is_xlsx, mock_mode=self.mock_mode)

    @property
    def active_entry_id(self) -> Optional[str]:
        return db_service.get_active_entry_id()

    @active_entry_id.setter
    def active_entry_id(self, val: Optional[str]):
        db_service.set_active_entry_id(val)

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

    def _init_real_clients(self):
        self.sheets, self.drive, self.is_xlsx = init_google_clients()
        if not self.sheets or not self.drive:
            self.mock_mode = True
            self._init_mock_data()
        self._drive_client = GoogleDriveClient(self.drive, mock_mode=self.mock_mode)
        self._sheet_client = GoogleSheetClient(self.sheets, self.drive, is_xlsx=self.is_xlsx, mock_mode=self.mock_mode)

    # --------------------------------------------------------------------------
    # Google Drive Operations (Delegated to GoogleDriveClient)
    # --------------------------------------------------------------------------

    def _reconcile_drive_tracks(self, entries: List[PerformanceEntry], force: bool = False) -> List[PerformanceEntry]:
        return self._drive_client.reconcile_drive_tracks(entries, force=force)

    def archive_all_active_files_for_entry(self, entry_id: str) -> List[str]:
        return self._drive_client.archive_all_active_files_for_entry(entry_id)

    def upload_file_to_active(self, file_path: str, filename: str, entry_id: Optional[str] = None, mime_type: str = "audio/mpeg") -> str:
        return self._drive_client.upload_file_to_active(file_path, filename, entry_id=entry_id, mime_type=mime_type)

    def archive_previous_file(self, file_id: str, original_filename: str) -> bool:
        return self._drive_client.archive_previous_file(file_id, original_filename)

    def download_file_bytes(self, file_id: str) -> Optional[bytes]:
        return self._drive_client.download_file_bytes(file_id)

    def get_drive_file_metadata(self, file_id: str) -> Optional[dict]:
        return self._drive_client.get_file_metadata(file_id)

    def create_or_update_backup_sheet(
        self,
        folder_id: str,
        title: str,
        performances: List[Dict[str, Any]],
        food_items: List[Dict[str, Any]],
        target_sheet_id: Optional[str] = None
    ) -> Dict[str, Any]:
        return create_or_update_backup_sheet(
            sheets_service=self.sheets,
            drive_service=self.drive,
            folder_id=folder_id,
            title=title,
            performances=performances,
            food_items=food_items,
            target_sheet_id=target_sheet_id,
            mock_mode=self.mock_mode
        )

    # --------------------------------------------------------------------------
    # Google Sheets Reading & Ingestion
    # --------------------------------------------------------------------------

    def get_sheet_row_mapping(self) -> Dict[str, int]:
        """Returns a mapping from entry_id to 1-based row index in the target Google/Excel Sheet."""
        return self._sheet_client.get_sheet_row_mapping()

    def get_performances(self, force_sync: bool = False) -> List[PerformanceEntry]:
        if self.mock_mode:
            try:
                db_entries = db_service.get_all_performances()
                if db_entries:
                    db_map = {row["entry_id"]: PerformanceEntry(**row) for row in db_entries}
                    db_ids = set(db_map.keys())
                    merged = list(db_map.values())
                    for m in self._mock_data:
                        if m.entry_id not in db_ids:
                            merged.append(m)
                    return merged
            except Exception:
                pass
            return self._mock_data

        try:
            cached = db_service.get_all_performances()
            if cached:
                entries = [PerformanceEntry(**row) for row in cached]
                if self.drive:
                    entries = self._reconcile_drive_tracks(entries, force=force_sync)
                return entries
        except Exception as ex:
            logger.warning("Error reading from SQLite database: %s", ex)

        return self._fetch_and_cache_from_google()

    def _fetch_and_cache_from_google(self) -> List[PerformanceEntry]:
        cols = settings.columns
        names = settings.column_names

        try:
            raw_header, raw_rows = self._sheet_client.fetch_raw_sheet_data()

            # Dynamically resolve column indices by matching column header names
            if raw_header:
                def find_col_idx(expected_name: str, fallback: int) -> int:
                    exp_clean = re.sub(r'[^a-zA-Z0-9]', '', expected_name.lower())
                    for idx, h in enumerate(raw_header):
                        h_clean = re.sub(r'[^a-zA-Z0-9]', '', str(h).lower())
                        if exp_clean and (exp_clean in h_clean or h_clean in exp_clean):
                            return idx
                    return fallback

                cols.entry_id = find_col_idx(getattr(names, "entry_id", "Entry ID"), getattr(cols, "entry_id", -1))
                cols.performer_name = find_col_idx(names.performer_name, cols.performer_name)
                cols.age_group = find_col_idx(names.age_group, getattr(cols, "age_group", -1))
                cols.partner_name = find_col_idx(names.partner_name, cols.partner_name)
                cols.performance_type = find_col_idx(names.performance_type, cols.performance_type)
                cols.contact_info = find_col_idx(names.contact_info, getattr(cols, "contact_info", -1))
                cols.sequence_order = find_col_idx(names.sequence_order, cols.sequence_order)
                cols.song_title = find_col_idx(names.song_title, cols.song_title)
                cols.movie_name = find_col_idx(names.movie_name, cols.movie_name)
                cols.performance_status = find_col_idx(names.performance_status, cols.performance_status)
                cols.track_status = find_col_idx(names.track_status, cols.track_status)
                cols.duration = find_col_idx(names.duration, cols.duration)
                cols.drive_file_id = find_col_idx(names.drive_file_id, cols.drive_file_id)
                cols.last_updated = find_col_idx(names.last_updated, cols.last_updated)

            # Extra generic console columns (e.g. Age Group, Category)
            extra_col_indices: List[int] = []
            if raw_header and getattr(settings, "console_extra_columns", None):
                target_names = [n.strip().lower() for n in settings.console_extra_columns if n.strip()]
                for h_idx, h_name in enumerate(raw_header):
                    clean_h = str(h_name).strip().lower()
                    if any(t in clean_h for t in target_names):
                        extra_col_indices.append(h_idx)

            # Query Google Drive Active/ folder as the ground truth for backing tracks
            active_files = []
            if not self.mock_mode and self.drive:
                try:
                    q = f"'{settings.google.drive_folders.active_folder_id}' in parents and trashed = false"
                    res = self.drive.files().list(
                        q=q,
                        supportsAllDrives=True,
                        includeItemsFromAllDrives=True,
                        fields="files(id, name, size)"
                    ).execute()
                    active_files = res.get("files", [])
                except Exception as ex:
                    logger.warning("Could not list files in Active/ folder: %s", ex)

            prefix = getattr(settings, "entry_id_prefix", "PK").strip().upper()
            active_file_ids = {f["id"] for f in active_files}
            active_by_entry = {}
            for f in active_files:
                fname = f.get("name", "")
                for part in fname.split("_"):
                    if part.startswith(f"{prefix}-") or part.startswith("PK-"):
                        active_by_entry[part] = f
                        break

            stale_sheet_clears = []
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
                    entry_id = f"{prefix}-{row_index:03d}"

                seq_str = get_col(cols.sequence_order)
                seq_val = None
                if seq_str:
                    try:
                        seq_val = int(float(seq_str))
                    except ValueError:
                        seq_val = None

                raw_song_title = get_col(cols.song_title)
                movie_name = get_col(cols.movie_name)
                is_missing = is_placeholder_song_title(raw_song_title)

                if raw_song_title:
                    song_title = raw_song_title
                elif movie_name:
                    song_title = f"{movie_name} (Song title missing)"
                else:
                    song_title = "Performance (Song title missing)"

                perf_type = get_col(cols.performance_type) or "Solo"

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

                raw_track_status = get_col(cols.track_status)
                if raw_track_status.lower() in ("yes", "uploaded", "true"):
                    track_status = "Uploaded"
                elif "acoustic" in perf_type.lower() or "live" in song_title.lower() or raw_track_status.lower() == "acoustic":
                    track_status = "Acoustic"
                elif raw_track_status.lower() in ("performed", "done"):
                    track_status = "Uploaded"
                elif raw_track_status:
                    track_status = raw_track_status
                else:
                    track_status = "Pending"

                duration_val = get_col(cols.duration) or None
                drive_id = get_col(cols.drive_file_id) or None
                last_up = get_col(cols.last_updated) or None

                if not self.mock_mode and self.drive:
                    matched_file = None
                    if drive_id and drive_id in active_file_ids:
                        matched_file = next((f for f in active_files if f["id"] == drive_id), None)
                    elif entry_id in active_by_entry:
                        matched_file = active_by_entry[entry_id]
                        drive_id = matched_file["id"]

                    if matched_file:
                        drive_file_name = matched_file.get("name")
                        if track_status != "Acoustic":
                            track_status = "Uploaded"
                    else:
                        drive_file_name = None
                        if drive_id or track_status == "Uploaded":
                            stale_sheet_clears.append(row_index)
                        drive_id = None
                        if track_status == "Uploaded":
                            track_status = "Pending"
                            duration_val = None

                extra_tags = []
                for c_idx in extra_col_indices:
                    val = get_col(c_idx)
                    if val and val not in extra_tags:
                        extra_tags.append(val)

                age_group_val = get_col(cols.age_group) if hasattr(cols, "age_group") and cols.age_group >= 0 else None
                contact_val = get_col(cols.contact_info) if hasattr(cols, "contact_info") and cols.contact_info >= 0 else None

                media_type_val = "video" if (drive_file_name and drive_file_name.lower().endswith(".mp4")) else "audio"

                entries.append(PerformanceEntry(
                    entry_id=entry_id,
                    performer_name=performer_name,
                    performance_type=perf_type,
                    partner_name=get_col(cols.partner_name) or None,
                    contact_info=contact_val,
                    age_group=age_group_val,
                    song_title=song_title,
                    movie_name=movie_name or None,
                    sequence_order=seq_val,
                    performance_status=perf_status,
                    track_status=track_status,
                    duration=duration_val,
                    drive_file_id=drive_id,
                    drive_file_name=drive_file_name,
                    last_updated=last_up,
                    row_index=row_index,
                    is_song_name_missing=is_missing or is_placeholder_song_title(song_title),
                    extra_tags=extra_tags,
                    media_type=media_type_val
                ))

            # Invalidate local audio caches for performances with no active Drive file
            try:
                from app.services.audio_service import audio_service
                for p in entries:
                    if not p.drive_file_id:
                        audio_service.purge_cache(p.entry_id)
            except Exception as ex:
                logger.warning("Error purging audio caches: %s", ex)

            # Sync back cleared status to Google Sheet if files were deleted from Drive
            if stale_sheet_clears and not self.mock_mode:
                self._sheet_client.clear_stale_file_rows(stale_sheet_clears)

            # Sequence backfill logic
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

            for p in entries:
                if p.is_song_name_missing and "Performance (Song" in p.song_title:
                    p.song_title = f"Performance #{p.sequence_order} (Song title missing)"

            try:
                db_service.save_performances(entries)
            except Exception as ex:
                logger.warning("Could not save performances to SQLite: %s", ex)

            return entries
        except Exception as e:
            logger.error("Error fetching performances from Google Sheet: %s", e)
            raise

    # --------------------------------------------------------------------------
    # Queue, Stage & Live State
    # --------------------------------------------------------------------------

    def get_stage_queue(self) -> List[PerformanceEntry]:
        performances = self.get_performances()
        performances.sort(key=lambda x: x.sequence_order if x.sequence_order is not None else 9999)
        return performances

    def set_active_performance(self, entry_id: str) -> bool:
        self.active_entry_id = entry_id
        self.update_status(entry_id, "On Stage")
        return True

    def clear_active_performance(self) -> bool:
        prev_id = self.active_entry_id
        self.active_entry_id = None
        if prev_id:
            try:
                self.update_status(prev_id, "Upcoming")
            except Exception as ex:
                logger.warning("Failed to revert performance status for %s: %s", prev_id, ex)
        return True

    def update_stage_notes(self, entry_id: str, notes: str) -> bool:
        clean_notes = (notes or "").strip()
        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.stage_notes = clean_notes
                    return True

        db_service.update_performance_field(entry_id, "stage_notes", clean_notes)
        logger.info("Updated stage notes for %s in SQLite: %s", entry_id, clean_notes)
        return True

    # --------------------------------------------------------------------------
    # Sheet & Performance Updates
    # --------------------------------------------------------------------------

    def update_track_metadata(self, entry_id: str, file_id: str, status: str = "Uploaded", duration_str: Optional[str] = None, media_type: Optional[str] = None) -> bool:
        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            db_service.update_performance_field(entry_id, "track_status", status)
            if file_id:
                db_service.update_performance_field(entry_id, "drive_file_id", file_id)
            if duration_str:
                db_service.update_performance_field(entry_id, "duration", duration_str)
            if media_type:
                db_service.update_performance_field(entry_id, "media_type", media_type)
            db_service.update_performance_field(entry_id, "last_updated", now_iso)
        except Exception as ex:
            logger.warning("Error updating track metadata in SQLite: %s", ex)

        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.drive_file_id = file_id
                    item.track_status = status
                    item.duration = duration_str or item.duration
                    if media_type:
                        item.media_type = media_type
                    item.last_updated = now_iso
                    return True
            return True

        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)

        row_map = self.get_sheet_row_mapping()
        sheet_row = row_map.get(entry_id) or (target.row_index if target and target.row_index and target.row_index > 0 else None)
        if not sheet_row:
            return True

        self._sheet_client.update_track_metadata(sheet_row, file_id, duration_str, now_iso)
        logger.info("Updated track metadata for %s (Row %d) with file_id: %s", entry_id, sheet_row, file_id)
        return True

    def update_status(self, entry_id: str, status: str) -> bool:
        """Updates Performance Status (Col K) and optionally Track Status (Col L)."""
        val_to_write = status
        if status in ("Uploaded", "Upcoming", "Reset"):
            val_to_write = "Upcoming"
        elif status in ("Performed", "Done"):
            val_to_write = "Performed"
        elif status in ("Skipped", "On Hold"):
            val_to_write = "On Hold"
        elif status in ("On Stage", "Live"):
            val_to_write = "On Stage"

        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.performance_status = val_to_write
                    return True
            return False

        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)
        if not target:
            raise ValueError(f"Performance entry {entry_id} not found in Google Sheet")

        row_map = self.get_sheet_row_mapping()
        sheet_row = row_map.get(entry_id) or (target.row_index if target.row_index and target.row_index > 0 else None)
        if not sheet_row:
            return True

        try:
            db_service.update_performance_field(entry_id, "performance_status", val_to_write)
        except Exception as ex:
            logger.warning("Error updating status in SQLite: %s", ex)

        self._sheet_client.update_performance_status(sheet_row, val_to_write)
        logger.info("Updated performance status for %s (Row %d) to %s", entry_id, sheet_row, val_to_write)
        return True

    def update_sequence_orders(self, items: List[Dict[str, Any]], push_to_sheet: bool = True) -> int:
        """Updates sequence numbers in local SQLite database, and optionally pushes to Google Sheet & Drive."""
        item_map = {it["entry_id"]: int(it["sequence_order"]) for it in items if "entry_id" in it and "sequence_order" in it}

        try:
            for eid, seq in item_map.items():
                db_service.update_performance_field(eid, "sequence_order", seq)
        except Exception as ex:
            logger.warning("Error updating sequence orders in SQLite: %s", ex)

        if self.mock_mode:
            for p in self._mock_data:
                if p.entry_id in item_map:
                    p.sequence_order = item_map[p.entry_id]
            if not push_to_sheet:
                db_service.set_dirty_sequence(True)
            else:
                db_service.set_dirty_sequence(False)
            return len(item_map)

        if not push_to_sheet:
            db_service.set_dirty_sequence(True)
            logger.info("Updated sequence order for %d items in local database (sync pending)", len(item_map))
            return len(item_map)

        return self.sync_sequence_to_google(item_map=item_map)

    def sync_sequence_to_google(self, item_map: Optional[Dict[str, int]] = None) -> int:
        """Pushes current SQLite sequence order to Google Sheet and renames Drive files."""
        if self.mock_mode:
            db_service.set_dirty_sequence(False)
            db_service.set_last_sync_time()
            return len(self._mock_data)

        performances = self.get_performances()
        if not item_map:
            item_map = {p.entry_id: p.sequence_order for p in performances if p.sequence_order is not None}

        cols = settings.columns
        tab_name = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Song Sign-Up"
        row_map = self.get_sheet_row_mapping()

        if self.is_xlsx:
            row_seq_map = {}
            for p in performances:
                if p.entry_id in item_map:
                    sheet_row = row_map.get(p.entry_id) or p.row_index
                    if sheet_row and sheet_row > 0:
                        row_seq_map[sheet_row] = item_map[p.entry_id]

            self._sheet_client.update_xlsx_sequence_orders(row_seq_map)
            logger.info("Updated sequence order for %d items in Excel sheet", len(item_map))
            db_service.set_dirty_sequence(False)
            db_service.set_last_sync_time()
            return len(item_map)
        else:
            def col_letter(col_idx: int) -> str:
                return chr(ord('A') + col_idx)

            updates = []
            for p in performances:
                if p.entry_id in item_map:
                    new_seq = item_map[p.entry_id]
                    sheet_row = row_map.get(p.entry_id) or p.row_index
                    if sheet_row and sheet_row > 0:
                        cell = f"{tab_name}!{col_letter(cols.sequence_order)}{sheet_row}"
                        updates.append({"range": cell, "values": [[new_seq]]})

                    if p.drive_file_id and self.drive:
                        try:
                            clean_p = "".join(c for c in p.performer_name.split("(")[0].strip() if c.isalnum() or c in (" ", "_", "-")).replace(" ", "_")
                            clean_s = "".join(c for c in p.song_title if c.isalnum() or c in (" ", "_", "-")).replace(" ", "_")
                            new_name = f"{new_seq:02d}_{p.entry_id}_{clean_p}_{clean_s}.mp3"
                            self.drive.files().update(
                                fileId=p.drive_file_id,
                                body={"name": new_name},
                                supportsAllDrives=True
                            ).execute()
                            logger.info("Renamed Drive file %s -> %s for sequence #%d", p.drive_file_id, new_name, new_seq)
                        except Exception as ex:
                            logger.warning("Could not rename Drive file %s for sequence update: %s", p.drive_file_id, ex)

            if updates:
                self._sheet_client.batch_update_sequence_orders(updates)

            db_service.set_dirty_sequence(False)
            db_service.set_last_sync_time()
            logger.info("Synced sequence order for %d items to Google Sheet & Drive", len(item_map))
            return len(item_map)


google_service = GoogleService()
