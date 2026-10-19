import os
import logging
from typing import Optional
from fastapi import (
    APIRouter, UploadFile, File, Form, Header, HTTPException,
    Depends, Request, Response
)
from fastapi.responses import FileResponse

from app.services.event_service import event_service
from app.services.audio_service import audio_service
from app.services.audio_workflow_service import audio_workflow_service
from app.services.db_service import db_service
from app.routers.auth import verify_operator_pin
from app.exceptions import (
    UploadDisabledError,
    PerformanceNotFoundError,
    MissingSongTitleError,
    FileTooLargeError,
    InvalidAudioError,
    ExternalServiceError,
)

logger = logging.getLogger("audio-router")

router = APIRouter(tags=["audio"])


@router.post("/api/upload")
async def upload_track(
    entry_id: str = Form(...),
    submission_type: str = Form("file"),
    media_type: str = Form("audio"),
    youtube_url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None)
):
    raw_path = None
    try:
        from app.config import get_setting, settings as _settings
        if not bool(get_setting("track_upload_enabled", getattr(_settings.signup, "track_upload_enabled", True))):
            raise UploadDisabledError("Backing track uploads are currently disabled for this event.")
        original_filename = file.filename if file else None
        if file:
            # Stream to disk in 1 MB chunks and stop early when too big (a 500 MB video must not sit in RAM)
            limit = audio_workflow_service.max_upload_bytes((media_type or "").strip().lower() == "video")
            safe = "".join(c for c in entry_id if c.isalnum() or c in ("-", "_"))[:60] or "upload"
            raw_path = os.path.join(audio_service.cache_dir, f"{safe}.incoming_{os.getpid()}")
            written = 0
            with open(raw_path, "wb") as out:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > limit:
                        raise FileTooLargeError(f"File exceeds maximum allowed size of {limit // (1024 * 1024)}MB")
                    out.write(chunk)
        return await audio_workflow_service.process_track_upload(
            entry_id=entry_id,
            submission_type=submission_type,
            media_type=media_type,
            youtube_url=youtube_url,
            file_path=raw_path,
            original_filename=original_filename,
        )
    except (UploadDisabledError, MissingSongTitleError, ValueError, InvalidAudioError) as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except PerformanceNotFoundError as ex:
        raise HTTPException(status_code=404, detail=str(ex))
    except FileTooLargeError as ex:
        raise HTTPException(status_code=413, detail=str(ex))
    except ExternalServiceError as ex:
        if "downloader" in str(ex).lower() or "extraction failed" in str(ex).lower():
            raise HTTPException(status_code=422, detail=str(ex))
        raise HTTPException(status_code=500, detail=str(ex))
    finally:
        if raw_path and os.path.exists(raw_path):
            try:
                os.remove(raw_path)
            except OSError:
                pass


@router.get("/api/stream/{entry_id}")
async def stream_audio(entry_id: str, request: Request, range: Optional[str] = Header(None)):
    if not db_service.get_performance(entry_id):
        raise HTTPException(status_code=404, detail="Performance entry not found")

    cache_path = audio_service.get_track_path(entry_id)
    if not cache_path or not os.path.isfile(cache_path):
        raise HTTPException(status_code=404, detail="No audio/video track available for this performance")

    file_size = os.path.getsize(cache_path)
    is_video = cache_path.lower().endswith(".mp4")
    content_type = "video/mp4" if is_video else "audio/mpeg"

    no_cache_headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    if request.method == "HEAD":
        return Response(
            status_code=200,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Type": content_type,
                **no_cache_headers,
            }
        )

    from app.utils.streaming import stream_file_range
    return stream_file_range(cache_path, range_header=range, media_type=content_type)


@router.get("/api/admin/export-tracks-zip")
@router.get("/api/export-sequenced-zip")
@router.get("/api/export-zip")
async def export_offline_zip(_authorized: bool = Depends(verify_operator_pin)):
    try:
        import asyncio
        from starlette.background import BackgroundTask

        temp_zip_path, filename = await asyncio.to_thread(audio_service.generate_sequenced_zip_file)
        return FileResponse(
            temp_zip_path,
            media_type="application/zip",
            filename=filename,
            background=BackgroundTask(os.remove, temp_zip_path)
        )
    except Exception as e:
        logger.exception("Failed to export offline ZIP: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to generate offline ZIP: {str(e)}")


@router.get("/api/download-track/{entry_id}")
async def download_track(entry_id: str, _authorized: bool = Depends(verify_operator_pin)):
    target = db_service.get_performance(entry_id)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    cache_path = audio_service.get_track_path(entry_id)
    if not cache_path or not os.path.isfile(cache_path):
        raise HTTPException(status_code=404, detail="No audio/video track file available")

    ext = os.path.splitext(cache_path)[1] or ".mp3"
    media_type = "video/mp4" if ext.lower() == ".mp4" else "audio/mpeg"
    return FileResponse(cache_path, media_type=media_type, filename=os.path.basename(cache_path))
