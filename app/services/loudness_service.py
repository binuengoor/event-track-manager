"""Loudness measurement (SPEC 6.9 "Loudness"): measure on ingest, store a gain, the console applies it at playback.

Originals are never touched. Facts live in ``<event_dir>/track_facts.json``, a cache the folder can always rebuild
(a missing or stale entry is simply measured again). Two-pass analysis: pass 1 of ffmpeg's ``loudnorm`` filter
reports integrated loudness (LUFS) and true peak, and we derive one static gain from them.
"""
import json
import logging
import os
import re
import subprocess
import threading
import time
from typing import Dict, Optional

from app.config import settings

logger = logging.getLogger("loudness-service")

TARGET_LUFS = -16.0        # typical for PA playback of mixed backing tracks
TRUE_PEAK_CEILING = -1.0   # dBTP; a boost never pushes the measured peak above this
MAX_BOOST_DB = 9.0
MAX_CUT_DB = -12.0
MEASURE_TIMEOUT_SECONDS = 300
FACTS_FILENAME = "track_facts.json"

_JSON_BLOCK = re.compile(r"\{[^{}]*\"input_i\"[^{}]*\}", re.S)


def compute_gain_db(lufs: float, true_peak: Optional[float]) -> float:
    """Gain (dB) that brings ``lufs`` to the target without clipping; 0.0 for silence/invalid readings."""
    if lufs is None or lufs != lufs or lufs <= -70.0:
        return 0.0
    gain = TARGET_LUFS - lufs
    if true_peak is not None and true_peak == true_peak:
        gain = min(gain, TRUE_PEAK_CEILING - true_peak)
    gain = max(MAX_CUT_DB, min(MAX_BOOST_DB, gain))
    return round(gain, 1)


def parse_loudnorm_output(stderr: str) -> Optional[Dict[str, float]]:
    """Pulls integrated loudness and true peak from ffmpeg's loudnorm JSON summary."""
    matches = _JSON_BLOCK.findall(stderr or "")
    if not matches:
        return None
    try:
        data = json.loads(matches[-1])
        lufs = float(data["input_i"])
        peak = float(data["input_tp"])
    except (ValueError, KeyError, TypeError):
        return None
    if lufs != lufs or lufs in (float("inf"), float("-inf")):
        lufs = -70.0
    return {"lufs": lufs, "true_peak": peak}


def measure_file(path: str) -> Optional[Dict[str, float]]:
    """Runs ffmpeg pass 1 on the audio of ``path`` (audio or video). None if ffmpeg is missing or fails."""
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-vn", "-af",
           f"loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK_CEILING}:LRA=11:print_format=json", "-f", "null", "-"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=MEASURE_TIMEOUT_SECONDS)
    except (OSError, subprocess.SubprocessError) as ex:
        logger.warning("Loudness measurement unavailable for %s: %s", os.path.basename(path), ex)
        return None
    if proc.returncode != 0:
        logger.warning("ffmpeg loudness pass failed for %s (exit %s)", os.path.basename(path), proc.returncode)
        return None
    return parse_loudnorm_output(proc.stderr)


