import json
import hashlib
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Request, Response

from app.config import settings, get_setting
from app.services.stage_service import stage_service
from app.services.audio_service import audio_service
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.routers.auth import verify_admin_pin, is_admin
from app.privacy import strip_private
from app.schemas import (
    StatusUpdateRequest,
    PerformanceNotesRequest,
    ReorderRequest,
)

from app.services.event_service import event_service
from app.services.export_service import export_service
from app.schemas import PerformanceEntry

logger = logging.getLogger("stage-router")

router = APIRouter(tags=["stage"])


def require_console_enabled(_authorized: bool = Depends(verify_admin_pin)) -> bool:
    """Blocks stage-control actions when the organizer disabled the sound console (e.g. potluck preset)."""
    if not bool(get_setting("console_enabled", getattr(settings.signup, "console_enabled", True))):
        raise HTTPException(status_code=403, detail="The sound console is disabled for this event.")
    return True


def _run_or_404(fn, *args):
    try:
        return fn(*args)
    except ValueError as ex:
        raise HTTPException(status_code=404, detail=str(ex))


@router.get("/api/live-status")
def get_live_status(request: Request):
    status = stage_service.get_live_status()
    # Ensure live event names stay in sync with runtime settings
    status["header_brand_title"] = get_setting("header_brand_title", getattr(settings.event, "header_brand_title", "EMA Paattukoottam"))
    status["header_brand_subtitle"] = get_setting("header_brand_subtitle", getattr(settings.event, "header_brand_subtitle", "Musical Night"))
    status["event_name"] = get_setting("event_name", status.get("event_name"))
    status["event_subtitle"] = get_setting("event_subtitle", status.get("event_subtitle"))
    status["live_display_enabled"] = bool(get_setting("live_display_enabled", getattr(settings.signup, "live_display_enabled", True)))
    if not status["live_display_enabled"]:
        for key in ("now_performing",):
            status[key] = None
        for key in ("up_next", "upcoming", "performed", "on_hold", "gallery_images"):
            status[key] = []
        status["active_entry_id"] = None

    from fastapi.encoders import jsonable_encoder

    # The live feed is public: never include phone numbers or guardian details.
    serializable_status = strip_private(jsonable_encoder(status))
    body = json.dumps(serializable_status, sort_keys=True)
    etag = f'"{hashlib.sha1(body.encode()).hexdigest()}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=1"})

    return Response(
        content=body,
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "public, max-age=1"}
    )


@router.post("/api/set-active/{entry_id}")
def set_active_performance(entry_id: str, _authorized: bool = Depends(require_console_enabled)):
    _run_or_404(event_service.set_active_performance, entry_id)
    return {"status": "success", "active_entry_id": entry_id}


@router.post("/api/clear-active")
def clear_active_performance(_authorized: bool = Depends(require_console_enabled)):
    event_service.clear_active_performance()
    return {"status": "success", "message": "Performance uncued and returned to queue"}


@router.get("/api/track-info/{entry_id}")
def get_track_info(entry_id: str):
    target = db_service.get_performance(entry_id)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    meta = audio_service.get_track_metadata(entry_id)
    meta["entry_id"] = entry_id
    meta["performer_name"] = target.get("performer_name")
    meta["song_title"] = target.get("song_title")
    meta["last_updated"] = target.get("last_updated")
    return meta


@router.get("/api/performances", response_model=List[PerformanceEntry])
def list_performances(request: Request):
    try:
        entries = event_service.get_performances()
        return entries if is_admin(request) else strip_private(entries)
    except Exception as e:
        logger.exception("Failed to fetch performances: %s", e)
        raise HTTPException(status_code=500, detail="Failed to read performances")


@router.post("/api/sync")
def sync_data(_authorized: bool = Depends(verify_admin_pin)):
    """Writes signups.xlsx/csv and a database snapshot into the event folder (the database stays the source of truth)."""
    try:
        event_service.reconcile_tracks(force=True)
        res = export_service.export_now(snapshot=True, force_snapshot=True)
        db_service.set_last_sync_time()
        return {
            "status": "success",
            "count": res["performances"],
            "food_count": res["potluck_items"],
            "files": res["files"],
            "snapshot": res["snapshot"],
            "event_dir": res["event_dir"],
        }
    except Exception as e:
        logger.exception("Failed to export event data: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/stage-queue", response_model=List[PerformanceEntry])
def stage_queue(request: Request):
    try:
        entries = event_service.get_stage_queue()
        return entries if is_admin(request) else strip_private(entries)
    except Exception as e:
        logger.exception("Failed to fetch stage queue: %s", e)
        raise HTTPException(status_code=500, detail="Failed to read queue")


@router.patch("/api/status/{entry_id}")
def update_status(entry_id: str, payload: StatusUpdateRequest, _authorized: bool = Depends(require_console_enabled)):
    try:
        event_service.update_status(entry_id, payload.status)
        backup_service.trigger_backup()
        return {"status": "success", "entry_id": entry_id, "new_status": payload.status}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Failed to update status for %s: %s", entry_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/api/performance-notes/{entry_id}")
def update_performance_notes(entry_id: str, payload: PerformanceNotesRequest, _authorized: bool = Depends(require_console_enabled)):
    try:
        db_service.update_performance_field(entry_id, "stage_notes", payload.notes.strip())
        backup_service.trigger_backup()
        return {"status": "success", "entry_id": entry_id, "stage_notes": payload.notes.strip()}
    except Exception as e:
        logger.exception("Failed to update stage notes for %s: %s", entry_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/reorder-queue")
def reorder_queue(payload: ReorderRequest, _authorized: bool = Depends(require_console_enabled)):
    try:
        updated = event_service.update_sequence_orders(
            [i.model_dump() for i in payload.items],
            push=payload.push_to_sheet
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
def push_sequence(_authorized: bool = Depends(require_console_enabled)):
    try:
        updated = event_service.sync_sequence()
        backup_service.trigger_backup()
        return {
            "status": "success",
            "synced_count": updated,
            "last_synced_at": db_service.get_last_sync_time()
        }
    except Exception as e:
        logger.exception("Failed to save sequence: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
