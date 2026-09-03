import os
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl
import yt_dlp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("downloader-service")

app = FastAPI(title="Paattukoottam Downloader Microservice")

CACHE_DIR = os.getenv("CACHE_DIR", "/data/cache")
COOKIES_PATH = os.getenv("COOKIES_PATH", "/secrets/cookies.txt")
os.makedirs(CACHE_DIR, exist_ok=True)

class ExtractRequest(BaseModel):
    url: str
    entry_id: str

class ExtractResponse(BaseModel):
    status: str
    entry_id: str
    title: str
    duration: Optional[float] = None
    file_path: str
    file_name: str

@app.get("/health")
def health_check():
    has_cookies = os.path.isfile(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 0
    return {
        "status": "healthy",
        "service": "paattukoottam-downloader",
        "ytdlp_version": yt_dlp.version.__version__,
        "cookies_mounted": has_cookies
    }

@app.post("/api/extract", response_model=ExtractResponse)
def extract_audio(request: ExtractRequest):
    entry_id = "".join(c for c in request.entry_id if c.isalnum() or c in ("-", "_")).strip()
    if not entry_id:
        raise HTTPException(status_code=400, detail="Invalid entry_id format")

    final_output_file = os.path.join(CACHE_DIR, f"{entry_id}.mp3")
    temp_template = os.path.join(CACHE_DIR, f"{entry_id}_temp.%(ext)s")

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
    }

    if os.path.isfile(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 0:
        logger.info("Using mounted cookies file: %s", COOKIES_PATH)
        ydl_opts["cookiefile"] = COOKIES_PATH

    logger.info("Starting audio extraction for %s (URL: %s)", entry_id, request.url)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(request.url, download=True)
            if info is None:
                raise HTTPException(status_code=400, detail="Could not retrieve video information")

            title = info.get("title", f"Track-{entry_id}")
            duration = info.get("duration")

            # yt-dlp with FFmpegExtractAudio produces {entry_id}_temp.mp3
            produced_file = os.path.join(CACHE_DIR, f"{entry_id}_temp.mp3")
            if os.path.exists(produced_file):
                if os.path.exists(final_output_file):
                    os.remove(final_output_file)
                os.rename(produced_file, final_output_file)
            elif not os.path.exists(final_output_file):
                raise HTTPException(status_code=500, detail="Audio file conversion failed: output file not found")

            logger.info("Extraction succeeded: %s -> %s", title, final_output_file)
            return ExtractResponse(
                status="success",
                entry_id=entry_id,
                title=title,
                duration=duration,
                file_path=final_output_file,
                file_name=f"{entry_id}.mp3"
            )

    except yt_dlp.utils.DownloadError as e:
        error_msg = str(e)
        logger.error("DownloadError extracting %s: %s", request.url, error_msg)
        if "Sign in to confirm you're not a bot" in error_msg:
            detail = "YouTube blocked automated download (bot detection). Please upload the audio file directly."
        elif "Video unavailable" in error_msg or "Private video" in error_msg:
            detail = "The video is private, removed, or unavailable."
        else:
            detail = f"Failed to download audio from YouTube: {error_msg[:120]}"
        raise HTTPException(status_code=422, detail=detail)

    except Exception as e:
        logger.exception("Unexpected error during extraction: %s", e)
        raise HTTPException(status_code=500, detail=f"Internal extraction error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
