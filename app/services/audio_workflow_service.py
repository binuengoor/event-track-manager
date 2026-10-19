import os
import json
import shutil
import logging
import asyncio
from typing import Optional, Dict, Any

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

logger = logging.getLogger("audio-workflow-service")


class AudioWorkflowService:
    """Orchestrates track ingestion, validation, transcoding, and external synchronization."""

    @staticmethod
    def max_upload_bytes(is_video: bool) -> int:
        max_mb = 500 if is_video else max(settings.storage.max_upload_size_mb, 200)
        return max_mb * 1024 * 1024

    async def process_track_upload(
        self,
        entry_id: str,
        submission_type: str = "file",
        youtube_url: Optional[str] = None,
        file_content: Optional[bytes] = None,
        original_filename: Optional[str] = None,
        media_type: str = "audio",
        file_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Validates, transcodes, verifies, and synchronizes a backing track (audio or video) for a performance."""
        if not bool(get_setting("track_upload_enabled", getattr(settings.signup, "track_upload_enabled", True))):
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
                raise FileTooLargeError(f"File exceeds maximum allowed size of {max_bytes // (1024 * 1024)}MB")

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

        # 3. Store in the event folder (previous version is archived) and update the database
        try:
            stored_path = await asyncio.to_thread(track_store.save, entry_id, cache_path, canonical_filename)
        except Exception as e:
            logger.error("Failed to store track for %s: %s", entry_id, e)
            raise ExternalServiceError("Failed to save the track in the event folder")

        event_service.update_track_metadata(
            entry_id,
            os.path.basename(stored_path),
            status="Uploaded",
            duration_str=duration_str,
            media_type="video" if is_video else "audio",
        )

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
                source="upload"
            )

        return {
            "status": "success",
            "entry_id": entry_id,
            "performer_name": target_entry.performer_name,
            "song_title": target_entry.song_title,
            "filename": canonical_filename,
            "media_type": track_type_label,
            "duration": duration_str,
            "message": f"Successfully uploaded and queued '{canonical_filename}' for playback."
        }

    def _verify_audio(self, cache_path: str) -> str:
        """Verifies that the generated audio/video file is playable and returns its duration as mm:ss."""
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
            return f"{sec // 60:02d}:{sec % 60:02d}"
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
