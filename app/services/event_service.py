"""Performance/queue/track operations for the running event, backed by SQLite and the event folder.

Replaces the former Google Sheets/Drive facade. The database is the source of truth; backing tracks are
plain files in ``<event>/tracks`` matched to performances by entry id.
"""
import os
import time
import logging
import threading
from datetime import datetime
from typing import List, Optional, Dict, Any

from app.schemas import PerformanceEntry
from app.services.db_service import db_service
from app.services.track_store import track_store, media_type_for

logger = logging.getLogger("event-service")

RECONCILE_INTERVAL_SECONDS = 3.0


def _duration_str(path: str) -> Optional[str]:
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(path)
        length = getattr(getattr(audio, "info", None), "length", 0) or 0
        if length > 0:
            sec = int(length)
            return f"{sec // 60:02d}:{sec % 60:02d}"
    except Exception as ex:
        logger.debug("Could not read duration for %s: %s", path, ex)
    return None


class EventService:
    def __init__(self):
        self._last_reconcile = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ active cue
    @property
    def active_entry_id(self) -> Optional[str]:
        return db_service.get_active_entry_id()

    @active_entry_id.setter
    def active_entry_id(self, val: Optional[str]):
        db_service.set_active_entry_id(val)

    # ------------------------------------------------------------------ track reconciliation
    def reconcile_tracks(self, force: bool = False) -> int:
        """Aligns performances with the files present in tracks/ (adopting anything dropped in incoming/)."""
        now = time.time()
        if not force and now - self._last_reconcile < RECONCILE_INTERVAL_SECONDS:
            return 0
        with self._lock:
            self._last_reconcile = now
            changed = 0
            perfs = db_service.get_all_performances()
            try:
                track_store.adopt_incoming([p["entry_id"] for p in perfs])
            except Exception as ex:
                logger.warning("Adopting incoming files failed: %s", ex)
            files = track_store.scan()
            for p in perfs:
                entry_id = p["entry_id"]
                path = files.get(entry_id)
                if path:
                    ref = os.path.basename(path)
                    target_status = "Acoustic" if p.get("track_status") == "Acoustic" else "Uploaded"
                    if p.get("drive_file_id") != ref or p.get("track_status") != target_status:
                        db_service.update_performance_field(entry_id, "drive_file_id", ref)
                        db_service.update_performance_field(entry_id, "drive_file_name", ref)
                        db_service.update_performance_field(entry_id, "track_status", target_status)
                        db_service.update_performance_field(entry_id, "media_type", media_type_for(path))
                        if not p.get("duration"):
                            dur = _duration_str(path)
                            if dur:
                                db_service.update_performance_field(entry_id, "duration", dur)
                        changed += 1
                elif p.get("drive_file_id") or p.get("track_status") == "Uploaded":
                    db_service.update_performance_field(entry_id, "drive_file_id", None)
                    db_service.update_performance_field(entry_id, "drive_file_name", None)
                    db_service.update_performance_field(entry_id, "track_status", "Pending")
                    changed += 1
            return changed

    def migrate_legacy_cache_tracks(self) -> int:
        """Upgrade path: copy tracks that older versions kept as <entry>.mp3/.mp4 in the cache into tracks/."""
        from app.config import settings
        copied = 0
        for p in db_service.get_all_performances():
            entry_id = p["entry_id"]
            if track_store.find(entry_id):
                continue
            for ext in (".mp3", ".mp4"):
                legacy = os.path.join(settings.storage.cache_dir, f"{entry_id}{ext}")
                if os.path.isfile(legacy) and os.path.getsize(legacy) > 0:
                    name = track_store.canonical_name(entry_id, p.get("sequence_order"), p.get("performer_name", ""), p.get("song_title", ""), ext)
                    track_store.save(entry_id, legacy, name, move=False)
                    copied += 1
                    break
        if copied:
            logger.warning("Migrated %d legacy cached track(s) into the event folder's tracks/ directory.", copied)
        return copied

    # ------------------------------------------------------------------ reads
    def get_performances(self, force_sync: bool = False) -> List[PerformanceEntry]:
        self.reconcile_tracks(force=force_sync)
        return [PerformanceEntry(**row) for row in db_service.get_all_performances()]

    def get_stage_queue(self) -> List[PerformanceEntry]:
        performances = self.get_performances()
        performances.sort(key=lambda x: x.sequence_order if x.sequence_order is not None else 9999)
        return performances

    # ------------------------------------------------------------------ stage state
    def set_active_performance(self, entry_id: str) -> bool:
        self.update_status(entry_id, "On Stage")
        self.active_entry_id = entry_id
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

    @staticmethod
    def normalize_status(status: str) -> str:
        if status in ("Uploaded", "Upcoming", "Reset"):
            return "Upcoming"
        if status in ("Performed", "Done"):
            return "Performed"
        if status in ("Skipped", "On Hold"):
            return "On Hold"
        if status in ("On Stage", "Live"):
            return "On Stage"
        return status

    def update_status(self, entry_id: str, status: str) -> bool:
        if not db_service.get_performance(entry_id):
            raise ValueError(f"Performance entry {entry_id} not found")
        db_service.update_performance_field(entry_id, "performance_status", self.normalize_status(status))
        return True

    def update_stage_notes(self, entry_id: str, notes: str) -> bool:
        db_service.update_performance_field(entry_id, "stage_notes", (notes or "").strip())
        return True

    # ------------------------------------------------------------------ tracks
    def update_track_metadata(
        self,
        entry_id: str,
        file_name: str,
        status: str = "Uploaded",
        duration_str: Optional[str] = None,
        media_type: Optional[str] = None,
    ) -> bool:
        db_service.update_performance_field(entry_id, "track_status", status)
        if file_name:
            db_service.update_performance_field(entry_id, "drive_file_id", file_name)
            db_service.update_performance_field(entry_id, "drive_file_name", file_name)
        if duration_str:
            db_service.update_performance_field(entry_id, "duration", duration_str)
        if media_type:
            db_service.update_performance_field(entry_id, "media_type", media_type)
        db_service.update_performance_field(entry_id, "last_updated", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        return True

    # ------------------------------------------------------------------ ordering
    def update_sequence_orders(self, items: List[Dict[str, Any]], push: bool = True) -> int:
        """Updates the running order. With push=False the file names/exports are staged (dirty flag)."""
        item_map = {it["entry_id"]: int(it["sequence_order"]) for it in items if "entry_id" in it and "sequence_order" in it}
        for eid, seq in item_map.items():
            db_service.update_performance_field(eid, "sequence_order", seq)
        if not push:
            db_service.set_dirty_sequence(True)
            return len(item_map)
        return self.sync_sequence()

    def sync_sequence(self) -> int:
        """Renames track files to their numbered names, writes the export, and clears the dirty flag."""
        renamed = 0
        for p in db_service.get_all_performances():
            current = track_store.find(p["entry_id"])
            if not current:
                continue
            ext = os.path.splitext(current)[1]
            wanted = track_store.canonical_name(p["entry_id"], p.get("sequence_order"), p.get("performer_name", ""), p.get("song_title", ""), ext)
            try:
                new_path = track_store.rename_to(p["entry_id"], wanted)
            except OSError as ex:
                logger.warning("Could not rename track for %s: %s", p["entry_id"], ex)
                continue
            if new_path and os.path.basename(new_path) != p.get("drive_file_name"):
                db_service.update_performance_field(p["entry_id"], "drive_file_id", os.path.basename(new_path))
                db_service.update_performance_field(p["entry_id"], "drive_file_name", os.path.basename(new_path))
                renamed += 1
        db_service.set_dirty_sequence(False)
        db_service.set_last_sync_time()
        try:
            from app.services.export_service import export_service
            export_service.export_now(snapshot=False)
        except Exception as ex:
            logger.warning("Export after sequence sync failed: %s", ex)
        return len(db_service.get_all_performances())


event_service = EventService()
