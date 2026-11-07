"""Lineup helpers for the admin: files waiting in incoming/ and restoring an archived previous track."""
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.services.db_service import db_service
from app.services.event_service import event_service
from app.services.track_store import MEDIA_EXTS, media_type_for, track_store

_ARCHIVED_RE = re.compile(r"^(?P<base>.+)_archived_(?P<stamp>\d{8}-\d{6})(?P<ext>\.[^.]+)$")


class NoArchivedTrackError(Exception):
    pass


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
