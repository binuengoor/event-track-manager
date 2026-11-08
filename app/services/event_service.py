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
RECONCILE_JOIN_TIMEOUT_SECONDS = 5.0


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


def file_version(path: str) -> str:
    """Stable content version (size + mtime). Unchanged by renames, so the console's offline vault stays valid
    when Save Order renumbers files, and changes when a track is replaced."""
    st = os.stat(path)
    return f"v{st.st_size}-{int(st.st_mtime)}"


class EventService:
    def __init__(self):
        self._last_reconcile = 0.0
        self._lock = threading.RLock()
        self._worker_lock = threading.Lock()
        self._worker_stop = threading.Event()
        self._worker = None

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
        with self._lock:
            now = time.monotonic()
            if not force and now - self._last_reconcile < RECONCILE_INTERVAL_SECONDS:
                return 0
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
                    version = file_version(path)
                    target_status = "Acoustic" if p.get("track_status") == "Acoustic" else "Uploaded"
                    if p.get("track_version") != version or p.get("track_file") != ref or p.get("track_status") != target_status:
                        db_service.update_performance_field(entry_id, "track_version", version)
                        db_service.update_performance_field(entry_id, "track_file", ref)
                        db_service.update_performance_field(entry_id, "track_status", target_status)
                        db_service.update_performance_field(entry_id, "media_type", media_type_for(path))
                        if not p.get("duration"):
                            dur = _duration_str(path)
                            if dur:
                                db_service.update_performance_field(entry_id, "duration", dur)
                        changed += 1
                elif p.get("track_version") or p.get("track_status") == "Uploaded":
                    db_service.update_performance_field(entry_id, "track_version", None)
                    db_service.update_performance_field(entry_id, "track_file", None)
                    db_service.update_performance_field(entry_id, "track_status", "Pending")
                    changed += 1
            return changed

    def start_reconcile_worker(self) -> None:
        """Start one background scanner for the current application lifespan."""
        with self._worker_lock:
            if self._worker and self._worker.is_alive():
                if self._worker_stop.is_set():
                    raise RuntimeError("Previous track reconciliation worker is still stopping")
                return
            self._worker_stop.clear()
            self._worker = threading.Thread(target=self._reconcile_loop, name="track-reconcile", daemon=True)
            self._worker.start()

    def _reconcile_loop(self) -> None:
        try:
            while not self._worker_stop.wait(RECONCILE_INTERVAL_SECONDS):
                try:
                    self.reconcile_tracks()
                except Exception:
                    logger.exception("Background track reconciliation failed")
        finally:
            # DatabaseManager connections are thread-local.
            db_service.db_manager.close_all()

    def stop_reconcile_worker(self) -> None:
        """Stop and join before application shutdown or a subsequent start."""
        with self._worker_lock:
            worker = self._worker
            if not worker:
                return
            self._worker_stop.set()
            worker.join(timeout=RECONCILE_JOIN_TIMEOUT_SECONDS)
            if worker.is_alive():
                logger.warning("Track reconciliation worker did not stop before timeout")
            else:
                self._worker = None

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
        if force_sync:
            self.reconcile_tracks(force=True)
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
            path = track_store.find(entry_id)
            db_service.update_performance_field(entry_id, "track_version", file_version(path) if path else file_name)
            db_service.update_performance_field(entry_id, "track_file", file_name)
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
            if new_path and os.path.basename(new_path) != p.get("track_file"):
                db_service.update_performance_field(p["entry_id"], "track_version", file_version(new_path))
                db_service.update_performance_field(p["entry_id"], "track_file", os.path.basename(new_path))
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
