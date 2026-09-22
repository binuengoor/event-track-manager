import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends

from app.config import settings, get_setting
from app.services.stage_service import stage_service
from app.services.audio_service import audio_service, sanitize_filename
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.routers.auth import verify_admin_pin
from app.schemas import (
    StatusUpdateRequest,
    PerformanceNotesRequest,
    ReorderRequest,
)

from app.services.google_service import google_service, PerformanceEntry

logger = logging.getLogger("stage-router")

router = APIRouter(tags=["stage"])


@router.get("/api/live-status")
async def get_live_status():
    status = stage_service.get_live_status()
    # Ensure live event names stay in sync with runtime settings
    status["header_brand_title"] = get_setting("header_brand_title", getattr(settings.event, "header_brand_title", "EMA Paattukoottam"))
    status["header_brand_subtitle"] = get_setting("header_brand_subtitle", getattr(settings.event, "header_brand_subtitle", "Musical Night"))
    status["event_name"] = get_setting("event_name", status.get("event_name"))
    status["event_subtitle"] = get_setting("event_subtitle", status.get("event_subtitle"))
    return status


@router.post("/api/set-active/{entry_id}")
async def set_active_performance(entry_id: str, _authorized: bool = Depends(verify_admin_pin)):
    google_service.set_active_performance(entry_id)
    return {"status": "success", "active_entry_id": entry_id}


@router.post("/api/clear-active")
async def clear_active_performance(_authorized: bool = Depends(verify_admin_pin)):
    google_service.clear_active_performance()
    return {"status": "success", "message": "Performance uncued and returned to queue"}


@router.get("/api/track-info/{entry_id}")
async def get_track_info(entry_id: str):
    performances = google_service.get_performances()
    target = next((p for p in performances if p.entry_id == entry_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    safe_performer = sanitize_filename(target.performer_name)
    safe_song = sanitize_filename(target.song_title)
    seq = target.sequence_order
    seq_prefix = f"{seq:02d}_" if seq else ""
    canonical_filename = target.drive_file_name or f"{seq_prefix}{entry_id}_{safe_performer}_{safe_song}.mp3"

    meta = audio_service.get_track_metadata(entry_id, target.drive_file_id, canonical_filename)
    meta["entry_id"] = entry_id
    meta["performer_name"] = target.performer_name
    meta["song_title"] = target.song_title
    meta["last_updated"] = target.last_updated
    return meta


@router.get("/api/performances", response_model=List[PerformanceEntry])
async def list_performances():
    try:
        return google_service.get_performances()
    except Exception as e:
        logger.exception("Failed to fetch performances: %s", e)
        raise HTTPException(status_code=500, detail="Failed to read performances from Google Sheet")


@router.post("/api/sync")
async def sync_data():
    """One-way sync: Exports App DB (the source of truth) directly into Google Sheet."""
    try:
        performances = db_service.get_all_performances()
        food_items = db_service.get_all_food_items_with_signups()
        
        target_sheet_id = settings.google.sheet_id
        folder_id = (
            settings.backup.drive_folder_id
            or getattr(settings.google.drive_folders, "archive_folder_id", "")
            or getattr(settings.google.drive_folders, "active_folder_id", "")
        )
        event_id = get_setting("event_id", settings.event.id)
        sheet_title = f"{event_id}_sync"

        res = google_service.create_or_update_backup_sheet(
            folder_id=folder_id,
            title=sheet_title,
            performances=performances,
            food_items=food_items,
            target_sheet_id=target_sheet_id
        )
        db_service.set_last_sync_time()
        return {
            "status": "success",
            "count": len(performances),
            "food_count": len(food_items),
            "sheet_title": sheet_title,
            "target_sheet_id": target_sheet_id,
            "file_id": res.get("file_id")
        }
    except Exception as e:
        logger.exception("Failed to sync data to Google Sheet: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/stage-queue", response_model=List[PerformanceEntry])
async def stage_queue():
    try:
        return google_service.get_stage_queue()
    except Exception as e:
        logger.exception("Failed to fetch stage queue: %s", e)
        raise HTTPException(status_code=500, detail="Failed to read queue from Google Sheet")


@router.patch("/api/status/{entry_id}")
async def update_status(entry_id: str, payload: StatusUpdateRequest, _authorized: bool = Depends(verify_admin_pin)):
    try:
        google_service.update_status(entry_id, payload.status)
        backup_service.trigger_backup()
        return {"status": "success", "entry_id": entry_id, "new_status": payload.status}
    except Exception as e:
        logger.exception("Failed to update status for %s: %s", entry_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/api/performance-notes/{entry_id}")
async def update_performance_notes(entry_id: str, payload: PerformanceNotesRequest, _authorized: bool = Depends(verify_admin_pin)):
    try:
        db_service.update_performance_field(entry_id, "stage_notes", payload.notes.strip())
        backup_service.trigger_backup()
        return {"status": "success", "entry_id": entry_id, "stage_notes": payload.notes.strip()}
    except Exception as e:
        logger.exception("Failed to update stage notes for %s: %s", entry_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/reorder-queue")
async def reorder_queue(payload: ReorderRequest, _authorized: bool = Depends(verify_admin_pin)):
    try:
        updated = google_service.update_sequence_orders(
            [i.model_dump() for i in payload.items],
            push_to_sheet=payload.push_to_sheet
        )
        backup_service.trigger_backup()
        return {
            "status": "success",
            "updated_count": updated,
            "is_dirty": db_service.is_sequence_dirty(),
            "pushed_to_sheet": payload.push_to_sheet
        }
    except Exception as e:
        logger.exception("Failed to reorder queue: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/push-sequence")
async def push_sequence(_authorized: bool = Depends(verify_admin_pin)):
    try:
        updated = google_service.sync_sequence_to_google()
        backup_service.trigger_backup()
        return {
            "status": "success",
            "synced_count": updated,
            "last_synced_at": db_service.get_last_sync_time()
        }
    except Exception as e:
        logger.exception("Failed to push sequence to Google Sheet: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
