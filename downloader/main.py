import os
import logging
import shutil
import threading
from urllib.parse import urlparse
from typing import Optional, Literal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

try:
    import yt_dlp
    DownloadError = yt_dlp.utils.DownloadError
except ImportError:
    yt_dlp = None
    class DownloadError(Exception):
        pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("downloader-service")

app = FastAPI(title="Paattukoottam Downloader Microservice")

CACHE_DIR = os.getenv("CACHE_DIR", "/data/cache")
COOKIES_PATH = os.getenv("COOKIES_PATH", "/secrets/yt_cookies.txt")
try:
    os.makedirs(CACHE_DIR, exist_ok=True)
except Exception:
    CACHE_DIR = os.path.join(os.getcwd(), "data", "cache")
    os.makedirs(CACHE_DIR, exist_ok=True)

# Limit concurrent heavy downloads/transcoding to avoid host resource exhaustion
DOWNLOAD_SEMAPHORE = threading.Semaphore(2)

ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "soundcloud.com",
    "www.soundcloud.com",
    "m.soundcloud.com"
}


def validate_media_url(raw_url: str) -> str:
    """Validates URL scheme and enforces domain allowlist to prevent SSRF and internal port scanning."""
    if not raw_url or not isinstance(raw_url, str):
        raise HTTPException(status_code=400, detail="Invalid media URL")
    clean_url = raw_url.strip()
    try:
        parsed = urlparse(clean_url)
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed URL")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="URL scheme must be http or https")

    hostname = (parsed.hostname or "").lower()
    is_allowed = (
        hostname in ALLOWED_HOSTS
        or hostname.endswith(".youtube.com")
        or hostname.endswith(".soundcloud.com")
        or hostname == "youtu.be"
    )
    if not is_allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Domain '{hostname}' is not supported for media extraction. Only YouTube and SoundCloud are allowed."
        )

    # Sanitize YouTube URLs: strip radio mix, playlist, and tracking query params
    # to avoid bot triggers and unintended playlist downloads
    if "youtube.com" in hostname:
        from urllib.parse import parse_qs
        qs = parse_qs(parsed.query)
        if "v" in qs and qs["v"]:
            clean_url = f"https://www.youtube.com/watch?v={qs['v'][0]}"
    elif hostname == "youtu.be":
        video_id = parsed.path.strip("/")
        if video_id:
            clean_url = f"https://youtu.be/{video_id}"

    return clean_url


def ytdl_match_filter(info_dict, *, incomplete=False):
    """Rejects livestreams and media longer than 20 minutes (1200 seconds) to prevent disk exhaustion."""
    if info_dict.get("is_live"):
        return "Livestreams are not supported for track downloads"
    duration = info_dict.get("duration")
    if duration and duration > 1200:
        return f"Track duration ({duration}s) exceeds the 20-minute maximum limit"
    return None


def get_writable_cookies_file() -> Optional[str]:
    """Finds available cookie file and copies it to a writable location in /tmp."""
    candidates = [
        COOKIES_PATH,
        os.getenv("COOKIES_PATH", ""),
        "/secrets/yt_cookies.txt",
        "/secrets/cookies.txt",
        "./secrets/yt_cookies.txt",
        "./secrets/cookies.txt",
    ]
    for c in candidates:
        if c and os.path.isfile(c) and os.path.getsize(c) > 0:
            target = "/tmp/active_yt_cookies.txt"
            try:
                shutil.copyfile(c, target)
                return target
            except Exception as ex:
                logger.warning("Could not copy cookies to /tmp: %s", ex)
                return c
    return None


class ExtractRequest(BaseModel):
    url: str
    entry_id: str
    media_type: Literal["audio", "video"] = "audio"


class ExtractResponse(BaseModel):
    status: str
    entry_id: str
    title: str
    duration: Optional[float] = None
    file_path: str
    file_name: str
    media_type: str = "audio"


@app.get("/health")
def health_check():
    cookies_file = get_writable_cookies_file()
    return {
        "status": "healthy",
        "service": "paattukoottam-downloader",
        "ytdlp_version": yt_dlp.version.__version__ if yt_dlp else "mock",
        "cookies_mounted": bool(cookies_file),
        "cookies_path": cookies_file
    }


