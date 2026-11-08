import os
import hashlib
import logging
from typing import Optional
from fastapi import (
    APIRouter, UploadFile, File, Form, Header, HTTPException,
    Depends, Request, Response
)
from fastapi.responses import FileResponse

from app.features import feature_enabled
from app.services.event_service import event_service
from app.services.audio_service import audio_service
from app.services.track_store import mime_type_for, media_type_for
from app.services.audio_workflow_service import audio_workflow_service
from app.services.loudness_service import loudness_service
from app.services.db_service import db_service
from app.routers.auth import verify_operator_pin, verify_admin_pin, is_admin
from app.privacy import NamePrivacy
from app.config import get_setting, settings
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
    request: Request,
    entry_id: str = Form(...),
    submission_type: str = Form("file"),
    media_type: str = Form("audio"),
    youtube_url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None)
):
    raw_path = None
    try:
        if not feature_enabled("track_upload_enabled"):
            raise UploadDisabledError("Backing track uploads are currently disabled for this event.")
        original_filename = file.filename if file else None
        if file:
            # Stream to disk in 1 MB chunks and stop early when too big (a 500 MB video must not sit in RAM)
            is_video = (media_type or "").strip().lower() == "video"
            audio_workflow_service.check_extension(original_filename, is_video)
            limit = audio_workflow_service.max_upload_bytes(is_video)
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
                        raise FileTooLargeError(audio_workflow_service.too_large_message(limit))
                    out.write(chunk)
        result = await audio_workflow_service.process_track_upload(
            entry_id=entry_id,
            submission_type=submission_type,
            media_type=media_type,
            youtube_url=youtube_url,
            file_path=raw_path,
            original_filename=original_filename,
        )
        if not is_admin(request):
            result = dict(result)
            names = NamePrivacy(db_service.get_all_performances())
            original_name = result.get("performer_name")
            result["performer_name"] = names.name(original_name)
            if result.get("filename") and (result["performer_name"] != original_name or names.contains_protected_name(result["filename"])):
                result["filename"] = "Backing track"
                result["message"] = "Your backing track was uploaded and queued for playback."
        return result
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
    content_type = mime_type_for(cache_path)

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


_SHA_CACHE: dict = {}


def _sha256_cached(path: str) -> str:
    """sha256 of a file, cached by (path, size, mtime) so repeated manifest calls do not re-read big videos."""
    st = os.stat(path)
    key = (path, st.st_size, st.st_mtime_ns)
    cached = _SHA_CACHE.get(key)
    if cached:
        return cached
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    for old in [k for k in _SHA_CACHE if k[0] == path]:
        _SHA_CACHE.pop(old, None)
    _SHA_CACHE[key] = h.hexdigest()
    return _SHA_CACHE[key]


def _duration_seconds(text) -> Optional[float]:
    parts = str(text or "").strip().split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if not 1 < len(nums) <= 3:
        return None
    total = 0
    for n in nums:
        total = total * 60 + n
    return float(total)


@router.get("/api/vault/manifest")
def vault_manifest(_authorized: bool = Depends(verify_admin_pin)):
    """Every ready track (audio and video) with its checksum, for backup/verification tools."""
    tracks = []
    for perf in db_service.get_all_performances():
        entry_id = perf.get("entry_id")
        path = audio_service.get_track_path(entry_id) if entry_id else None
        if not path or not os.path.isfile(path):
            continue
        gain_db = loudness_service.gain_db(entry_id, path)
        if gain_db is None:
            loudness_service.schedule(entry_id, path)  # measured in the background; shows up on the next manifest fetch
        tracks.append({
            "entry_id": entry_id,
            "file": os.path.basename(path),
            "kind": media_type_for(path),
            "sha256": _sha256_cached(path),
            "size": os.path.getsize(path),
            "duration": _duration_seconds(perf.get("duration")),
            "gain_db": gain_db,
            "url": f"/api/stream/{entry_id}",
        })
    return {"event_id": get_setting("event_id") or settings.event.id, "tracks": tracks}


@router.get("/api/download-track/{entry_id}")
async def download_track(entry_id: str, _authorized: bool = Depends(verify_operator_pin)):
    target = db_service.get_performance(entry_id)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    cache_path = audio_service.get_track_path(entry_id)
    if not cache_path or not os.path.isfile(cache_path):
        raise HTTPException(status_code=404, detail="No audio/video track file available")

    return FileResponse(cache_path, media_type=mime_type_for(cache_path), filename=os.path.basename(cache_path))
