import os
import re
import io
import zipfile
import logging
from datetime import datetime
from typing import Optional, Generator, Tuple
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.config import settings
from app.services.google_service import google_service, PerformanceEntry

logger = logging.getLogger("audio-service")

def sanitize_filename(text: str) -> str:
    cleaned = re.sub(r'[^\w\s-]', '', text).strip()
    return re.sub(r'[-\s]+', '_', cleaned)

class AudioService:
    def __init__(self):
        self.cache_dir = settings.storage.cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)

    def get_cache_path(self, entry_id: str) -> str:
        safe_id = sanitize_filename(entry_id)
        return os.path.join(self.cache_dir, f"{safe_id}.mp3")

    def save_upload_to_cache(self, entry_id: str, content: bytes) -> str:
        cache_path = self.get_cache_path(entry_id)
        with open(cache_path, "wb") as f:
            f.write(content)
        return cache_path

    def purge_cache(self, entry_id: str) -> bool:
        cache_path = self.get_cache_path(entry_id)
        if os.path.isfile(cache_path):
            try:
                os.remove(cache_path)
                logger.info("Purged local audio cache for %s", entry_id)
                return True
            except Exception as e:
                logger.warning("Error purging cache for %s: %s", entry_id, e)
        return False

    def ensure_local_cache(self, entry_id: str, drive_file_id: Optional[str] = None) -> Optional[str]:
        cache_path = self.get_cache_path(entry_id)

        # If no drive_file_id and not mock mode, the file was deleted from Drive: purge cache!
        if not drive_file_id and not settings.mock_google_api:
            self.purge_cache(entry_id)
            return None

        if os.path.isfile(cache_path) and os.path.getsize(cache_path) > 0:
            return cache_path

        # If not cached locally, attempt to download from Google Drive
        if drive_file_id:
            logger.info("Cache miss for %s. Downloading from Google Drive (file_id: %s)...", entry_id, drive_file_id)
            audio_bytes = google_service.download_file_bytes(drive_file_id)
            if audio_bytes:
                with open(cache_path, "wb") as f:
                    f.write(audio_bytes)
                logger.info("Cached %d bytes to %s", len(audio_bytes), cache_path)
                return cache_path

        # If in mock mode or file doesn't exist, create a tiny silent MP3 placeholder if needed
        if settings.mock_google_api and not os.path.isfile(cache_path):
            self._create_mock_mp3(cache_path)
            return cache_path

        return None

    def get_track_metadata(self, entry_id: str, drive_file_id: Optional[str], canonical_name: str) -> dict:
        cache_path = self.ensure_local_cache(entry_id, drive_file_id)
        if not cache_path or not os.path.isfile(cache_path):
            return {"exists": False}

        size_bytes = os.path.getsize(cache_path)
        duration_sec = None

        try:
            from mutagen import File as MutagenFile
            audio = MutagenFile(cache_path)
            if audio and audio.info and hasattr(audio.info, "length"):
                duration_sec = round(audio.info.length, 1)
        except Exception as e:
            logger.warning("Could not read audio duration for %s: %s", entry_id, e)

        def fmt_duration(sec: Optional[float]) -> str:
            if not sec:
                return "Unknown"
            m = int(sec // 60)
            s = int(sec % 60)
            return f"{m}:{s:02d}"

        def fmt_size(b: int) -> str:
            val = float(b)
            for unit in ['B', 'KB', 'MB', 'GB']:
                if val < 1024.0:
                    return f"{val:.1f} {unit}"
                val /= 1024.0
            return f"{val:.1f} GB"

        return {
            "exists": True,
            "filename": canonical_name,
            "size_bytes": size_bytes,
            "size_formatted": fmt_size(size_bytes),
            "duration_seconds": duration_sec,
            "duration_formatted": fmt_duration(duration_sec),
            "stream_url": f"/api/stream/{entry_id}"
        }

    def _create_mock_mp3(self, path: str):
        # 1-second silent MP3 binary frame for mock mode playback testing
        silent_mp3_header = bytes([
            0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ] * 64)
        with open(path, "wb") as f:
            f.write(silent_mp3_header)

    def stream_file_range(self, filepath: str, range_header: Optional[str]) -> StreamingResponse:
        if not os.path.isfile(filepath):
            raise HTTPException(status_code=404, detail="Audio file not found on server")

        file_size = os.path.getsize(filepath)
        start = 0
        end = file_size - 1

        if range_header:
            match = re.match(r"bytes=(\d+)-(\d*)", range_header.strip())
            if match:
                start = int(match.group(1))
                if match.group(2):
                    end = int(match.group(2))

        if start >= file_size or end >= file_size or start > end:
            raise HTTPException(
                status_code=416,
                detail="Requested Range Not Satisfiable",
                headers={"Content-Range": f"bytes */{file_size}"}
            )

        chunk_size = end - start + 1

        def file_iterator() -> Generator[bytes, None, None]:
            with open(filepath, "rb") as f:
                f.seek(start)
                bytes_remaining = chunk_size
                while bytes_remaining > 0:
                    read_len = min(65536, bytes_remaining)
                    chunk = f.read(read_len)
                    if not chunk:
                        break
                    bytes_remaining -= len(chunk)
                    yield chunk

        status_code = 206 if range_header else 200
        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=3600"
        }

        return StreamingResponse(file_iterator(), status_code=status_code, headers=headers)

    def export_sequenced_zip(self) -> Tuple[io.BytesIO, str]:
        queue = google_service.get_stage_queue()
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            manifest_lines = [
                f"EMA Paattukoottam - Live Stage Sequence",
                f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                "=" * 50,
                ""
            ]

            for item in queue:
                seq_num = f"{item.sequence_order:02d}" if item.sequence_order is not None else "XX"
                singer_clean = sanitize_filename(item.performer_name)
                song_clean = sanitize_filename(item.song_title)

                line = f"#{seq_num} | {item.performer_name} | {item.song_title} ({item.performance_type}) - Status: {item.track_status}"
                manifest_lines.append(line)

                # Skip if acoustic or no track
                if item.track_status in ("Acoustic", "Pending") and not item.drive_file_id:
                    continue

                cache_file = self.ensure_local_cache(item.entry_id, item.drive_file_id)
                if cache_file and os.path.isfile(cache_file):
                    zip_entry_name = f"{seq_num}_{singer_clean}_{song_clean}.mp3"
                    zf.write(cache_file, arcname=zip_entry_name)

            zf.writestr("00_SEQUENCE_MANIFEST.txt", "\n".join(manifest_lines))

        zip_buffer.seek(0)
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M")
        zip_filename = f"Paattukoottam_Stage_Tracks_{timestamp_str}.zip"
        return zip_buffer, zip_filename

audio_service = AudioService()
