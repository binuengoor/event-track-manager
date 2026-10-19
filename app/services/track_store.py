"""Local backing-track storage: everything lives in the event folder (tracks/, incoming/).

Files are matched to performances by the entry id token inside the file name
(e.g. ``02_PK-004_Maya_Nair_Kannalane.mp3`` belongs to ``PK-004``), so organizers can also drop
files in by hand, or let a sync tool (rclone) deliver them, without touching the app.
"""
import os
import re
import shutil
import logging
from datetime import datetime
from typing import Dict, List, Optional

from app.config import settings

logger = logging.getLogger("track-store")

AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
MEDIA_EXTS = AUDIO_EXTS | VIDEO_EXTS
ARCHIVE_DIRNAME = "_archive"


def sanitize_filename(text: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", text or "").strip()
    return re.sub(r"[-\s]+", "_", cleaned)


def media_type_for(path: str) -> str:
    return "video" if os.path.splitext(path)[1].lower() in VIDEO_EXTS else "audio"


class TrackStore:
    @property
    def tracks_dir(self) -> str:
        path = settings.storage.tracks_dir
        os.makedirs(path, exist_ok=True)
        return path

    @property
    def incoming_dir(self) -> str:
        path = os.path.join(settings.storage.event_dir, "incoming")
        os.makedirs(path, exist_ok=True)
        return path

    @property
    def archive_dir(self) -> str:
        path = os.path.join(self.tracks_dir, ARCHIVE_DIRNAME)
        os.makedirs(path, exist_ok=True)
        return path

    # ------------------------------------------------------------------ naming
    @staticmethod
    def canonical_name(entry_id: str, sequence: Optional[int], performer: str, song: str, ext: str) -> str:
        seq_prefix = f"{sequence:02d}_" if sequence else ""
        return f"{seq_prefix}{entry_id}_{sanitize_filename(performer)}_{sanitize_filename(song)}{ext}"

    @staticmethod
    def _tokens(filename: str) -> List[str]:
        return os.path.splitext(filename)[0].split("_")

    # ------------------------------------------------------------------ lookup
    def scan(self) -> Dict[str, str]:
        """Maps entry id -> newest matching file path in tracks/ (archive excluded)."""
        found: Dict[str, str] = {}
        try:
            names = os.listdir(self.tracks_dir)
        except OSError:
            return found
        for name in names:
            path = os.path.join(self.tracks_dir, name)
            if name.startswith(".") or not os.path.isfile(path):
                continue
            if os.path.splitext(name)[1].lower() not in MEDIA_EXTS or os.path.getsize(path) == 0:
                continue
            for token in self._tokens(name):
                if re.fullmatch(r"[A-Za-z0-9]+-\d+", token):
                    prev = found.get(token)
                    if prev is None or os.path.getmtime(path) > os.path.getmtime(prev):
                        found[token] = path
        return found

    def find(self, entry_id: str) -> Optional[str]:
        safe = "".join(c for c in (entry_id or "") if c.isalnum() or c in ("-", "_"))
        if not safe:
            return None
        best = None
        try:
            names = os.listdir(self.tracks_dir)
        except OSError:
            return None
        for name in names:
            path = os.path.join(self.tracks_dir, name)
            if name.startswith(".") or not os.path.isfile(path):
                continue
            if os.path.splitext(name)[1].lower() not in MEDIA_EXTS or os.path.getsize(path) == 0:
                continue
            if safe in self._tokens(name) and (best is None or os.path.getmtime(path) > os.path.getmtime(best)):
                best = path
        return best

    # ------------------------------------------------------------------ writes
    def _archive_path(self, path: str) -> str:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        base, ext = os.path.splitext(os.path.basename(path))
        return os.path.join(self.archive_dir, f"{base}_archived_{stamp}{ext}")

    def archive_existing(self, entry_id: str) -> List[str]:
        """Moves every current track of an entry into tracks/_archive/ (never deletes)."""
        safe = "".join(c for c in (entry_id or "") if c.isalnum() or c in ("-", "_"))
        archived = []
        for name in os.listdir(self.tracks_dir):
            path = os.path.join(self.tracks_dir, name)
            if os.path.isfile(path) and safe and safe in self._tokens(name) and os.path.splitext(name)[1].lower() in MEDIA_EXTS:
                dest = self._archive_path(path)
                shutil.move(path, dest)
                archived.append(dest)
                logger.info("Archived %s -> %s", path, dest)
        return archived

    def save(self, entry_id: str, src_path: str, filename: str, move: bool = True) -> str:
        """Places a finished file in tracks/ atomically; any previous version is archived first."""
        self.archive_existing(entry_id)
        dest = os.path.join(self.tracks_dir, filename)
        tmp = dest + ".part"
        shutil.copyfile(src_path, tmp)
        os.replace(tmp, dest)
        if move and os.path.abspath(src_path) != os.path.abspath(dest):
            try:
                os.remove(src_path)
            except OSError:
                pass
        return dest

    def rename_to(self, entry_id: str, filename: str) -> Optional[str]:
        """Renames the entry's current file to the canonical (sequence-prefixed) name."""
        current = self.find(entry_id)
        if not current:
            return None
        dest = os.path.join(self.tracks_dir, filename)
        if os.path.abspath(current) == os.path.abspath(dest):
            return current
        os.replace(current, dest)
        return dest

    def adopt_incoming(self, known_entry_ids: List[str]) -> List[str]:
        """Moves files dropped into incoming/ whose name carries a known entry id into tracks/."""
        adopted = []
        known = set(known_entry_ids)
        try:
            names = os.listdir(self.incoming_dir)
        except OSError:
            return adopted
        for name in names:
            path = os.path.join(self.incoming_dir, name)
            if name.startswith(".") or not os.path.isfile(path) or os.path.splitext(name)[1].lower() not in MEDIA_EXTS:
                continue
            if name.endswith(".part") or os.path.getsize(path) == 0:
                continue
            # skip files still being written (modified in the last 3 seconds)
            if datetime.now().timestamp() - os.path.getmtime(path) < 3:
                continue
            entry = next((t for t in self._tokens(name) if t in known), None)
            if not entry:
                continue
            adopted.append(self.save(entry, path, name))
            logger.info("Adopted incoming file %s for %s", name, entry)
        return adopted


track_store = TrackStore()
