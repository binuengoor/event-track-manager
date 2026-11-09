import os
import json
import shutil
import subprocess
import logging
import asyncio
import threading
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any

from app.features import feature_enabled
from app.config import settings, get_setting
from app.exceptions import (
    UploadDisabledError,
    PerformanceNotFoundError,
    MissingSongTitleError,
    FileTooLargeError,
    InvalidAudioError,
    ExternalServiceError,
)
from app.services.event_service import event_service
from app.services.audio_service import audio_service
from app.services.track_store import track_store
from app.services.downloader_client import downloader_client
from app.services.db_service import db_service, is_placeholder_song_title
from app.services.backup_service import backup_service
from app.services.loudness_service import loudness_service

logger = logging.getLogger("audio-workflow-service")


class _VerifiedDuration(str):
    """Display-compatible duration carrying precise ffprobe seconds for API checks."""
    def __new__(cls, display: str, duration_s: float):
        value = str.__new__(cls, display)
        value.duration_s = duration_s
        return value


class AudioWorkflowService:
    """Orchestrates track ingestion, validation, transcoding, and external synchronization."""

    @staticmethod
    def too_large_message(limit_bytes: int) -> str:
        return (f"File exceeds maximum allowed size of {limit_bytes // (1024 * 1024)}MB. "
                "Please compress or trim the file (for video, lower the resolution) and try again.")

    AUDIO_EXTENSIONS = ("mp3", "wav", "m4a")
    VIDEO_EXTENSIONS = ("mp4", "webm")
    ALLOWED_EXTENSIONS = AUDIO_EXTENSIONS + VIDEO_EXTENSIONS

    def __init__(self):
        self._entry_locks = {}
        self._entry_locks_guard = threading.Lock()

    async def run_thread_to_completion(self, function, *args, **kwargs):
        """Keep callers' locks held until thread work ends, even after request cancellation."""
        work = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
        was_cancelled = False
        while not work.done():
            try:
                await asyncio.shield(work)
            except asyncio.CancelledError:
                was_cancelled = True
                current = asyncio.current_task()
                if current is not None:
                    current.uncancel()
        try:
            result = work.result()
        except BaseException:
            if was_cancelled:
                raise asyncio.CancelledError
            raise
        if was_cancelled:
            raise asyncio.CancelledError
        return result

    @asynccontextmanager
    async def lock_entry(self, entry_id: str):
        """Serialize track mutations without blocking an ASGI event loop while waiting."""
        with self._entry_locks_guard:
            record = self._entry_locks.get(entry_id)
            if record is None:
                record = {"lock": threading.Lock(), "users": 0}
                self._entry_locks[entry_id] = record
            record["users"] += 1
        lock = record["lock"]
        acquired = False
        try:
            while not lock.acquire(blocking=False):
                await asyncio.sleep(0.01)
            acquired = True
            yield
        finally:
            if acquired:
                lock.release()
            with self._entry_locks_guard:
                record["users"] -= 1
                if record["users"] == 0 and self._entry_locks.get(entry_id) is record:
                    del self._entry_locks[entry_id]

    @staticmethod
    def upload_limit_mb(is_video: bool) -> int:
        key, default = ("max_video_upload_mb", 500) if is_video else ("max_audio_upload_mb", 200)
        try:
            value = int(get_setting(key, default))
        except (TypeError, ValueError):
            value = default
        return value if value > 0 else default

    @classmethod
    def max_upload_bytes(cls, is_video: bool) -> int:
        return cls.upload_limit_mb(is_video) * 1024 * 1024

    @classmethod
    def check_extension(cls, filename: Optional[str], is_video: bool) -> None:
        """Rejects files whose extension is not an accepted audio/video type (plain-language 400 message)."""
        ext = os.path.splitext(filename or "")[1].lower().lstrip(".")
        wanted = cls.VIDEO_EXTENSIONS if is_video else cls.AUDIO_EXTENSIONS
        if ext not in wanted:
            kind = "Video" if is_video else "Audio"
            raise InvalidAudioError(
                f"{kind} files must be {', '.join('.' + e for e in wanted)}. "
                f"This file ({'.' + ext if ext else 'no extension'}) is not supported."
            )

    async def process_track_upload(
        self,
        entry_id: str,
        submission_type: str = "file",
        youtube_url: Optional[str] = None,
        file_content: Optional[bytes] = None,
        original_filename: Optional[str] = None,
        media_type: str = "audio",
        file_path: Optional[str] = None,
        audit_source: str = "upload",
        audit_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        async with self.lock_entry(entry_id):
            return await self._process_track_upload_locked(
                entry_id=entry_id, submission_type=submission_type, youtube_url=youtube_url,
                file_content=file_content, original_filename=original_filename, media_type=media_type,
                file_path=file_path, audit_source=audit_source, audit_role=audit_role,
            )

    async def _process_track_upload_locked(
        self,
        entry_id: str,
        submission_type: str = "file",
        youtube_url: Optional[str] = None,
        file_content: Optional[bytes] = None,
        original_filename: Optional[str] = None,
        media_type: str = "audio",
        file_path: Optional[str] = None,
        audit_source: str = "upload",
        audit_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Validates, transcodes, verifies, and synchronizes a backing track (audio or video) for a performance."""
        if not feature_enabled("track_upload_enabled"):
            raise UploadDisabledError("Backing track uploads are currently disabled for this event.")

        allowed = get_setting("allowed_media", ["audio", "video"])
        if isinstance(allowed, str):
            allowed = [allowed]
        wanted = (media_type or "audio").strip().lower()
        if wanted not in allowed:
            raise UploadDisabledError(f"This event accepts {' and '.join(allowed)} tracks only.")

        row = db_service.get_performance(entry_id)
        if not row:
            raise PerformanceNotFoundError(f"Performance entry {entry_id} not found")
        from app.schemas import PerformanceEntry
        target_entry = PerformanceEntry(**row)

        if target_entry.is_song_name_missing or is_placeholder_song_title(target_entry.song_title):
            raise MissingSongTitleError(
                "Song title is missing. Please specify your song title before uploading a backing track."
            )

        is_video = (media_type or "").strip().lower() == "video"
        ext = ".mp4" if is_video else ".mp3"
        mime_type = "video/mp4" if is_video else "audio/mpeg"

        canonical_filename = track_store.canonical_name(
            entry_id, target_entry.sequence_order, target_entry.performer_name, target_entry.song_title, ext
        )

        # Work in the scratch dir; the finished file is moved into the event folder only after verification,
        # so a failed upload never destroys the previous track.
        cache_path = audio_service.get_cache_path(entry_id, ext=ext)
        for scratch in (cache_path, cache_path + ".upload"):
            if os.path.isfile(scratch):
                os.remove(scratch)

        # 1. Process Media Input
        if submission_type == "youtube":
            if not youtube_url or not youtube_url.strip():
                raise ValueError("YouTube URL is required")

            logger.info("Extracting YouTube %s for %s: %s", "video" if is_video else "audio", entry_id, youtube_url)
            try:
                extract_res = await downloader_client.extract_audio(
                    youtube_url.strip(), entry_id, media_type="video" if is_video else "audio"
                )
            except Exception as e:
                logger.error("Downloader extraction failed for %s: %s", entry_id, e)
                raise ExternalServiceError(str(e))

            dl_path = extract_res.get("file_path")
            if dl_path and os.path.isfile(dl_path) and dl_path != cache_path:
                shutil.copyfile(dl_path, cache_path)
            elif not os.path.isfile(cache_path):
                alt_name = entry_id.replace("-", "_") if "-" in entry_id else entry_id.replace("_", "-")
                alt_path = os.path.join(audio_service.cache_dir, f"{alt_name}{ext}")
                if os.path.isfile(alt_path):
                    shutil.copyfile(alt_path, cache_path)

        elif submission_type == "file":
            if not file_content and not file_path:
                raise ValueError(f"{'Video' if is_video else 'Audio'} file is required for direct upload")

            max_bytes = self.max_upload_bytes(is_video)
            size = os.path.getsize(file_path) if file_path else len(file_content)
            if size > max_bytes:
                if file_path and os.path.exists(file_path):
                    os.remove(file_path)
                raise FileTooLargeError(self.too_large_message(max_bytes))

            raw_upload_path = cache_path + ".upload"
            if file_path:
                os.replace(file_path, raw_upload_path)      # the router already streamed it to disk (no big RAM copy)
            else:
                with open(raw_upload_path, "wb") as f:
                    f.write(file_content)

            if is_video:
                transcoded = await audio_service.async_transcode_video_to_720p(raw_upload_path, cache_path)
            else:
                bitrate = getattr(settings, "audio_bitrate", "320k")
                transcoded = await audio_service.async_transcode_to_standard_mp3(raw_upload_path, cache_path, bitrate=bitrate)
            if not transcoded and not os.path.exists(cache_path):
                shutil.copyfile(raw_upload_path, cache_path)   # keep the original if conversion was not possible

            if os.path.exists(raw_upload_path):
                try:
                    os.remove(raw_upload_path)
                except Exception:
                    pass
        else:
            raise ValueError(f"Unsupported submission_type: {submission_type}")

        # 2. Audio/Video Verification
        duration_str = self._verify_audio(cache_path)
        duration_s = getattr(duration_str, "duration_s", None)
        if duration_s is None:
            try:
                duration_s = float(sum(int(part) * (60 ** i) for i, part in enumerate(reversed(str(duration_str).split(":")))))
            except (TypeError, ValueError):
                duration_s = 0.0

        # 3. Store in the event folder (previous version is archived) and update the database
        try:
            stored_path = await self.run_thread_to_completion(
                self._save_track_and_update_metadata, entry_id, cache_path, canonical_filename,
                duration_str, "video" if is_video else "audio")
        except Exception as e:
            logger.error("Failed to store track for %s: %s", entry_id, e)
            raise ExternalServiceError("Failed to save the track in the event folder")

        loudness_service.record_verification(entry_id, stored_path, duration_s)
        loudness_service.schedule(entry_id, stored_path)
        loudness = loudness_service.cached(entry_id, stored_path) or {}

        backup_service.trigger_backup()
        try:
            audio_service.prune_cache_if_needed()
        except Exception:
            pass

        track_type_label = "video" if is_video else "audio"
        if submission_type == "youtube":
            db_service.log_activity(
                action_type="track_upload",
                performer_name=target_entry.performer_name,
                entry_id=entry_id,
                summary=f"Downloaded {track_type_label} track from YouTube for {entry_id} ('{target_entry.song_title}')",
                details=json.dumps({"youtube_url": youtube_url, "duration": duration_str, "media_type": track_type_label}),
                source="youtube"
            )
        else:
            upload_name = original_filename or canonical_filename
            db_service.log_activity(
                action_type="track_upload",
                performer_name=target_entry.performer_name,
                entry_id=entry_id,
                summary=f"Uploaded {track_type_label} track file '{canonical_filename}' for {entry_id} ('{target_entry.song_title}')",
                details=json.dumps({"filename": upload_name, "duration": duration_str, "media_type": track_type_label}),
                source=audit_source,
                role=audit_role,
            )

        return {
            "status": "success",
            "entry_id": entry_id,
            "performer_name": target_entry.performer_name,
            "song_title": target_entry.song_title,
            "filename": canonical_filename,
            "media_type": track_type_label,
            "duration": duration_str,
            "checks": {
                "duration_s": round(float(duration_s), 3),
                "loudness_lufs": loudness.get("loudness_lufs"),
                "gain_db": loudness.get("gain_db"),
                "format_ok": True,
            },
            "message": f"Successfully uploaded and queued '{canonical_filename}' for playback."
        }

    @staticmethod
    def _save_track_and_update_metadata(entry_id: str, cache_path: str, canonical_filename: str,
                                        duration_str: str, media_type: str) -> str:
        """Keep the filesystem install and its database metadata in one uncancellable worker section."""
        stored_path = track_store.save(entry_id, cache_path, canonical_filename)
        event_service.update_track_metadata(
            entry_id, os.path.basename(stored_path), status="Uploaded",
            duration_str=duration_str, media_type=media_type,
        )
        return stored_path

    def _ffprobe_duration(self, path: str) -> Optional[float]:
        """Asks ffprobe for the real duration. Raises InvalidAudioError when there is no playable stream or the
        duration is not positive. Returns None (after logging) when ffprobe is unavailable, so dev machines still work."""
        if not shutil.which("ffprobe"):
            logger.warning("ffprobe not found; skipping stream validation for %s", os.path.basename(path))
            return None
        try:
            proc = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
                 "-of", "json", path],
                capture_output=True, text=True, timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as ex:
            logger.warning("ffprobe could not be run for %s: %s", os.path.basename(path), ex)
            return None
        if proc.returncode != 0:
            raise InvalidAudioError("Invalid media file: it could not be read as audio or video. Please upload a standard MP3, M4A, WAV or MP4 file.")
        try:
            info = json.loads(proc.stdout or "{}")
        except ValueError:
            logger.warning("ffprobe returned unreadable output for %s", os.path.basename(path))
            return None
        if not any(s.get("codec_type") in ("audio", "video") for s in info.get("streams", [])):
            raise InvalidAudioError("Invalid media file: no playable audio or video stream found.")
        try:
            duration = float((info.get("format") or {}).get("duration") or 0)
        except (TypeError, ValueError):
            duration = 0.0
        if duration <= 0:
            raise InvalidAudioError("Unplayable media file: its duration is 0 seconds or corrupted.")
        return duration

    def _verify_audio(self, cache_path: str) -> str:
        """Verifies that the generated audio/video file is playable and returns its duration as mm:ss."""
        display, duration_s = self._verify_audio_details(cache_path)
        return _VerifiedDuration(display, duration_s)

    def _verify_audio_details(self, cache_path: str) -> tuple[str, float]:
        """Verify playable media and return display duration plus precise seconds."""
        try:
            probed_duration = self._ffprobe_duration(cache_path)
        except InvalidAudioError:
            self._discard(cache_path)
            raise
        try:
            from mutagen import File as MutagenFile
            audio = MutagenFile(cache_path)
            if audio is None or audio.info is None:
                self._discard(cache_path)
                raise InvalidAudioError(
                    "Invalid audio file: Unable to decode playable audio track. Please upload a standard MP3, M4A, or WAV file."
                )

            length = getattr(audio.info, "length", 0)
            if not length or length <= 0:
                self._discard(cache_path)
                raise InvalidAudioError("Unplayable audio file: Audio duration is 0 seconds or corrupted.")

            sec = int(length)
            duration_s = float(probed_duration if probed_duration and probed_duration > 0 else length)
            return f"{sec // 60:02d}:{sec % 60:02d}", duration_s
        except InvalidAudioError:
            raise
        except Exception as e:
            self._discard(cache_path)
            raise InvalidAudioError(f"Audio verification failed: {str(e)}.")

    @staticmethod
    def _discard(path: str):
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


audio_workflow_service = AudioWorkflowService()
