import os
import logging
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import settings
from app.services.google_service import google_service, PerformanceEntry
from app.services.audio_service import audio_service, sanitize_filename
from app.services.downloader_client import downloader_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("event-track-manager")

app = FastAPI(
    title="EMA Paattukoottam Event & Track Manager",
    description="Track manager and stage playback console for musical nights",
    version="1.0.0"
)

# Static files directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Models
class LoginRequest(BaseModel):
    pin: str

class StatusUpdateRequest(BaseModel):
    status: str

# Helper for Admin PIN verification
def verify_admin_pin(request: Request):
    auth_header = request.headers.get("X-Admin-PIN")
    cookie_pin = request.cookies.get("admin_pin")
    pin = auth_header or cookie_pin
    if pin != settings.admin_pin:
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid Admin PIN")
    return True

# HTML Pages
@app.get("/", response_class=HTMLResponse)
async def serve_intake_page():
    index_path = os.path.join(STATIC_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.get("/console", response_class=HTMLResponse)
async def serve_console_page():
    admin_path = os.path.join(STATIC_DIR, "admin.html")
    with open(admin_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.get("/admin")
async def redirect_admin_to_console():
    return RedirectResponse(url="/console")

@app.get("/live", response_class=HTMLResponse)
async def serve_live_page():
    live_path = os.path.join(STATIC_DIR, "live.html")
    with open(live_path, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

# API Endpoints
@app.get("/api/live-status")
async def get_live_status():
    return google_service.get_live_status()

@app.post("/api/set-active/{entry_id}")
async def set_active_performance(entry_id: str, _authorized: bool = Depends(verify_admin_pin)):
    google_service.set_active_performance(entry_id)
    return {"status": "success", "active_entry_id": entry_id}
@app.get("/api/event-info")
async def get_event_info():
    return {
        "event_id": settings.event.id,
        "event_name": settings.event.name,
        "mock_mode": settings.mock_google_api,
        "max_upload_size_mb": settings.storage.max_upload_size_mb,
        "sheet_url": f"https://docs.google.com/spreadsheets/d/{settings.google.sheet_id}/edit"
    }

@app.get("/api/track-info/{entry_id}")
async def get_track_info(entry_id: str):
    performances = google_service.get_performances()
    target = next((p for p in performances if p.entry_id == entry_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    safe_performer = sanitize_filename(target.performer_name)
    safe_song = sanitize_filename(target.song_title)
    canonical_filename = f"{entry_id}_{safe_performer}_{safe_song}.mp3"

    meta = audio_service.get_track_metadata(entry_id, target.drive_file_id, canonical_filename)
    meta["entry_id"] = entry_id
    meta["performer_name"] = target.performer_name
    meta["song_title"] = target.song_title
    meta["last_updated"] = target.last_updated
    return meta

@app.post("/api/auth/login")
async def admin_login(login: LoginRequest):
    if login.pin == settings.admin_pin:
        response = JSONResponse(content={"status": "success", "message": "Authenticated"})
        response.set_cookie(
            key="admin_pin",
            value=login.pin,
            httponly=True,
            samesite="lax",
            max_age=86400  # 24 hours
        )
        return response
    raise HTTPException(status_code=401, detail="Invalid PIN. Please try again.")

@app.get("/api/performances", response_model=List[PerformanceEntry])
async def list_performances():
    try:
        return google_service.get_performances()
    except Exception as e:
        logger.exception("Failed to fetch performances: %s", e)
        raise HTTPException(status_code=500, detail="Failed to read performances from Google Sheet")

@app.get("/api/stage-queue", response_model=List[PerformanceEntry])
async def stage_queue():
    try:
        return google_service.get_stage_queue()
    except Exception as e:
        logger.exception("Failed to fetch stage queue: %s", e)
        raise HTTPException(status_code=500, detail="Failed to read queue from Google Sheet")

@app.post("/api/upload")
async def upload_track(
    entry_id: str = Form(...),
    submission_type: str = Form("file"),  # "file" or "youtube"
    youtube_url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None)
):
    performances = google_service.get_performances()
    target_entry = next((p for p in performances if p.entry_id == entry_id), None)
    if not target_entry:
        raise HTTPException(status_code=404, detail=f"Performance entry {entry_id} not found")

    safe_performer = sanitize_filename(target_entry.performer_name)
    safe_song = sanitize_filename(target_entry.song_title)
    canonical_filename = f"{entry_id}_{safe_performer}_{safe_song}.mp3"

    cache_path = audio_service.get_cache_path(entry_id)

    # 1. Process Audio Input
    if submission_type == "youtube":
        if not youtube_url or not youtube_url.strip():
            raise HTTPException(status_code=400, detail="YouTube URL is required")
        
        logger.info("Extracting YouTube audio for %s: %s", entry_id, youtube_url)
        try:
            extract_res = await downloader_client.extract_audio(youtube_url.strip(), entry_id)
            track_title = extract_res.get("title", canonical_filename)
        except Exception as e:
            logger.error("Downloader extraction failed for %s: %s", entry_id, e)
            raise HTTPException(status_code=422, detail=str(e))

    elif submission_type == "file":
        if not file:
            raise HTTPException(status_code=400, detail="Audio file is required for direct upload")

        # Validate size
        content = await file.read()
        max_bytes = settings.storage.max_upload_size_mb * 1024 * 1024
        if len(content) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File exceeds maximum allowed size of {settings.storage.max_upload_size_mb}MB")

        # Write to local cache
        audio_service.save_upload_to_cache(entry_id, content)
        track_title = file.filename or canonical_filename
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported submission_type: {submission_type}")

    # 2. Archival: Check if existing track should be moved to Archive folder
    if target_entry.drive_file_id:
        try:
            logger.info("Archiving previous file for entry %s (file_id: %s)", entry_id, target_entry.drive_file_id)
            google_service.archive_previous_file(target_entry.drive_file_id, canonical_filename)
        except Exception as e:
            logger.warning("Could not archive existing file %s: %s", target_entry.drive_file_id, e)

    # 3. Upload new active track to Google Drive Active/ folder
    drive_file_id = None
    try:
        drive_file_id = google_service.upload_file_to_active(cache_path, canonical_filename)
    except Exception as e:
        logger.error("Failed to upload track to Google Drive Active/ folder: %s", e)
        raise HTTPException(status_code=500, detail="Failed to upload track to Google Drive")

    # 4. Update Google Sheet with Track Uploaded and Duration
    duration_str = None
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(cache_path)
        if audio and audio.info and hasattr(audio.info, "length"):
            sec = audio.info.length
            m = int(sec // 60)
            s = int(sec % 60)
            duration_str = f"{m:02d}:{s:02d}"
    except Exception as e:
        logger.warning("Could not compute duration for %s: %s", entry_id, e)

    try:
        google_service.update_track_metadata(entry_id, drive_file_id, status="Uploaded", duration_str=duration_str)
    except Exception as e:
        logger.error("Failed to update Google Sheet for %s: %s", entry_id, e)
        raise HTTPException(status_code=500, detail="Track uploaded to Drive, but failed to update Google Sheet row")

    return {
        "status": "success",
        "entry_id": entry_id,
        "performer_name": target_entry.performer_name,
        "song_title": target_entry.song_title,
        "filename": canonical_filename,
        "duration": duration_str,
        "drive_file_id": drive_file_id,
        "message": f"Successfully updated backing track for {target_entry.performer_name} - {target_entry.song_title}"
    }

@app.get("/api/stream/{entry_id}")
async def stream_audio(entry_id: str, range: Optional[str] = Header(None)):
    performances = google_service.get_performances()
    target = next((p for p in performances if p.entry_id == entry_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    cache_path = audio_service.ensure_local_cache(entry_id, target.drive_file_id)
    if not cache_path or not os.path.isfile(cache_path):
        raise HTTPException(status_code=404, detail="No audio track available for this performance")

    return audio_service.stream_file_range(cache_path, range)

@app.patch("/api/status/{entry_id}")
async def update_performance_status(
    entry_id: str,
    payload: StatusUpdateRequest,
    _authorized: bool = Depends(verify_admin_pin)
):
    try:
        success = google_service.update_status(entry_id, payload.status)
        if not success:
            raise HTTPException(status_code=404, detail=f"Entry {entry_id} not found")
        return {"status": "success", "entry_id": entry_id, "new_status": payload.status}
    except Exception as e:
        logger.exception("Failed to update status for %s: %s", entry_id, e)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/export-zip")
async def export_offline_zip(_authorized: bool = Depends(verify_admin_pin)):
    try:
        zip_buffer, filename = audio_service.export_sequenced_zip()
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        logger.exception("Failed to export offline ZIP: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to generate offline ZIP: {str(e)}")

@app.get("/api/download-track/{entry_id}")
async def download_track(entry_id: str, _authorized: bool = Depends(verify_admin_pin)):
    performances = google_service.get_performances()
    target = next((p for p in performances if p.entry_id == entry_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    cache_path = audio_service.ensure_local_cache(entry_id, target.drive_file_id)
    if not cache_path or not os.path.isfile(cache_path):
        raise HTTPException(status_code=404, detail="No audio track file available")

    canonical_filename = sanitize_filename(
        entry_id,
        target.performer_name,
        target.song_title,
        target.partner_name,
        os.path.splitext(cache_path)[1] or ".mp3"
    )
    return FileResponse(
        cache_path,
        media_type="audio/mpeg",
        filename=canonical_filename
    )

class SequenceItem(BaseModel):
    entry_id: str
    sequence_order: int

class ReorderRequest(BaseModel):
    items: List[SequenceItem]

@app.post("/api/reorder-queue")
async def reorder_queue(payload: ReorderRequest, _authorized: bool = Depends(verify_admin_pin)):
    try:
        updated = google_service.update_sequence_orders([i.model_dump() for i in payload.items])
        return {"status": "success", "updated_count": updated}
    except Exception as e:
        logger.exception("Failed to reorder queue: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
async def health():
    downloader_status = await downloader_client.check_health()
    return {
        "status": "healthy",
        "app": "event-track-manager",
        "mock_mode": settings.mock_google_api,
        "downloader": downloader_status
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
