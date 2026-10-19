"""Multiple events, one active at a time.

Each event is a folder under the events root (``<events>/<event id>/``) with its own database, tracks, exports and
backups, so everything about a past event (sign-ups, potluck, payments) is kept. The active event is remembered in
``<events>/.active_event`` and drives every page. Switching re-points the app at another folder without a restart.
"""
import os
import re
import json
import shutil
import sqlite3
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.config import settings, get_setting
from app.services.db_service import db_service
from app.services.track_store import MEDIA_EXTS

logger = logging.getLogger("event-manager")

ACTIVE_FILE = ".active_event"
ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9._-]{0,60}")
# Settings that describe one particular event and are NOT carried over when creating a new one
EVENT_SPECIFIC_KEYS = {
    "event_name", "event_subtitle", "event_date_time", "event_start_time", "event_venue", "event_time_range",
    "event_poster_url", "general_notes", "event_id", "setup_completed", "signup_sheet_url", "venue", "time_range",
}


class EventManagerError(ValueError):
    pass


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:60].strip("-") or "event"


class EventManager:
    # ------------------------------------------------------------------ paths / mode
    @staticmethod
    def events_root() -> str:
        return settings.storage.events_dir

    @staticmethod
    def switching_enabled() -> bool:
        """Off when the operator pinned one folder with EVENT_DIR / TRACKS_DIR."""
        return bool(settings.storage.events_dir) and not os.getenv("EVENT_DIR") and not os.getenv("TRACKS_DIR")

    def active_id(self) -> str:
        return os.path.basename(os.path.normpath(settings.storage.event_dir))

    def _folder(self, event_id: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}", event_id or ""):
            raise EventManagerError("Invalid event id.")
        path = os.path.join(self.events_root(), event_id)
        if os.path.commonpath([os.path.abspath(path), os.path.abspath(self.events_root())]) != os.path.abspath(self.events_root()):
            raise EventManagerError("Invalid event id.")
        return path

    # ------------------------------------------------------------------ reading events
    @staticmethod
    def _dir_size(path: str) -> int:
        total = 0
        for root, _dirs, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
        return total

    def _summarize(self, event_id: str) -> Optional[Dict[str, Any]]:
        folder = self._folder(event_id)
        db_path = os.path.join(folder, "event.db")
        if not os.path.isfile(db_path):
            return None
        info: Dict[str, Any] = {"id": event_id, "name": event_id, "start_time": "", "performances": 0, "singers": 0,
                                "participants": 0, "potluck_taken": 0, "potluck_total": 0}
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
            conn.row_factory = sqlite3.Row
            try:
                def setting(key):
                    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
                    if not row:
                        return ""
                    try:
                        return json.loads(row["value"]) if row["value"] not in ("", None) else ""
                    except Exception:
                        return row["value"]
                info["name"] = setting("event_name") or event_id
                info["start_time"] = setting("event_start_time") or setting("event_date_time") or ""
                info["performances"] = conn.execute("SELECT COUNT(*) FROM performances").fetchone()[0]
                info["participants"] = conn.execute("SELECT COUNT(*) FROM participants").fetchone()[0]
                info["potluck_total"] = conn.execute("SELECT COUNT(*) FROM food_items").fetchone()[0]
                info["potluck_taken"] = conn.execute("SELECT COUNT(*) FROM food_signups").fetchone()[0]
                info["paid"] = conn.execute("SELECT COUNT(*) FROM participants WHERE paid = 1").fetchone()[0]
            finally:
                conn.close()
        except Exception as ex:
            logger.warning("Could not summarize event %s: %s", event_id, ex)
        tracks = os.path.join(folder, "tracks")
        incoming = os.path.join(folder, "incoming")
        info["media_bytes"] = self._dir_size(tracks) + self._dir_size(incoming)
        info["media_files"] = sum(1 for d in (tracks, incoming) for _r, _s, fs in os.walk(d) for f in fs if os.path.splitext(f)[1].lower() in MEDIA_EXTS)
        info["last_activity"] = datetime.fromtimestamp(max(
            [os.path.getmtime(db_path)] + [os.path.getmtime(p) for p in (db_path + "-wal",) if os.path.exists(p)]
        )).strftime("%Y-%m-%d %H:%M")
        info["active"] = event_id == self.active_id()
        return info

    def list_events(self) -> List[Dict[str, Any]]:
        root = self.events_root()
        if not root or not os.path.isdir(root):
            current = self._summarize(self.active_id()) if os.path.isdir(settings.storage.event_dir) else None
            return [current] if current else []
        events = []
        for name in sorted(os.listdir(root)):
            if name.startswith(".") or not os.path.isdir(os.path.join(root, name)):
                continue
            try:
                summary = self._summarize(name)
            except EventManagerError:
                continue
            if summary:
                events.append(summary)
        events.sort(key=lambda e: (not e["active"], e["start_time"] or "", e["name"].lower()))
        return events

    # ------------------------------------------------------------------ create
    def create_event(self, name: str, start_time: str = "", venue: str = "", subtitle: str = "",
                     copy_from: str = "current", activate: bool = True) -> Dict[str, Any]:
        if not self.switching_enabled():
            raise EventManagerError("Multiple events are off because EVENT_DIR pins a single folder.")
        name = (name or "").strip()
        if len(name) < 2:
            raise EventManagerError("Give the event a name.")
        if len(name) > 80:
            raise EventManagerError("Event name is too long (80 characters max).")

        base = slugify(name)
        event_id, n = base, 1
        while os.path.exists(os.path.join(self.events_root(), event_id)):
            n += 1
            event_id = f"{base}-{n}"
        if not ID_PATTERN.fullmatch(event_id):
            raise EventManagerError("Could not make a folder name from that event name.")

        source_db = None
        if copy_from == "current":
            source_db = os.path.join(settings.storage.event_dir, "event.db")
        elif copy_from and copy_from != "none":
            source_db = os.path.join(self._folder(copy_from), "event.db")
            if not os.path.isfile(source_db):
                raise EventManagerError(f"Event '{copy_from}' not found.")

        folder = self._folder(event_id)
        for sub in ("", "tracks", "incoming", "backups", "gallery"):
            os.makedirs(os.path.join(folder, sub), exist_ok=True)
        new_db = os.path.join(folder, "event.db")

        from app.repositories.schema import ensure_database
        conn = sqlite3.connect(new_db)
        conn.row_factory = sqlite3.Row
        try:
            ensure_database(conn)
            if source_db:
                src = sqlite3.connect(f"file:{source_db}?mode=ro", uri=True)
                src.row_factory = sqlite3.Row
                try:
                    for row in src.execute("SELECT key, value FROM app_settings").fetchall():
                        if row["key"] not in EVENT_SPECIFIC_KEYS:
                            conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", (row["key"], row["value"]))
                    for g in src.execute("SELECT group_id, name, display_order FROM food_groups").fetchall():
                        conn.execute("INSERT OR IGNORE INTO food_groups (group_id, name, display_order) VALUES (?, ?, ?)", tuple(g))
                    for i in src.execute("SELECT item_id, name, group_id, display_order FROM food_items").fetchall():
                        conn.execute("INSERT OR IGNORE INTO food_items (item_id, name, group_id, display_order) VALUES (?, ?, ?, ?)", tuple(i))
                finally:
                    src.close()
            overrides = {
                "event_name": name, "event_subtitle": subtitle or "", "event_start_time": start_time or "",
                "event_date_time": start_time or "", "event_venue": venue or "", "event_time_range": "",
                "event_poster_url": "", "general_notes": "", "event_id": event_id, "setup_completed": False,
            }
            for key, value in overrides.items():
                conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                             (key, value if isinstance(value, str) else json.dumps(value)))
            conn.execute("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('food_seeded', '1')")
            conn.commit()
        finally:
            conn.close()

        logger.info("Created event %s (%s)", event_id, name)
        if activate:
            self.activate(event_id)
        return self._summarize(event_id) or {"id": event_id, "name": name}

    # ------------------------------------------------------------------ switch
    def activate(self, event_id: str) -> Dict[str, Any]:
        if not self.switching_enabled():
            raise EventManagerError("Switching events is off because EVENT_DIR pins a single folder.")
        folder = self._folder(event_id)
        if not os.path.isfile(os.path.join(folder, "event.db")):
            raise EventManagerError(f"Event '{event_id}' not found.")
        if event_id == self.active_id():
            return {"id": event_id, "changed": False}

        # remember the choice (atomic) so a restart comes back to the same event
        tmp = os.path.join(self.events_root(), ACTIVE_FILE + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(event_id)
        os.replace(tmp, os.path.join(self.events_root(), ACTIVE_FILE))

        self._point_at(folder, event_id)
        self.bootstrap(seed_food=False)
        db_service.log_activity(action_type="admin_edit", performer_name="Admin",
                                summary=f"Activated event '{event_id}'", source="admin")
        logger.warning("Active event is now %s (%s)", event_id, folder)
        return {"id": event_id, "changed": True}

    @staticmethod
    def _point_at(folder: str, event_id: str):
        settings.event.id = event_id
        settings.storage.event_dir = folder
        settings.storage.tracks_dir = os.path.join(folder, "tracks")
        if not os.getenv("GALLERY_DIR"):
            settings.storage.gallery_dir = os.path.join(folder, "gallery")
        for sub in ("tracks", "incoming", "backups", "gallery"):
            os.makedirs(os.path.join(folder, sub), exist_ok=True)

        # forget per-event runtime state
        from app.services.event_service import event_service
        from app.services.export_service import export_service
        from app.services.backup_service import backup_service
        from app.services.live_broadcaster import live_broadcaster
        event_service._last_reconcile = 0.0
        export_service._last_snapshot = 0.0
        backup_service._pending_backup = False
        live_broadcaster._digest = None
        db_service.db_manager.close_all()

    def bootstrap(self, seed_food: bool = False, migrate_legacy: bool = False):
        """Makes the (possibly just-activated) event ready: schema, default settings, tracks, first export."""
        from app.services.event_service import event_service
        from app.services.export_service import export_service
        from app.services.audio_service import audio_service
        try:
            audio_service.prune_cache_if_needed()   # scratch hygiene: leftovers of failed uploads/downloads
        except Exception as ex:
            logger.debug("Scratch cleanup skipped: %s", ex)
        db_service._ensure_db()
        db_service.seed_app_settings(default_app_settings())
        if db_service.get_meta("food_seeded") != "1":
            if seed_food:
                db_service.seed_food_catalog(settings.food_items_seed)
            db_service.set_meta("food_seeded", "1")
        try:
            if migrate_legacy:
                event_service.migrate_legacy_cache_tracks()  # startup only: the scratch dir is shared between events
            event_service.reconcile_tracks(force=True)
            export_service.export_now(snapshot=False)
        except Exception as ex:
            logger.warning("Event bootstrap export failed: %s", ex)

    # ------------------------------------------------------------------ media
    def clear_media(self, event_id: str) -> Dict[str, Any]:
        """Deletes the downloaded/uploaded audio and video of an event to free disk. Sign-ups, potluck,
        payments and every other record are kept; acts simply go back to 'no track yet'."""
        folder = self._folder(event_id)
        db_path = os.path.join(folder, "event.db")
        if not os.path.isfile(db_path):
            raise EventManagerError(f"Event '{event_id}' not found.")

        freed, files = 0, 0
        for sub in ("tracks", "incoming"):
            root = os.path.join(folder, sub)
            for dirpath, _dirs, names in os.walk(root):
                for fname in names:
                    if os.path.splitext(fname)[1].lower() in MEDIA_EXTS or fname.endswith(".part"):
                        path = os.path.join(dirpath, fname)
                        try:
                            freed += os.path.getsize(path)
                            os.remove(path)
                            files += 1
                        except OSError as ex:
                            logger.warning("Could not delete %s: %s", path, ex)
            # tidy empty archive folders
            arch = os.path.join(root, "_archive")
            if os.path.isdir(arch) and not os.listdir(arch):
                try:
                    os.rmdir(arch)
                except OSError:
                    pass

        conn = sqlite3.connect(db_path, timeout=15)
        try:
            conn.execute("""UPDATE performances SET drive_file_id = NULL, drive_file_name = NULL, duration = NULL,
                            track_status = CASE WHEN track_status = 'Acoustic' THEN 'Acoustic' ELSE 'Pending' END
                            WHERE drive_file_id IS NOT NULL OR drive_file_name IS NOT NULL OR track_status = 'Uploaded'""")
            conn.commit()
        finally:
            conn.close()
        if event_id == self.active_id():
            db_service.log_activity(action_type="admin_edit", performer_name="Admin",
                                    summary=f"Cleared media ({files} file(s), {freed // (1024 * 1024)} MB freed)", source="admin")
        logger.warning("Cleared media for %s: %d files, %d bytes", event_id, files, freed)
        return {"event_id": event_id, "files_deleted": files, "bytes_freed": freed}


def default_app_settings() -> Dict[str, Any]:
    """Defaults seeded into a fresh event database (existing values are never overwritten)."""
    return {
        "event_name": settings.event.name,
        "event_subtitle": settings.event.subtitle,
        "event_date_time": settings.event.start_time,
        "event_start_time": settings.event.start_time,
        "event_venue": settings.event.venue,
        "event_time_range": settings.event.time_range,
        "event_poster_url": settings.event.poster_url,
        "payment_url": settings.event.payment_url or "",
        "signup_sheet_url": settings.event.signup_sheet_url or "",
        "food_signup_enabled": settings.signup.food_signup_enabled,
        "signup_enabled": settings.signup.signup_enabled,
        "track_upload_enabled": settings.signup.track_upload_enabled,
        "allow_duets": settings.signup.allow_duets,
        "performer_edits_enabled": settings.signup.performer_edits_enabled,
        "live_display_enabled": settings.signup.live_display_enabled,
        "dashboard_enabled": settings.signup.dashboard_enabled,
        "payment_enabled": settings.signup.payment_enabled,
        "food_serving_note": settings.signup.food_serving_note,
        "max_performances_per_participant": settings.signup.max_performances_per_participant,
        "max_solo_per_participant": settings.signup.max_solo_per_participant,
        "performance_types": settings.signup.performance_types,
        "age_groups": [ag.model_dump() for ag in settings.signup.age_groups],
        "entry_id_prefix": settings.entry_id_prefix,
        "console_extra_columns": settings.console_extra_columns,
        "live_order_by": settings.live_order_by,
        "backup_enabled": settings.backup.enabled,
    }


event_manager = EventManager()
