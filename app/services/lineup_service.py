"""Lineup helpers for the admin: files waiting in incoming/ and restoring an archived previous track."""
import os
import re
import json
import shutil
import tempfile
import stat
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.services.db_service import db_service
from app.services.event_service import event_service
from app.services.track_store import MEDIA_EXTS, VIDEO_EXTS, media_type_for, track_store
from app.config import settings
from app.services.audio_workflow_service import audio_workflow_service
from app.services.backup_service import backup_service

_ARCHIVED_RE = re.compile(r"^(?P<base>.+)_archived_(?P<stamp>\d{8}-\d{6}(?:-\d+)?)(?P<ext>\.[^.]+)$")


class NoArchivedTrackError(Exception):
    pass


class LineupActionError(ValueError):
    pass


def restore_archived_tracks(paths: List[str]) -> None:
    """Undo a pre-delete archive if the database deletion did not complete."""
    for archived in paths:
        if not os.path.exists(archived):
            continue
        name = os.path.basename(archived)
        match = _ARCHIVED_RE.match(name)
        if not match:
            continue
        original = f"{match.group('base')}{match.group('ext')}"
        destination = os.path.join(track_store.tracks_dir, original)
        # A concurrent replacement may have created a current file. Keep both rather than overwrite it.
        if not os.path.exists(destination):
            os.replace(archived, destination)


def add_act(payload: Dict[str, Any]) -> Dict[str, Any]:
    performer = str(payload.get("performer_name") or "").strip()
    song = str(payload.get("song_title") or "").strip()
    if not performer or not song:
        raise LineupActionError("Performer name and song title are required.")
    partner = str(payload.get("partner_name") or "").strip() or None
    performance_type = str(payload.get("performance_type") or "Solo").strip()
    if not performance_type:
        raise LineupActionError("Performance type is required.")
    if performance_type not in settings.signup.performance_types:
        raise LineupActionError("Choose a performance type enabled for this event.")
    entry_id = db_service.create_performance(
        performer_name=performer, song_title=song, performance_type=performance_type,
        partner_name=partner, contact_info="", age_group=str(payload.get("age_group") or "Senior").strip(),
        partner_age_group=str(payload.get("partner_age_group") or "Senior").strip() if partner else None,
        created_via="admin",
    )
    db_service.log_activity(action_type="admin_act_add", performer_name=performer, entry_id=entry_id,
                            summary=f"Admin added act {entry_id} ({performer} - '{song}')",
                            details=json.dumps({"performance_type": performance_type, "partner_name": partner}),
                            source="admin", role="admin")
    backup_service.trigger_backup()
    return {"status": "success", "entry_id": entry_id}


def _install_track(entry_id: str, source_path: str, original_name: str) -> Dict[str, Any]:
    perf = db_service.get_performance(entry_id)
    if not perf:
        raise LineupActionError("Entry not found.")
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in MEDIA_EXTS:
        raise LineupActionError("File type is not a supported audio or video format.")
    canonical = track_store.canonical_name(entry_id, perf.get("sequence_order"), perf.get("performer_name", ""),
                                           perf.get("song_title", ""), ext)
    stage_fd, stage_path = tempfile.mkstemp(prefix=".admin_track_", suffix=ext, dir=track_store.tracks_dir)
    os.close(stage_fd)
    archived = []
    try:
        shutil.copyfile(source_path, stage_path)
        if os.path.getsize(stage_path) <= 0:
            raise LineupActionError("The uploaded file is empty.")
        archived = track_store.archive_existing(entry_id)
        dest = os.path.join(track_store.tracks_dir, canonical)
        os.replace(stage_path, dest)
        stage_path = ""
    except Exception:
        if stage_path and os.path.exists(stage_path):
            os.remove(stage_path)
        # Restore the prior active files if installation failed after archiving.
        for archived_path in archived:
            if os.path.exists(archived_path):
                original = re.sub(r"_archived_\d{8}-\d{6}(?:-\d+)?(?=\.[^.]+$)", "", os.path.basename(archived_path))
                restore_path = os.path.join(track_store.tracks_dir, original)
                if not os.path.exists(restore_path):
                    os.replace(archived_path, restore_path)
        raise
    event_service.update_track_metadata(entry_id, os.path.basename(dest), status="Uploaded", media_type=media_type_for(dest))
    db_service.log_activity(action_type="track_upload", performer_name=perf.get("performer_name", ""), entry_id=entry_id,
                            summary=f"Admin replaced track for {entry_id} with '{os.path.basename(dest)}'",
                            details=json.dumps({"filename": os.path.basename(dest)}), source="admin", role="admin")
    backup_service.trigger_backup()
    return {"status": "success", "entry_id": entry_id, "filename": os.path.basename(dest),
            "media_type": media_type_for(dest)}


