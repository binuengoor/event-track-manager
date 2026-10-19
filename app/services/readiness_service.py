"""'Is this event ready?' checks shown to the admin. Each check says what is wrong and how to fix it."""
import os
import shutil
import logging
from typing import Dict, Any, List

from app.config import settings, get_setting
from app.services.db_service import db_service
from app.services.track_store import track_store
from app.services.downloader_client import downloader_client

logger = logging.getLogger("readiness")

OK, WARN, ERROR, INFO = "ok", "warn", "error", "info"


def _check(cid: str, label: str, status: str, detail: str, fix: str = "") -> Dict[str, Any]:
    return {"id": cid, "label": label, "status": status, "detail": detail, "fix": fix}


class ReadinessService:
    async def run(self) -> Dict[str, Any]:
        checks: List[Dict[str, Any]] = []
        checks.append(self._pin())
        checks.append(self._storage())
        checks.append(self._disk())
        checks.append(self._ffmpeg())
        checks.append(await self._downloader())
        checks.extend(self._acts())
        checks.append(self._backup())
        checks.append(self._incoming())
        checks.append(self._wizard())
        counts = {s: sum(1 for c in checks if c["status"] == s) for s in (OK, WARN, ERROR, INFO)}
        overall = ERROR if counts[ERROR] else (WARN if counts[WARN] else OK)
        return {"overall": overall, "counts": counts, "checks": checks}

    # ------------------------------------------------------------------ individual checks
    def _pin(self):
        if settings.admin_pin == "2026":
            return _check("pin", "Admin PIN", WARN, "Still the default PIN (2026). Anyone who knows it can change settings.",
                          "Set ADMIN_PIN in .env and restart.")
        if not getattr(settings, "operator_pin", ""):
            return _check("pin", "Admin PIN", OK, "Custom PIN set. Optional: set OPERATOR_PIN so a volunteer can run the console without admin access.")
        return _check("pin", "Admin and operator PINs", OK, "Both PINs are set.")

    def _storage(self):
        probe = os.path.join(settings.storage.event_dir, f".write_test_{os.getpid()}")
        try:
            with open(probe, "w") as f:
                f.write("ok")
            os.remove(probe)
            return _check("storage", "Event folder", OK, f"Writable: {settings.storage.event_dir}")
        except OSError as ex:
            return _check("storage", "Event folder", ERROR, f"Cannot write to {settings.storage.event_dir}: {ex}",
                          "Fix permissions on the mapped folder (Linux: chown -R 1000:1000 events).")

    def _disk(self):
        try:
            free_gb = shutil.disk_usage(settings.storage.event_dir).free / (1024 ** 3)
        except OSError:
            return _check("disk", "Free disk space", WARN, "Could not read disk usage.")
        if free_gb < 1:
            return _check("disk", "Free disk space", ERROR, f"Only {free_gb:.1f} GB free.", "Free space before accepting uploads.")
        if free_gb < 5:
            return _check("disk", "Free disk space", WARN, f"{free_gb:.1f} GB free.", "Video tracks can be large; free more space if you expect many.")
        return _check("disk", "Free disk space", OK, f"{free_gb:.0f} GB free.")

    def _ffmpeg(self):
        if shutil.which("ffmpeg"):
            return _check("ffmpeg", "Audio/video conversion (ffmpeg)", OK, "Installed.")
        return _check("ffmpeg", "Audio/video conversion (ffmpeg)", ERROR, "ffmpeg not found, uploads cannot be converted.", "Use the Docker image, or install ffmpeg.")

    async def _downloader(self):
        try:
            status = await downloader_client.check_health()
        except Exception as ex:
            status = {"status": "unavailable", "error": str(ex)}
        if status.get("status") == "healthy":
            version = status.get("ytdlp_version")
            return _check("downloader", "YouTube link extractor", OK,
                          "Reachable" + (f", yt-dlp {version} (updates itself daily)." if version else ".")
                          + ("" if status.get("cookies_mounted") else " No cookies file (optional, helps with YouTube bot checks)."))
        return _check("downloader", "YouTube link extractor", WARN, "Not reachable. Pasting YouTube links will fail; file uploads still work.",
                      "Start the downloader container: docker compose up -d downloader")

    def _acts(self):
        perfs = db_service.get_all_performances()
        out = []
        stage_on = bool(get_setting("stage_performances_enabled", True))
        if not stage_on:
            return [_check("acts", "Performances", INFO, "Stage performances are off for this event type.")]
        if not perfs:
            return [_check("acts", "Performances", INFO, "No performances registered yet.", "Share the sign-up page: /signup")]
        no_song = [p for p in perfs if p.get("is_song_name_missing")]
        out.append(_check("songs", "Song titles", WARN if no_song else OK,
                          f"{len(no_song)} act(s) have no song title yet: " + ", ".join(p["performer_name"] for p in no_song[:5]) + ("..." if len(no_song) > 5 else "")
                          if no_song else "Every act has a song title.",
                          "Ask them to fill it in on the Performer Hub." if no_song else ""))
        if bool(get_setting("track_upload_enabled", True)):
            needs = [p for p in perfs if p.get("track_status") not in ("Uploaded", "Acoustic") and not p.get("drive_file_id")]
            out.append(_check("tracks", "Backing tracks", WARN if needs else OK,
                              f"{len(needs)} of {len(perfs)} act(s) still need a track: " + ", ".join(p["performer_name"] for p in needs[:5]) + ("..." if len(needs) > 5 else "")
                              if needs else f"All {len(perfs)} acts have a track or are live/acoustic.",
                              "Performers upload on the Performer Hub, or drop files named with the entry id (e.g. PK-004_song.mp3) into the incoming/ folder." if needs else ""))
        return out

    def _backup(self):
        if not bool(get_setting("backup_enabled", settings.backup.enabled)):
            return _check("backup", "Exports and snapshots", WARN, "Automatic export is turned off.", "Turn it on in Backup & Sync.")
        last = db_service.get_last_backup_info()
        if not last:
            return _check("backup", "Exports and snapshots", INFO, "No export yet. One is written a few seconds after the first change.")
        if last.get("status") == "error":
            return _check("backup", "Exports and snapshots", ERROR, f"Last export failed: {last.get('error_msg') or 'unknown error'}", "Check disk space and folder permissions.")
        return _check("backup", "Exports and snapshots", OK, f"Last export: {last.get('completed_at') or last.get('triggered_at')}")

    def _incoming(self):
        try:
            waiting = [n for n in os.listdir(track_store.incoming_dir) if not n.startswith(".") and not n.endswith(".part")]
        except OSError:
            waiting = []
        if waiting:
            return _check("incoming", "Dropped-in files", WARN, f"{len(waiting)} file(s) in incoming/ are not attached to an act: " + ", ".join(waiting[:4]),
                          "Rename them to include the entry id, e.g. PK-004_song.mp3 (see the Participants tab).")
        return _check("incoming", "Dropped-in files", OK, "Nothing waiting in incoming/.")

    def _wizard(self):
        if bool(get_setting("setup_completed", False)):
            return _check("wizard", "Event setup", OK, "Setup wizard completed.")
        return _check("wizard", "Event setup", INFO, "The setup wizard has not been run.", "Features & Presets -> Run setup wizard.")


readiness_service = ReadinessService()
