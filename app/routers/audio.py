import os
import logging
from typing import Optional
from fastapi import (
    APIRouter, UploadFile, File, Form, Header, HTTPException,
    Depends, Request, Response
)
from fastapi.responses import FileResponse

from app.services.google_service import google_service
from app.services.audio_service import audio_service, sanitize_filename
from app.services.audio_workflow_service import audio_workflow_service
from app.services.db_service import db_service
from app.routers.auth import verify_admin_pin
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
    try:
        file_content = await file.read() if file else None
        original_filename = file.filename if file else None
        return await audio_workflow_service.process_track_upload(
            entry_id=entry_id,
            submission_type=submission_type,
            media_type=media_type,
            youtube_url=youtube_url,
            file_content=file_content,
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


@router.get("/api/stream/{entry_id}")
async def stream_audio(entry_id: str, request: Request, range: Optional[str] = Header(None)):
    performances = google_service.get_performances()
    target = next((p for p in performances if p.entry_id == entry_id), None)
    drive_file_id = None
    if target:
        drive_file_id = target.drive_file_id
    else:
        # Check SQLite DB as fallback
        db_perfs = db_service.get_all_performances()
        db_target = next((p for p in db_perfs if p["entry_id"] == entry_id), None)
        if not db_target:
            raise HTTPException(status_code=404, detail="Performance entry not found")
        drive_file_id = db_target.get("drive_file_id")

    cache_path = audio_service.ensure_local_cache(entry_id, drive_file_id)
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
async def export_offline_zip(_authorized: bool = Depends(verify_admin_pin)):
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
async def download_track(entry_id: str, _authorized: bool = Depends(verify_admin_pin)):
    performances = google_service.get_performances()
    target = next((p for p in performances if p.entry_id == entry_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    cache_path = audio_service.ensure_local_cache(entry_id, target.drive_file_id)
    if not cache_path or not os.path.isfile(cache_path):
        raise HTTPException(status_code=404, detail="No audio/video track file available")

    safe_p = sanitize_filename(target.performer_name)
    safe_s = sanitize_filename(target.song_title)
    ext = os.path.splitext(cache_path)[1] or ".mp3"
    seq_str = f"{target.sequence_order:02d}_" if target.sequence_order else ""
    canonical_filename = f"{seq_str}{entry_id}_{safe_p}_{safe_s}{ext}"
    media_type = "video/mp4" if ext.lower() == ".mp4" else "audio/mpeg"

    return FileResponse(
        cache_path,
        media_type=media_type,
        filename=canonical_filename
    )