async def replace_track(entry_id: str, upload) -> Dict[str, Any]:
    if not db_service.get_performance(entry_id):
        raise FileNotFoundError(entry_id)
    filename = os.path.basename(upload.filename or "")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in MEDIA_EXTS:
        raise LineupActionError("File type is not a supported audio or video format.")
    is_video = ext in VIDEO_EXTS
    audio_workflow_service.check_extension(filename, is_video)
    limit = audio_workflow_service.max_upload_bytes(is_video)
    from app.services.audio_service import audio_service
    os.makedirs(audio_service.cache_dir, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".admin_upload_", dir=audio_service.cache_dir)
    size = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise LineupActionError("The uploaded file exceeds the size limit.")
                out.write(chunk)
        if size == 0:
            raise LineupActionError("The uploaded file is empty.")
        return await audio_workflow_service.process_track_upload(
            entry_id=entry_id, submission_type="file", media_type="video" if is_video else "audio",
            file_path=temp_path, original_filename=filename, audit_source="admin", audit_role="admin",
        )
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def match_incoming(entry_id: str, filename: str) -> Dict[str, Any]:
    if not db_service.get_performance(entry_id):
        raise FileNotFoundError(entry_id)
    if not filename or filename != os.path.basename(filename) or filename in (".", "..") or "/" in filename or "\\" in filename:
        raise LineupActionError("Choose a file from the incoming folder by its filename.")
    source = os.path.join(track_store.incoming_dir, filename)
    if not os.path.isfile(source) or os.path.islink(source):
        raise FileNotFoundError(filename)
    if os.path.splitext(filename)[1].lower() not in MEDIA_EXTS:
        raise LineupActionError("File type is not a supported audio or video format.")
    # Pin the selected regular file before copying so a symlink swap cannot escape incoming/.
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(source, os.O_RDONLY | nofollow)
    staged = None
    try:
        source_stat = os.fstat(fd)
        if not stat.S_ISREG(source_stat.st_mode):
            raise FileNotFoundError(filename)
        stage_fd, staged = tempfile.mkstemp(prefix=".matched_", suffix=os.path.splitext(filename)[1],
                                             dir=track_store.incoming_dir)
        with os.fdopen(stage_fd, "wb") as out, os.fdopen(fd, "rb", closefd=False) as incoming:
            shutil.copyfileobj(incoming, out)
        result = _install_track(entry_id, staged, filename)
        current_stat = os.stat(source, follow_symlinks=False)
        if (current_stat.st_dev, current_stat.st_ino) == (source_stat.st_dev, source_stat.st_ino):
            os.unlink(source)
        return result
    finally:
        os.close(fd)
        if staged and os.path.exists(staged):
            os.remove(staged)


def list_incoming() -> List[Dict[str, Any]]:
    """Files waiting in incoming/ (not attached to an act yet), newest first."""
    out = []
    try:
        names = os.listdir(track_store.incoming_dir)
    except OSError:
        return out
    for name in names:
        path = os.path.join(track_store.incoming_dir, name)
        if name.startswith(".") or name.endswith(".part") or not os.path.isfile(path):
            continue
        st = os.stat(path)
        out.append({"name": name, "size": st.st_size, "modified": datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(),
                    "_ts": st.st_mtime})
    out.sort(key=lambda r: r["_ts"], reverse=True)
    for r in out:
        r.pop("_ts")
    return out


def _archived_for(entry_id: str) -> List[str]:
    safe = "".join(c for c in (entry_id or "") if c.isalnum() or c in ("-", "_"))
    found = []
    if not safe:
        return found
    for name in os.listdir(track_store.archive_dir):
        path = os.path.join(track_store.archive_dir, name)
        if (os.path.isfile(path) and not name.startswith(".") and os.path.splitext(name)[1].lower() in MEDIA_EXTS
                and os.path.getsize(path) > 0 and safe in track_store._tokens(name)):
            found.append(path)

    def key(path: str):
        m = _ARCHIVED_RE.match(os.path.basename(path))
        return (m.group("stamp") if m else "", os.path.getmtime(path))

    return sorted(found, key=key, reverse=True)


def restore_previous_track(entry_id: str) -> Optional[Dict[str, Any]]:
    """Brings the newest archived track back; the track it replaces is archived (nothing is ever deleted)."""
    perf = db_service.get_performance(entry_id)
    if not perf:
        return None
    archived = _archived_for(entry_id)
    if not archived:
        raise NoArchivedTrackError(entry_id)
    src = archived[0]
    m = _ARCHIVED_RE.match(os.path.basename(src))
    restored_name = f"{m.group('base')}{m.group('ext')}" if m else os.path.basename(src)
    # Take the file out of the archive first: save() archives the current track, and an archive name collision
    # within the same second would otherwise overwrite the very file we are restoring.
    hold = os.path.join(track_store.archive_dir, f".restoring_{os.path.basename(src)}")
    os.replace(src, hold)
    try:
        dest = track_store.save(entry_id, hold, restored_name, move=True)
    except Exception:
        if os.path.exists(hold):
            os.replace(hold, src)
        raise
    event_service.update_track_metadata(entry_id, os.path.basename(dest), status="Uploaded", media_type=media_type_for(dest))
    db_service.log_activity(
        action_type="track_restore", performer_name=perf.get("performer_name", ""), entry_id=entry_id,
        summary=f"Restored previous track '{os.path.basename(dest)}' for {entry_id}", source="admin", role="admin")
    return {"status": "success", "entry_id": entry_id, "filename": os.path.basename(dest),
            "media_type": media_type_for(dest), "performer_name": perf.get("performer_name", "")}
