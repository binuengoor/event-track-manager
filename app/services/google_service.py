import os
import io
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger("google-service")

class PerformanceEntry(BaseModel):
    entry_id: str
    performer_name: str
    performance_type: str = "Solo"
    partner_name: Optional[str] = None
    contact_info: Optional[str] = None
    age_group: Optional[str] = None
    song_title: str
    movie_name: Optional[str] = None
    sequence_order: Optional[int] = None
    performance_status: str = "Upcoming" # Col K: Upcoming, On Stage, Performed, On Hold
    track_status: str = "Pending"        # Col L: Uploaded, Pending, Acoustic
    duration: Optional[str] = None      # Col M: Duration (Minutes)
    drive_file_id: Optional[str] = None # Col N: Drive File ID
    drive_file_name: Optional[str] = None # Actual file name in Google Drive
    last_updated: Optional[str] = None  # Col O: Last Updated
    row_index: int = 0
    is_song_name_missing: bool = False
    extra_tags: List[str] = []
    stage_notes: Optional[str] = ""
    age_group: Optional[str] = ""
    guardian_name: Optional[str] = ""
    guardian_phone: Optional[str] = ""
    created_via: Optional[str] = "sheet"

class GoogleService:
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

    @property
    def active_entry_id(self) -> Optional[str]:
        from app.services.db_service import db_service
        return db_service.get_active_entry_id()

    @active_entry_id.setter
    def active_entry_id(self, val: Optional[str]):
        from app.services.db_service import db_service
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
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            scopes = [
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"
            ]

            if settings.google.service_account_json:
                import json
                info = json.loads(settings.google.service_account_json)
                creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
            else:
                creds_path = settings.google.service_account_json_path
                if not os.path.isfile(creds_path):
                    raise FileNotFoundError(f"Service account file not found at {creds_path}")
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

    def get_performances(self, force_sync: bool = False) -> List[PerformanceEntry]:
        if self.mock_mode:
            try:
                from app.services.db_service import db_service
                db_entries = db_service.get_all_performances()
                if db_entries:
                    mock_ids = {p.entry_id for p in self._mock_data}
                    extras = [PerformanceEntry(**row) for row in db_entries if row["entry_id"] not in mock_ids]
                    if extras:
                        return self._mock_data + extras
            except Exception:
                pass
            return self._mock_data

        if not force_sync:
            try:
                from app.services.db_service import db_service
                cached = db_service.get_all_performances()
                if cached:
                    return [PerformanceEntry(**row) for row in cached]
            except Exception as ex:
                logger.warning("Error reading from SQLite cache: %s", ex)

        return self._fetch_and_cache_from_google()

    def _fetch_and_cache_from_google(self) -> List[PerformanceEntry]:
        cols = settings.columns
        names = settings.column_names
        tab_name = settings.google.sheet_tab_name or "Song Sign-Up"

        try:
            raw_header = []
            raw_rows = []
            if self.is_xlsx:
                import openpyxl
                content = self.drive.files().get_media(fileId=settings.google.sheet_id, supportsAllDrives=True).execute()
                wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
                ws = wb[tab_name] if tab_name in wb.sheetnames else wb.active
                all_rows = []
                for r in ws.iter_rows(values_only=True):
                    all_rows.append([str(c).strip() if c is not None else "" for c in r])
                if all_rows:
                    raw_header = all_rows[0]
                    raw_rows = all_rows[1:]
            else:
                result = self.sheets.spreadsheets().values().get(
                    spreadsheetId=settings.google.sheet_id,
                    range=f"{tab_name}!A1:Z"
                ).execute()
                all_rows = result.get("values", [])
                if all_rows:
                    raw_header = all_rows[0]
                    raw_rows = all_rows[1:]

            # Dynamically resolve column indices by matching column header names
            if raw_header:
                import re
                def find_col_idx(expected_name: str, fallback: int) -> int:
                    exp_clean = re.sub(r'[^a-zA-Z0-9]', '', expected_name.lower())
                    for idx, h in enumerate(raw_header):
                        h_clean = re.sub(r'[^a-zA-Z0-9]', '', str(h).lower())
                        if exp_clean and (exp_clean in h_clean or h_clean in exp_clean):
                            return idx
                    return fallback

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

            # Find column indices for extra generic console columns (e.g. Age Group, Category)
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
                    track_status = "Uploaded"
                elif raw_track_status:
                    track_status = raw_track_status
                else:
                    track_status = "Pending"

                duration_val = get_col(cols.duration) or None
                drive_id = get_col(cols.drive_file_id) or None
                last_up = get_col(cols.last_updated) or None

                # Reconcile with Google Drive Active/ folder ground truth
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
                        # If a file was recorded in the sheet but is missing from Drive Active/ folder
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
                    is_song_name_missing=is_missing,
                    extra_tags=extra_tags
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
            if stale_sheet_clears and not self.mock_mode and self.sheets:
                try:
                    tab_name = settings.google.sheet_range.split("!")[0] if "!" in settings.google.sheet_range else "Song Sign-Up"
                    def col_letter(col_idx: int) -> str:
                        return chr(ord('A') + col_idx)
                    sheet_updates = []
                    for r_idx in stale_sheet_clears:
                        sheet_updates.append({"range": f"{tab_name}!{col_letter(cols.track_status)}{r_idx}", "values": [["Pending"]]})
                        sheet_updates.append({"range": f"{tab_name}!{col_letter(cols.duration)}{r_idx}", "values": [[""]]})
                        sheet_updates.append({"range": f"{tab_name}!{col_letter(cols.drive_file_id)}{r_idx}", "values": [[""]]})
                    self.sheets.spreadsheets().values().batchUpdate(
                        spreadsheetId=settings.google.sheet_id,
                        body={"valueInputOption": "USER_ENTERED", "data": sheet_updates}
                    ).execute()
                except Exception as ex:
                    logger.warning("Could not clear stale file rows in Google Sheet: %s", ex)

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

            # Save to SQLite database cache
            try:
                from app.services.db_service import db_service
                db_service.save_performances(entries)
            except Exception as ex:
                logger.warning("Could not save performances to SQLite: %s", ex)

            # Sync Food Sign-Up tab if available in spreadsheet
            if not self.mock_mode and self.sheets:
                try:
                    from app.services.db_service import db_service
                    food_res = self.sheets.spreadsheets().values().get(
                        spreadsheetId=settings.google.sheet_id,
                        range="'Food Sign-Up'!A1:C60"
                    ).execute()
                    food_rows = food_res.get("values", [])
                    if food_rows:
                        serving_note = None
                        if len(food_rows) > 0 and len(food_rows[0]) > 0:
                            top_cell = str(food_rows[0][0])
                            if "serving portion" in top_cell.lower():
                                serving_note = top_cell.strip()
                        db_service.sync_food_from_sheet(food_rows, serving_portion_note=serving_note)
                except Exception as ex:
                    logger.warning("Could not sync Food Sign-Up sheet: %s", ex)

            return entries
        except Exception as e:
            logger.error("Error fetching performances from Google Sheet: %s", e)
            raise

    def get_stage_queue(self) -> List[PerformanceEntry]:
        performances = self.get_performances()
        # Sort all entries by sequence_order
        performances.sort(key=lambda x: x.sequence_order if x.sequence_order is not None else 9999)
        return performances

    def get_gallery_images(self) -> List[str]:
        """Scans the configured gallery directory and returns web-accessible URLs."""
        gallery_dir = settings.storage.gallery_dir
        if not gallery_dir or not os.path.isdir(gallery_dir):
            return []

        valid_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
        images = []
        try:
            for fname in sorted(os.listdir(gallery_dir)):
                if fname.startswith("."):
                    continue
                ext = os.path.splitext(fname)[1].lower()
                if ext in valid_exts:
                    import urllib.parse
                    safe_name = urllib.parse.quote(fname)
                    images.append(f"/data/gallery/{safe_name}")
        except Exception as ex:
            logger.warning("Error scanning gallery directory %s: %s", gallery_dir, ex)
        return images

    def get_live_status(self) -> Dict[str, Any]:
        from app.services.db_service import db_service
        last_sync = db_service.get_last_sync_time()

        # Background sync for live view if cache is stale (> 30 seconds)
        if not self.mock_mode:
            should_sync = False
            if not last_sync:
                should_sync = True
            else:
                try:
                    dt = datetime.fromisoformat(last_sync)
                    diff = (datetime.now(timezone.utc) - dt).total_seconds()
                    if diff > 30:
                        should_sync = True
                except Exception:
                    pass

            if should_sync:
                try:
                    self.get_performances(force_sync=True)
                    last_sync = db_service.get_last_sync_time()
                except Exception as ex:
                    logger.warning("Background live sync failed: %s", ex)

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

        def is_eligible_for_stage(p: PerformanceEntry) -> bool:
            ptype = (p.performance_type or "").strip().lower()
            # Any performance explicitly designated as without backing track
            if "no-track" in ptype or "notrack" in ptype or "no track" in ptype:
                return True
            if "acoustic" in ptype or "live" in ptype:
                return True
            if "group" in ptype and "karaoke" not in ptype:
                return True
            # Backing track uploaded or present in active Drive
            if p.track_status == "Uploaded" or bool(p.drive_file_id):
                return True
            return False

        for p in queue:
            if p.entry_id == now_id:
                continue
            if p.performance_status in ("Performed", "Done"):
                performed.append(p)
            elif p.performance_status in ("On Hold", "Skipped"):
                on_hold.append(p)
            else:
                if is_eligible_for_stage(p) and len(up_next) < 2:
                    up_next.append(p)
                else:
                    upcoming.append(p)

        # Multi-tier sorting for upcoming performances based on LIVE_ORDER_BY
        def get_sort_key(p: PerformanceEntry):
            strategy_fields = [f.strip().lower() for f in settings.live_order_by.split(",") if f.strip()]
            key = []
            for f in strategy_fields:
                if f in ("readiness", "ready", "download_status", "no_track_status"):
                    key.append(0 if is_eligible_for_stage(p) else 1)
                elif f in ("age_group", "age"):
                    ag = (p.age_group or "").lower()
                    if not ag:
                        for t in (p.extra_tags or []):
                            if "junior" in t.lower():
                                ag = "junior"
                                break
                            elif "senior" in t.lower():
                                ag = "senior"
                                break
                    if "junior" in ag:
                        key.append(0)
                    elif "senior" in ag:
                        key.append(1)
                    else:
                        key.append(2)
                elif f in ("sequence", "sequence_order", "seq"):
                    seq = p.sequence_order if p.sequence_order is not None and p.sequence_order > 0 else 9999
                    key.append(seq)
                elif f in ("performance_type", "type"):
                    pt = (p.performance_type or "").lower()
                    if "solo" in pt:
                        key.append(0)
                    elif "duet" in pt:
                        key.append(1)
                    elif "group" in pt:
                        key.append(2)
                    else:
                        key.append(3)
            seq = p.sequence_order if p.sequence_order is not None and p.sequence_order > 0 else 9999
            key.append(seq)
            key.append(p.row_index)
            return tuple(key)

        upcoming.sort(key=get_sort_key)

        return {
            "event_name": settings.event.name,
            "event_subtitle": settings.event.subtitle,
            "event_start_time": settings.event.start_time,
            "event_start_time_iso": settings.event.start_time_iso,
            "now_performing": now_performing,
            "up_next": up_next,
            "upcoming": upcoming,
            "performed": performed,
            "on_hold": on_hold,
            "total_count": len(queue),
            "completed_count": len(performed),
            "last_synced_at": last_sync,
            "is_dirty": db_service.is_sequence_dirty(),
            "active_entry_id": self.active_entry_id,
            "gallery_images": self.get_gallery_images()
        }


    def set_active_performance(self, entry_id: str) -> bool:
        self.active_entry_id = entry_id
        # Update performance_status in sheet & db
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
        """Updates stage notes for a performance in local SQLite cache."""
        clean_notes = (notes or "").strip()
        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.stage_notes = clean_notes
                    return True

        from app.services.db_service import db_service
        db_service.update_performance_field(entry_id, "stage_notes", clean_notes)
        logger.info("Updated stage notes for %s in SQLite: %s", entry_id, clean_notes)
        return True

    def update_track_metadata(self, entry_id: str, file_id: str, status: str = "Uploaded", duration_str: Optional[str] = None) -> bool:
        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Update SQLite database immediately
        try:
            from app.services.db_service import db_service
            db_service.update_performance_field(entry_id, "track_status", status)
            if file_id:
                db_service.update_performance_field(entry_id, "drive_file_id", file_id)
            if duration_str:
                db_service.update_performance_field(entry_id, "duration", duration_str)
            db_service.update_performance_field(entry_id, "last_updated", now_iso)
        except Exception as ex:
            logger.warning("Error updating track metadata in SQLite: %s", ex)

        if self.mock_mode:
            for item in self._mock_data:
                if item.entry_id == entry_id:
                    item.drive_file_id = file_id
                    item.track_status = status
                    item.duration = duration_str or item.duration
                    item.last_updated = now_iso
                    return True
            return True

        performances = self.get_performances()
        target = next((p for p in performances if p.entry_id == entry_id), None)
        if not target or not target.row_index or target.row_index <= 0:
            # If it's a web signup not yet in sheet or not assigned a row, it is updated in SQLite
            return True

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

        # Update SQLite database immediately
        try:
            from app.services.db_service import db_service
            db_service.update_performance_field(entry_id, "performance_status", val_to_write)
        except Exception as ex:
            logger.warning("Error updating status in SQLite: %s", ex)

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

    def update_sequence_orders(self, items: List[Dict[str, Any]], push_to_sheet: bool = True) -> int:
        """Updates sequence numbers in local SQLite database, and optionally pushes to Google Sheet & Drive."""
        from app.services.db_service import db_service
        item_map = {it["entry_id"]: int(it["sequence_order"]) for it in items if "entry_id" in it and "sequence_order" in it}
        
        # 1. Always update SQLite database immediately
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
            # Mark SQLite sequence order as ahead/dirty compared to Google Sheet
            db_service.set_dirty_sequence(True)
            logger.info("Updated sequence order for %d items in local database (sync pending)", len(item_map))
            return len(item_map)

        # Full sync to Google Sheet & Drive
        return self.sync_sequence_to_google(item_map=item_map)

    def sync_sequence_to_google(self, item_map: Optional[Dict[str, int]] = None) -> int:
        """Pushes current SQLite sequence order to Google Sheet and renames Drive files."""
        from app.services.db_service import db_service
        if self.mock_mode:
            db_service.set_dirty_sequence(False)
            db_service.set_last_sync_time()
            return len(self._mock_data)

        performances = self.get_performances()
        if not item_map:
            # Read from SQLite to get current sequence orders
            item_map = {p.entry_id: p.sequence_order for p in performances if p.sequence_order is not None}

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
                    if p.row_index and p.row_index > 0:
                        cell = f"{tab_name}!{col_letter(cols.sequence_order)}{p.row_index}"
                        updates.append({"range": cell, "values": [[new_seq]]})

                    # If this performance has a backing track in Drive, rename it with the new sequence prefix
                    if p.drive_file_id:
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
                self.sheets.spreadsheets().values().batchUpdate(
                    spreadsheetId=settings.google.sheet_id,
                    body={"valueInputOption": "USER_ENTERED", "data": updates}
                ).execute()

            db_service.set_dirty_sequence(False)
            db_service.set_last_sync_time()
            logger.info("Synced sequence order for %d items to Google Sheet & Drive", len(item_map))
            return len(item_map)

    def archive_all_active_files_for_entry(self, entry_id: str) -> List[str]:
        """Finds any active file in the Active/ folder matching this entry and moves it to Archive/."""
        if self.mock_mode:
            return []

        active_id = settings.google.drive_folders.active_folder_id
        archive_id = settings.google.drive_folders.archive_folder_id

        try:
            q = f"'{active_id}' in parents and trashed = false and name contains '{entry_id}'"
            res = self.drive.files().list(
                q=q,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                fields="files(id, name)"
            ).execute()

            archived = []
            timestamp_str = datetime.now().strftime("%Y%m%d-%H%M%S")
            for f in res.get("files", []):
                fid = f["id"]
                old_name = f["name"]
                base, ext = os.path.splitext(old_name)
                new_name = f"{base}_archived_{timestamp_str}{ext}" if "_archived_" not in old_name else old_name
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
        if self.mock_mode:
            mock_id = f"mock_drive_{os.path.basename(file_path)}"
            logger.info("MOCK DRIVE: Uploaded %s to Active folder (mock ID: %s)", filename, mock_id)
            return mock_id

        # Guarantee at any given point in time, there is ONLY ONE file in Active/ for this performance
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
        if self.mock_mode:
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

    def create_or_update_backup_sheet(
        self,
        folder_id: str,
        title: str,
        performances: List[Dict[str, Any]],
        food_items: List[Dict[str, Any]],
        target_sheet_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Creates or updates a Google Sheet containing performances and food signups from the App DB."""
        total_rows = len(performances) + len(food_items)
        if self.mock_mode:
            logger.info("Mock backup: %d performances and %d food items backed up", len(performances), len(food_items))
            return {
                "file_id": "mock_backup_sheet_id",
                "title": title,
                "rows_backed": total_rows,
                "url": f"https://docs.google.com/spreadsheets/d/mock_backup_sheet_id/edit"
            }

        try:
            spreadsheet_id = target_sheet_id
            if not spreadsheet_id:
                # 1. Find existing backup file in target Drive folder or create a new one
                q = f"name = '{title}' and '{folder_id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false"
                res = self.drive.files().list(
                    q=q,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    fields="files(id, name)"
                ).execute()
                files = res.get("files", [])

                if files:
                    spreadsheet_id = files[0]["id"]
                    logger.info("Found existing backup spreadsheet %s (%s)", title, spreadsheet_id)
                else:
                    body = {
                        "name": title,
                        "mimeType": "application/vnd.google-apps.spreadsheet",
                        "parents": [folder_id]
                    }
                    created = self.drive.files().create(
                        body=body,
                        supportsAllDrives=True,
                        fields="id, name"
                    ).execute()
                    spreadsheet_id = created["id"]
                    logger.info("Created new backup spreadsheet %s (%s)", title, spreadsheet_id)

            # 2. Ensure tabs exist
            meta = self.sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
            existing_sheets = [s["properties"]["title"] for s in meta.get("sheets", [])]

            # Determine performances tab name: use configured tab name (e.g. Song Sign-Up) or Performances
            perf_tab = settings.google.sheet_tab_name or "Song Sign-Up"
            if perf_tab not in existing_sheets and "Performances" in existing_sheets:
                perf_tab = "Performances"

            requests = []
            if perf_tab not in existing_sheets:
                requests.append({"addSheet": {"properties": {"title": perf_tab}}})
            if "Food Sign-Ups" not in existing_sheets and "Food Sign-Up" not in existing_sheets:
                requests.append({"addSheet": {"properties": {"title": "Food Sign-Up"}}})

            food_tab = "Food Sign-Up" if "Food Sign-Up" in existing_sheets else ("Food Sign-Ups" if "Food Sign-Ups" in existing_sheets else "Food Sign-Up")

            if requests:
                self.sheets.spreadsheets().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={"requests": requests}
                ).execute()

            # 3. Format performance data
            perf_headers = [
                "Entry ID", "Performer Name", "Age Group", "Performance Type",
                "Duet Partner", "Song Name", "Movie/Album", "Sequence",
                "Guardian Name", "Guardian Phone", "Contact Info", "Track Status",
                "Duration", "Drive File ID", "Created Via", "Last Updated"
            ]
            perf_rows = [perf_headers]
            for p in performances:
                perf_rows.append([
                    p.get("entry_id", ""),
                    p.get("performer_name", ""),
                    p.get("age_group", ""),
                    p.get("performance_type", "Solo"),
                    p.get("partner_name", "") or "",
                    p.get("song_title", "") or "",
                    p.get("movie_name", "") or "",
                    str(p.get("sequence_order", "") or ""),
                    p.get("guardian_name", "") or "",
                    p.get("guardian_phone", "") or "",
                    p.get("contact_info", "") or "",
                    p.get("track_status", "Pending") or "",
                    p.get("duration", "") or "",
                    p.get("drive_file_id", "") or "",
                    p.get("created_via", "sheet") or "",
                    p.get("last_updated", "") or ""
                ])

            # 4. Format food data
            food_headers = [
                "Item ID", "Food Group", "Item Name", "Status",
                "Signer Name", "Dish Description", "Claimed At"
            ]
            food_rows = [food_headers]
            for f in food_items:
                food_rows.append([
                    f.get("item_id", ""),
                    f.get("group_name", ""),
                    f.get("name", ""),
                    "Taken" if f.get("is_taken") else "Open",
                    f.get("signer_name", "") or "",
                    f.get("dish_description", "") or "",
                    f.get("claimed_at", "") or ""
                ])

            # 5. Clear and write data
            data_payload = [
                {"range": f"'{perf_tab}'!A1:P", "values": perf_rows},
                {"range": f"'{food_tab}'!A1:G", "values": food_rows}
            ]

            # Clear older rows first to avoid trailing data
            try:
                self.sheets.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=f"'{perf_tab}'!A1:P1000").execute()
                self.sheets.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=f"'{food_tab}'!A1:G1000").execute()
            except Exception:
                pass

            self.sheets.spreadsheets().values().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": data_payload}
            ).execute()

            logger.info("Successfully backed up %d rows to Sheet %s", total_rows, spreadsheet_id)
            return {
                "file_id": spreadsheet_id,
                "title": title,
                "rows_backed": total_rows,
                "url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
            }
        except Exception as e:
            logger.error("Failed to backup to Google Sheet: %s", e)
            raise

google_service = GoogleService()

