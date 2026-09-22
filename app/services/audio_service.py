import os
import re
import io
import zipfile
import logging
from datetime import datetime
from typing import Optional, Generator, Tuple

from app.exceptions import AudioNotFoundError, InvalidByteRangeError, AudioTranscodeError

from app.config import settings
from app.services.db_service import db_service
from app.services.google_service import google_service, PerformanceEntry

logger = logging.getLogger("audio-service")

def sanitize_filename(text: str) -> str:
    cleaned = re.sub(r'[^\w\s-]', '', text).strip()
    return re.sub(r'[-\s]+', '_', cleaned)

import time

class AudioService:
    def __init__(self):
        self.cache_dir = settings.storage.cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)

    def prune_cache_if_needed(self, max_size_mb: int = 2048, target_size_mb: int = 1536) -> int:
        """
        Evicts oldest cached files (LRU by mtime) if total cache exceeds max_size_mb,
        bringing it down to target_size_mb. Also cleans up orphan temporary transcode files.
        Returns the number of files deleted.
        """
        deleted_count = 0
        if not os.path.exists(self.cache_dir):
            return 0

        # 1. Clean up stale transcode / temp artifacts older than 1 hour
        now = time.time()
        for fname in os.listdir(self.cache_dir):
            if fname.endswith(".transcode.mp4") or "_temp." in fname or fname.endswith(".part"):
                fpath = os.path.join(self.cache_dir, fname)
                try:
                    if os.path.isfile(fpath) and (now - os.path.getmtime(fpath) > 3600):
                        os.remove(fpath)
                        deleted_count += 1
                except Exception:
                    pass

        # 2. Check total cache size
        files_with_stats = []
        total_bytes = 0
        for fname in os.listdir(self.cache_dir):
            fpath = os.path.join(self.cache_dir, fname)
            try:
                if os.path.isfile(fpath):
                    size = os.path.getsize(fpath)
                    mtime = os.path.getmtime(fpath)
                    total_bytes += size
                    files_with_stats.append((fpath, size, mtime))
            except Exception:
                pass

        max_bytes = max_size_mb * 1024 * 1024
        target_bytes = target_size_mb * 1024 * 1024

        if total_bytes > max_bytes:
            # Sort files by oldest mtime first
            files_with_stats.sort(key=lambda x: x[2])
            for fpath, size, _ in files_with_stats:
                try:
                    os.remove(fpath)
                    deleted_count += 1
                    total_bytes -= size
                    if total_bytes <= target_bytes:
                        break
                except Exception as ex:
                    logger.warning("Error pruning cache file %s: %s", fpath, ex)

        return deleted_count

    def get_cache_path(self, entry_id: str, ext: Optional[str] = None) -> str:
        safe_id = "".join(c for c in entry_id if c.isalnum() or c in ("-", "_")).strip()
        if ext:
            e = ext if ext.startswith(".") else f".{ext}"
            return os.path.join(self.cache_dir, f"{safe_id}{e}")
        # Default: if .mp4 exists in cache, return .mp4; else .mp3
        mp4_path = os.path.join(self.cache_dir, f"{safe_id}.mp4")
        if os.path.isfile(mp4_path):
            return mp4_path
        return os.path.join(self.cache_dir, f"{safe_id}.mp3")

    def get_media_type(self, entry_id: str) -> str:
        safe_id = "".join(c for c in entry_id if c.isalnum() or c in ("-", "_")).strip()
        mp4_path = os.path.join(self.cache_dir, f"{safe_id}.mp4")
        if os.path.isfile(mp4_path):
            return "video"
        return "audio"

    def save_upload_to_cache(self, entry_id: str, content: bytes, ext: str = ".mp3") -> str:
        self.prune_cache_if_needed()
        cache_path = self.get_cache_path(entry_id, ext=ext)
        with open(cache_path, "wb") as f:
            f.write(content)
        return cache_path

    async def async_transcode_video_to_720p(self, input_path: str, output_path: str) -> bool:
        """
        Transcodes video file to max 720p H.264 MP4 with untouched audio quality (-c:a copy).
        If audio copy fails due to container/codec incompatibility, falls back to pristine 320k AAC.
        """
        import asyncio
        tmp_output = output_path + ".transcode.mp4"
        try:
            # First attempt: -c:a copy to keep audio stream 100% untouched
            cmd = [
                "ffmpeg", "-y", "-i", input_path,
                "-vf", "scale='min(1280,iw)':-2",
                "-c:v", "libx264", "-crf", "23", "-preset", "fast",
                "-c:a", "copy",
                "-movflags", "+faststart",
                tmp_output
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                logger.warning("FFmpeg video transcoding timed out for %s", input_path)
                return False

            if proc.returncode == 0 and os.path.isfile(tmp_output) and os.path.getsize(tmp_output) > 0:
                if os.path.isfile(output_path):
                    os.remove(output_path)
                os.rename(tmp_output, output_path)
                logger.info("Successfully transcoded video %s to 720p MP4 (audio untouched) -> %s", input_path, output_path)
                return True

            logger.warning("FFmpeg video transcode with audio copy failed (%s). Retrying with 320k AAC transcode...", stderr.decode(errors="ignore"))

            # Fallback attempt: re-encode audio to high quality 320k AAC
            cmd_fallback = [
                "ffmpeg", "-y", "-i", input_path,
                "-vf", "scale='min(1280,iw)':-2",
                "-c:v", "libx264", "-crf", "23", "-preset", "fast",
                "-c:a", "aac", "-b:a", "320k",
                "-movflags", "+faststart",
                tmp_output
            ]
            proc_fb = await asyncio.create_subprocess_exec(
                *cmd_fallback,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc_fb.communicate(), timeout=300.0)
            except asyncio.TimeoutError:
                proc_fb.kill()
                await proc_fb.communicate()
                logger.warning("FFmpeg fallback video transcoding timed out for %s", input_path)
                return False

            if proc_fb.returncode == 0 and os.path.isfile(tmp_output) and os.path.getsize(tmp_output) > 0:
                if os.path.isfile(output_path):
                    os.remove(output_path)
                os.rename(tmp_output, output_path)
                logger.info("Successfully transcoded video %s with 320k AAC to 720p MP4 -> %s", input_path, output_path)
                return True
            else:
                logger.warning("FFmpeg fallback video transcode failed: %s", stderr.decode(errors="ignore"))
        except Exception as e:
            logger.warning("FFmpeg video transcoding exception: %s", e)
        finally:
            if os.path.isfile(tmp_output):
                try:
                    os.remove(tmp_output)
                except Exception:
                    pass
        return False

    async def async_transcode_to_standard_mp3(self, input_path: str, output_path: str, bitrate: str = "320k") -> bool:
        """
        Asynchronously uses ffmpeg to transcode audio without blocking the event loop.
        """
        import asyncio
        tmp_output = output_path + ".transcode.mp3"
        try:
            cmd = [
                "ffmpeg", "-y", "-i", input_path,
                "-vn", "-acodec", "libmp3lame",
                "-b:a", bitrate, "-ar", "44100",
                tmp_output
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=45.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                logger.warning("FFmpeg transcoding timed out for %s", input_path)
                return False

            if proc.returncode == 0 and os.path.isfile(tmp_output) and os.path.getsize(tmp_output) > 0:
                if os.path.isfile(output_path):
                    os.remove(output_path)
                os.rename(tmp_output, output_path)
                logger.info("Successfully transcoded %s to %s MP3 (%s)", input_path, bitrate, output_path)
                return True
            else:
                logger.warning("FFmpeg transcode non-zero exit: %s", stderr.decode(errors="ignore"))
        except Exception as e:
            logger.warning("FFmpeg transcoding exception: %s", e)
        finally:
            if os.path.isfile(tmp_output):
                try:
                    os.remove(tmp_output)
                except Exception:
                    pass
        return False

    def transcode_to_standard_mp3(self, input_path: str, output_path: str, bitrate: str = "320k") -> bool:
        """
        Uses ffmpeg to transcode any audio format (.m4a, .aac, .wav, .caf, .ogg, etc.)
        into a pristine, high-fidelity 320kbps MP3 (44100Hz stereo).
        """
        import subprocess
        tmp_output = output_path + ".transcode.mp3"
        try:
            cmd = [
                "ffmpeg", "-y", "-i", input_path,
                "-vn", "-acodec", "libmp3lame",
                "-b:a", bitrate, "-ar", "44100",
                tmp_output
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
            if res.returncode == 0 and os.path.isfile(tmp_output) and os.path.getsize(tmp_output) > 0:
                if os.path.isfile(output_path):
                    os.remove(output_path)
                os.rename(tmp_output, output_path)
                logger.info("Successfully transcoded %s to %s MP3 (%s)", input_path, bitrate, output_path)
                return True
            else:
                logger.warning("FFmpeg transcode non-zero exit: %s", res.stderr.decode(errors="ignore"))
        except Exception as e:
            logger.warning("FFmpeg transcoding exception: %s", e)
        finally:
            if os.path.isfile(tmp_output):
                try:
                    os.remove(tmp_output)
                except Exception:
                    pass
        return False

    def purge_cache(self, entry_id: str) -> bool:
        safe_id = "".join(c for c in entry_id if c.isalnum() or c in ("-", "_")).strip()
        variations = {
            f"{safe_id}.mp3",
            f"{safe_id.replace('-', '_')}.mp3",
            f"{safe_id.replace('_', '-')}.mp3",
            f"{safe_id}.mp4",
            f"{safe_id.replace('-', '_')}.mp4",
            f"{safe_id.replace('_', '-')}.mp4",
        }
        purged = False
        for v in variations:
            p = os.path.join(self.cache_dir, v)
            if os.path.isfile(p):
                try:
                    os.remove(p)
                    logger.info("Purged local audio/video cache: %s", p)
                    purged = True
                except Exception as e:
                    logger.warning("Error purging cache %s: %s", p, e)
            meta_p = p + ".meta.json"
            if os.path.isfile(meta_p):
                try:
                    os.remove(meta_p)
                except Exception:
                    pass
        return purged

    def ensure_local_cache(self, entry_id: str, drive_file_id: Optional[str] = None) -> Optional[str]:
        safe_id = "".join(c for c in entry_id if c.isalnum() or c in ("-", "_")).strip()
        is_mock = settings.mock_google_api or getattr(google_service, "mock_mode", False)

        # If no drive_file_id and not mock mode, the file was deleted from Drive: purge cache!
        if not drive_file_id and not is_mock:
            self.purge_cache(entry_id)
            return None

        # Check existing candidates (.mp4 or .mp3)
        for ext in [".mp4", ".mp3"]:
            candidate_path = os.path.join(self.cache_dir, f"{safe_id}{ext}")
            meta_path = candidate_path + ".meta.json"
            if os.path.isfile(candidate_path) and os.path.getsize(candidate_path) > 0:
                if drive_file_id and not is_mock:
                    try:
                        if os.path.isfile(meta_path):
                            import json
                            with open(meta_path, "r") as mf:
                                cached_meta = json.load(mf)
                            if cached_meta.get("drive_file_id") == drive_file_id:
                                return candidate_path
                        else:
                            import json
                            with open(meta_path, "w") as mf:
                                json.dump({"drive_file_id": drive_file_id}, mf)
                            return candidate_path
                    except Exception as ex:
                        logger.warning("Error checking cache metadata for %s: %s", entry_id, ex)
                        return candidate_path
                else:
                    return candidate_path

        # If mismatch or not found, purge cache before downloading
        if drive_file_id and not is_mock:
            self.purge_cache(entry_id)

        # If not cached locally, attempt to download from Google Drive
        if drive_file_id and not is_mock:
            logger.info("Cache miss for %s. Downloading from Google Drive (file_id: %s)...", entry_id, drive_file_id)
            drive_meta = google_service.get_drive_file_metadata(drive_file_id)
            is_video = False
            if drive_meta:
                name = (drive_meta.get("name") or "").lower()
                mime = (drive_meta.get("mimeType") or "").lower()
                if name.endswith(".mp4") or "video" in mime:
                    is_video = True

            ext = ".mp4" if is_video else ".mp3"
            cache_path = os.path.join(self.cache_dir, f"{safe_id}{ext}")
            meta_path = cache_path + ".meta.json"

            file_bytes = google_service.download_file_bytes(drive_file_id)
            if file_bytes:
                with open(cache_path, "wb") as f:
                    f.write(file_bytes)
                try:
                    import json
                    with open(meta_path, "w") as mf:
                        json.dump({"drive_file_id": drive_file_id}, mf)
                except Exception:
                    pass
                logger.info("Cached %d bytes to %s", len(file_bytes), cache_path)
                return cache_path

        # If in mock mode or file doesn't exist
        if is_mock:
            mp4_p = os.path.join(self.cache_dir, f"{safe_id}.mp4")
            mp3_p = os.path.join(self.cache_dir, f"{safe_id}.mp3")
            if os.path.isfile(mp4_p) and os.path.getsize(mp4_p) > 0:
                return mp4_p
            if os.path.isfile(mp3_p) and os.path.getsize(mp3_p) > 0:
                return mp3_p
            self._create_mock_mp3(mp3_p)
            return mp3_p

        return None

    def get_track_metadata(self, entry_id: str, drive_file_id: Optional[str], canonical_name: str) -> dict:
        cache_path = self.ensure_local_cache(entry_id, drive_file_id)
        if not cache_path or not os.path.isfile(cache_path):
            return {"exists": False}

        size_bytes = os.path.getsize(cache_path)
        duration_sec = None
        media_type = "video" if cache_path.lower().endswith(".mp4") else "audio"

        try:
            from mutagen import File as MutagenFile
            audio = MutagenFile(cache_path)
            if audio and audio.info and hasattr(audio.info, "length"):
                duration_sec = round(audio.info.length, 1)
        except Exception as e:
            logger.warning("Could not read media duration for %s: %s", entry_id, e)

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
            "media_type": media_type,
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

    def _create_mock_mp4(self, path: str):
        # Minimal valid MP4 header for mock testing
        with open(path, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2mp41\x00\x00\x00\x08free")

    def stream_file_range(self, filepath: str, range_header: Optional[str] = None):
        """Streams byte-range requests for a local audio file via streaming utility."""
        from app.utils.streaming import stream_file_range
        return stream_file_range(filepath, range_header)

    def generate_sequenced_zip_file(self) -> Tuple[str, str]:
        """Builds offline sequenced ZIP file on disk using tempfile to prevent RAM exhaustion."""
        import tempfile
        queue = google_service.get_stage_queue()
        if not queue:
            db_perfs = db_service.get_all_performances()
            class SimplePerf:
                def __init__(self, d):
                    for k, v in d.items():
                        setattr(self, k, v)
            queue = [SimplePerf(p) for p in sorted(db_perfs, key=lambda x: x.get("sequence_order") if x.get("sequence_order") is not None else 9999)]

        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M")
        zip_filename = f"Paattukoottam_Stage_Tracks_{timestamp_str}.zip"

        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp_path = tmp.name

        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            run_sheet_lines = [
                "EMA Paattukoottam - Live Stage Show Run Sheet",
                f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                "=" * 70,
                f"{'Seq':<5} | {'Performer(s)':<35} | {'Song Title':<30} | {'Type':<8} | {'Status':<10} | Stage Notes",
                "-" * 120,
            ]

            for item in queue:
                seq_num = f"{item.sequence_order:02d}" if getattr(item, "sequence_order", None) is not None else "XX"
                singer_clean = sanitize_filename(getattr(item, "performer_name", "") or "Performer")
                partner_raw = getattr(item, "partner_name", "") or ""
                partner_clean = sanitize_filename(partner_raw)
                partner_suffix = f"_w_{partner_clean}" if partner_clean else ""
                song_clean = sanitize_filename(getattr(item, "song_title", "") or "Track")
                perf_type = getattr(item, "performance_type", "Solo") or "Solo"
                track_status = getattr(item, "track_status", "Pending") or "Pending"
                stage_notes = getattr(item, "stage_notes", "") or ""
                performer_display = getattr(item, "performer_name", "") or ""
                if partner_raw:
                    performer_display = f"{performer_display} & {partner_raw}"

                line = f"#{seq_num:<4} | {performer_display:<35} | {(getattr(item, 'song_title', '') or '-'):<30} | {perf_type:<8} | {track_status:<10} | {stage_notes}"
                run_sheet_lines.append(line)

                drive_id = getattr(item, "drive_file_id", None)
                if track_status in ("Acoustic", "Pending") and not drive_id:
                    continue

                entry_id = getattr(item, "entry_id", "")
                cache_file = self.ensure_local_cache(entry_id, drive_id)
                if cache_file and os.path.isfile(cache_file):
                    ext = os.path.splitext(cache_file)[1] or ".mp3"
                    zip_entry_name = f"{seq_num}_{singer_clean}{partner_suffix}_{song_clean}{ext}"
                    zf.write(cache_file, arcname=zip_entry_name)

            manifest_content = "\n".join(run_sheet_lines)
            zf.writestr("00_Show_Run_Sheet.txt", manifest_content)
            zf.writestr("00_SEQUENCE_MANIFEST.txt", manifest_content)

        return tmp_path, zip_filename

    def export_sequenced_zip(self) -> Tuple[io.BytesIO, str]:
        """Backward-compatible helper returning in-memory buffer."""
        tmp_path, filename = self.generate_sequenced_zip_file()
        try:
            with open(tmp_path, "rb") as f:
                buf = io.BytesIO(f.read())
            return buf, filename
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

audio_service = AudioService()