class LoudnessService:
    def __init__(self):
        self._lock = threading.Lock()
        self._inflight: set = set()

    @property
    def facts_path(self) -> str:
        return os.path.join(settings.storage.event_dir, FACTS_FILENAME)

    @staticmethod
    def _event_dir_for_track(path: str) -> str:
        parent = os.path.dirname(os.path.abspath(path))
        if os.path.basename(parent).lower() == "tracks":
            return os.path.dirname(parent)
        return settings.storage.event_dir

    def _load(self, facts_path: Optional[str] = None) -> Dict[str, dict]:
        try:
            with open(facts_path or self.facts_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _store(self, facts: Dict[str, dict], facts_path: Optional[str] = None) -> None:
        target = facts_path or self.facts_path
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".part"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(facts, f, indent=1, sort_keys=True)
        os.replace(tmp, target)

    @staticmethod
    def _signature(path: str) -> Dict[str, int]:
        st = os.stat(path)
        return {"size": st.st_size, "mtime_ns": st.st_mtime_ns}

    def cached(self, entry_id: str, path: str) -> Optional[dict]:
        """The stored facts if they still describe the file at ``path``; otherwise None (never measures)."""
        facts_path = os.path.join(self._event_dir_for_track(path), FACTS_FILENAME)
        rec = self._load(facts_path).get(entry_id)
        if not rec:
            return None
        try:
            sig = self._signature(path)
        except OSError:
            return None
        if rec.get("size") != sig["size"] or rec.get("mtime_ns") != sig["mtime_ns"]:
            return None
        return rec

    def measure_and_store(self, entry_id: str, path: str, facts_path: Optional[str] = None) -> Optional[dict]:
        """Measures ``path`` now (blocking) and stores the result. Returns the record or None on failure."""
        try:
            source_signature = self._signature(path)
        except OSError:
            return None
        measured = measure_file(path)
        if not measured:
            return None
        try:
            if self._signature(path) != source_signature:
                return None
        except OSError:
            return None
        rec = {
            "file": os.path.basename(path),
            **source_signature,
            "loudness_lufs": round(measured["lufs"], 1),
            "true_peak_db": round(measured["true_peak"], 1),
            "gain_db": compute_gain_db(measured["lufs"], measured["true_peak"]),
            "target_lufs": TARGET_LUFS,
            "checked_at": int(time.time()),
        }
        with self._lock:
            target = facts_path or os.path.join(self._event_dir_for_track(path), FACTS_FILENAME)
            try:
                if self._signature(path) != source_signature:
                    return None
            except OSError:
                return None
            facts = self._load(target)
            previous = facts.get(entry_id) or {}
            if previous.get("size") == rec["size"] and previous.get("mtime_ns") == rec["mtime_ns"]:
                for key in ("duration_s", "format_ok"):
                    if key in previous:
                        rec[key] = previous[key]
            facts[entry_id] = rec
            self._store(facts, target)
        return rec

    def gain_db(self, entry_id: str, path: str) -> Optional[float]:
        rec = self.cached(entry_id, path)
        return rec["gain_db"] if rec else None

    def schedule(self, entry_id: str, path: str) -> bool:
        """Measures in a background thread (deduplicated per entry); the upload response never waits for it."""
        facts_path = os.path.join(self._event_dir_for_track(path), FACTS_FILENAME)
        work_key = (facts_path, entry_id)
        try:
            scheduled_signature = self._signature(path)
        except OSError:
            return False
        with self._lock:
            if work_key in self._inflight:
                return False
            self._inflight.add(work_key)

        def run():
            try:
                self.measure_and_store(entry_id, path, facts_path=facts_path)
            except Exception as ex:  # a failed measurement must never break an upload
                logger.warning("Loudness measurement failed for %s: %s", entry_id, ex)
            finally:
                changed = False
                try:
                    changed = self._signature(path) != scheduled_signature
                except OSError:
                    pass
                with self._lock:
                    self._inflight.discard(work_key)
                # If this file was replaced during measurement, the old result
                # was discarded. Queue a fresh measurement for the installed file.
                if changed:
                    self.schedule(entry_id, path)

        threading.Thread(target=run, name=f"loudness-{entry_id}", daemon=True).start()
        return True

    def record_verification(self, entry_id: str, path: str, duration_s: float) -> Optional[dict]:
        """Persist upload verification so My Entry can refresh while loudness runs asynchronously."""
        try:
            sig = self._signature(path)
        except OSError:
            return None
        facts_path = os.path.join(self._event_dir_for_track(path), FACTS_FILENAME)
        with self._lock:
            facts = self._load(facts_path)
            rec = {**sig, "duration_s": round(float(duration_s), 3), "format_ok": True}
            facts[entry_id] = rec
            self._store(facts, facts_path)
        return rec


loudness_service = LoudnessService()
