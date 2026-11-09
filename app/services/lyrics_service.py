import os
import re
import shutil
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any

from app.config import settings
from app.services.track_store import ARCHIVE_DIRNAME, sanitize_filename

logger = logging.getLogger("lyrics-service")

TIME_TAG_REGEX = re.compile(r"\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]")
HEADER_TAG_REGEX = re.compile(r"\[[a-zA-Z]+:[^\]]*\]")


def parse_lrc(content: str) -> Dict[str, Any]:
    """Parse LRC content into timed lines or mark untimed plain text."""
    raw = content or ""
    timed_lines: List[Dict[str, Any]] = []

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        # Find all timestamp tags in the line (a line may have multiple tags: [00:10.00][00:20.00] Chorus)
        tags = TIME_TAG_REGEX.findall(line)
        if tags:
            # Strip tags to get clean lyric text
            text = TIME_TAG_REGEX.sub("", line).strip()
            # Also strip any leftover header tags if any
            text = HEADER_TAG_REGEX.sub("", text).strip()
            for mm, ss in tags:
                seconds = round(int(mm) * 60 + float(ss), 3)
                timed_lines.append({"time": seconds, "text": text})

    if timed_lines:
        timed_lines.sort(key=lambda x: x["time"])
        return {
            "is_timed": True,
            "lines": timed_lines,
            "raw": raw
        }

    return {
        "is_timed": False,
        "lines": [],
        "raw": raw
    }


class LyricsService:
    @property
    def tracks_dir(self) -> str:
        path = settings.storage.tracks_dir
        os.makedirs(path, exist_ok=True)
        return path

    @property
    def archive_dir(self) -> str:
        path = os.path.join(self.tracks_dir, ARCHIVE_DIRNAME)
        os.makedirs(path, exist_ok=True)
        return path

    @staticmethod
    def _tokens(filename: str) -> List[str]:
        return os.path.splitext(filename)[0].split("_")

    def find_lyrics_file(self, entry_id: str) -> Optional[str]:
        safe = "".join(c for c in (entry_id or "") if c.isalnum() or c in ("-", "_"))
        if not safe:
            return None
        try:
            names = os.listdir(self.tracks_dir)
        except OSError:
            return None
        best = None
        for name in names:
            if name.startswith(".") or not name.lower().endswith(".lrc"):
                continue
            path = os.path.join(self.tracks_dir, name)
            if not os.path.isfile(path) or os.path.getsize(path) == 0:
                continue
            if safe in self._tokens(name) and (best is None or os.path.getmtime(path) > os.path.getmtime(best)):
                best = path
        return best

    def get_lyrics(self, entry_id: str) -> Dict[str, Any]:
        path = self.find_lyrics_file(entry_id)
        if not path:
            return {
                "has_lyrics": False,
                "entry_id": entry_id,
                "is_timed": False,
                "lines": [],
                "raw": ""
            }
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            parsed = parse_lrc(content)
            return {
                "has_lyrics": True,
                "entry_id": entry_id,
                "is_timed": parsed["is_timed"],
                "lines": parsed["lines"],
                "raw": parsed["raw"],
                "filename": os.path.basename(path)
            }
        except Exception as e:
            logger.warning("Error reading lyrics for %s: %s", entry_id, e)
            return {
                "has_lyrics": False,
                "entry_id": entry_id,
                "is_timed": False,
                "lines": [],
                "raw": ""
            }

    def _archive_lyrics(self, entry_id: str) -> List[str]:
        safe = "".join(c for c in (entry_id or "") if c.isalnum() or c in ("-", "_"))
        if not safe:
            return []
        archived = []
        try:
            names = os.listdir(self.tracks_dir)
        except OSError:
            return []
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        for name in names:
            if name.startswith(".") or not name.lower().endswith(".lrc"):
                continue
            path = os.path.join(self.tracks_dir, name)
            if os.path.isfile(path) and safe in self._tokens(name):
                base = os.path.splitext(name)[0]
                dest = os.path.join(self.archive_dir, f"{base}_archived_{stamp}.lrc")
                counter = 1
                while os.path.exists(dest):
                    dest = os.path.join(self.archive_dir, f"{base}_archived_{stamp}-{counter}.lrc")
                    counter += 1
                shutil.move(path, dest)
                archived.append(dest)
        return archived

    def save_lyrics(self, entry_id: str, content: str) -> Dict[str, Any]:
        safe = "".join(c for c in (entry_id or "") if c.isalnum() or c in ("-", "_"))
        if not safe:
            raise ValueError("Invalid entry_id")

        self._archive_lyrics(safe)

        # Look for matching track name so .lrc matches the track name if possible
        track_name = None
        try:
            for name in os.listdir(self.tracks_dir):
                if safe in self._tokens(name) and not name.lower().endswith(".lrc") and not name.startswith("."):
                    track_name = os.path.splitext(name)[0]
                    break
        except OSError:
            pass

        filename = f"{track_name or safe}.lrc"
        dest = os.path.join(self.tracks_dir, filename)
        tmp = dest + ".part"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(content or "")
        os.replace(tmp, dest)
        return self.get_lyrics(safe)

    def delete_lyrics(self, entry_id: str) -> bool:
        archived = self._archive_lyrics(entry_id)
        return bool(archived)


lyrics_service = LyricsService()