@app.post("/api/extract", response_model=ExtractResponse)
def extract_media(request: ExtractRequest):
    entry_id = "".join(c for c in request.entry_id if c.isalnum() or c in ("-", "_")).strip()
    if not entry_id:
        raise HTTPException(status_code=400, detail="Invalid entry_id format")

    valid_url = validate_media_url(request.url)

    is_video = request.media_type == "video"
    ext = "mp4" if is_video else "mp3"
    final_output_file = os.path.join(CACHE_DIR, f"{entry_id}.{ext}")
    temp_template = os.path.join(CACHE_DIR, f"{entry_id}_temp.%(ext)s")

    if is_video:
        ydl_opts = {
            "format": "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
            "outtmpl": temp_template,
            "merge_output_format": "mp4",
            "noplaylist": True,
            "quiet": False,
            "no_warnings": False,
            "retries": 3,
            "socket_timeout": 45,
            "match_filter": ytdl_match_filter,
        }
    else:
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": temp_template,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "noplaylist": True,
            "quiet": False,
            "no_warnings": False,
            "retries": 3,
            "socket_timeout": 30,
            "match_filter": ytdl_match_filter,
        }

    cookies_file = get_writable_cookies_file()
    if cookies_file:
        logger.info("Using active writable cookies file: %s", cookies_file)
        ydl_opts["cookiefile"] = cookies_file

    acquired = DOWNLOAD_SEMAPHORE.acquire(timeout=60)
    if not acquired:
        raise HTTPException(
            status_code=503,
            detail="Downloader is busy processing concurrent media tasks. Please retry shortly."
        )

    logger.info("Starting %s extraction for %s (URL: %s)", "video" if is_video else "audio", entry_id, valid_url)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(valid_url, download=True)
            if info is None:
                raise HTTPException(status_code=400, detail="Could not retrieve video information")

            title = info.get("title", f"Track-{entry_id}")
            duration = info.get("duration")

            # Locate produced file
            produced_file = os.path.join(CACHE_DIR, f"{entry_id}_temp.{ext}")
            if not os.path.exists(produced_file):
                # Search for any temp file with entry_id prefix if format differed
                for candidate in os.listdir(CACHE_DIR):
                    if candidate.startswith(f"{entry_id}_temp."):
                        produced_file = os.path.join(CACHE_DIR, candidate)
                        break

            if os.path.exists(produced_file):
                if os.path.exists(final_output_file):
                    os.remove(final_output_file)
                os.rename(produced_file, final_output_file)
            elif not os.path.exists(final_output_file):
                raise HTTPException(status_code=500, detail=f"Media file conversion failed: output {ext} file not found")

            logger.info("Extraction succeeded: %s -> %s", title, final_output_file)
            return ExtractResponse(
                status="success",
                entry_id=entry_id,
                title=title,
                duration=duration,
                file_path=final_output_file,
                file_name=f"{entry_id}.{ext}",
                media_type="video" if is_video else "audio"
            )

    except HTTPException:
        raise

    except DownloadError as e:
        error_msg = str(e)
        logger.error("DownloadError extracting %s: %s", valid_url, error_msg)
        if "Sign in to confirm you're not a bot" in error_msg:
            detail = "YouTube blocked automated download (bot detection). Please upload the audio file directly."
        elif "Video unavailable" in error_msg or "Private video" in error_msg:
            detail = "The video is private, removed, or unavailable."
        elif "exceeds the 20-minute maximum limit" in error_msg or "Livestreams are not supported" in error_msg:
            detail = error_msg
        else:
            detail = f"Failed to download audio from YouTube: {error_msg[:120]}"
        raise HTTPException(status_code=422, detail=detail)

    except Exception as e:
        logger.exception("Unexpected error during extraction: %s", e)
        raise HTTPException(status_code=500, detail=f"Internal extraction error: {str(e)}")

    finally:
        DOWNLOAD_SEMAPHORE.release()
        # Clean up any remaining temporary files for this entry_id
        try:
            for candidate in os.listdir(CACHE_DIR):
                if candidate.startswith(f"{entry_id}_temp."):
                    temp_cleanup = os.path.join(CACHE_DIR, candidate)
                    if os.path.exists(temp_cleanup):
                        os.remove(temp_cleanup)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
