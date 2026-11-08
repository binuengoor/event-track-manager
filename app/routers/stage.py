import json
import hashlib
import logging
from typing import Optional, List, Dict, Any
import asyncio
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from fastapi.responses import JSONResponse

from app.features import feature_enabled
from app.config import settings, get_setting
from app.services.stage_service import stage_service
from app.services.audio_service import audio_service
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.routers.auth import verify_admin_pin, verify_operator_pin, is_admin
from app.privacy import strip_private, NamePrivacy, public_status
from app.services.live_broadcaster import live_broadcaster
from app.schemas import (
    StatusUpdateRequest,
    PerformanceNotesRequest,
    ReorderRequest,
    AnnouncementRequest,
)

from app.services.event_service import event_service
from app.services.export_service import export_service
from app.schemas import PerformanceEntry

logger = logging.getLogger("stage-router")

router = APIRouter(tags=["stage"])

SSE_KEEPALIVE_SECONDS = 15


def require_console_enabled(_authorized: bool = Depends(verify_operator_pin)) -> bool:
    """Blocks stage-control actions when the organizer disabled the sound console (e.g. potluck preset)."""
    if not feature_enabled("console_enabled"):
        raise HTTPException(status_code=403, detail="The sound console is disabled for this event.")
    return True


def _run_or_404(fn, *args):
    try:
        return fn(*args)
    except ValueError as ex:
        raise HTTPException(status_code=404, detail=str(ex))


PUBLIC_HIDDEN_ENTRY_KEYS = ("age_group", "partner_age_group", "track_status", "stage_notes", "extra_tags", "track_file")
LIVE_ENTRY_LISTS = ("up_next", "upcoming", "performed", "on_hold")


def _redact_entry(row: Dict[str, Any], names: NamePrivacy) -> Dict[str, Any]:
    """Public view of one schedule row: shortened junior names, no age group, track status or stage notes."""
    out = {k: v for k, v in row.items() if k not in PUBLIC_HIDDEN_ENTRY_KEYS}
    out["performer_name"] = names.name(row.get("performer_name"))
    if "partner_name" in out:
        out["partner_name"] = names.partners(row.get("partner_name"))
    if out.get("track_version"):
        out["track_version"] = "available"
    return out


def _redact_live_status(status: Dict[str, Any], active_id: Optional[str]) -> Dict[str, Any]:
    names = NamePrivacy(db_service.get_all_performances())
    def one(row):
        r = _redact_entry(row, names)
        r["status"] = public_status(row.get("performance_status"), bool(active_id) and row.get("entry_id") == active_id)
        return r
    out = dict(status)
    if isinstance(out.get("now_performing"), dict):
        out["now_performing"] = one(out["now_performing"])
    for key in LIVE_ENTRY_LISTS:
        out[key] = [one(r) for r in out.get(key) or []]
    return out


@router.get("/api/live-status")
def get_live_status(request: Request):
    status = stage_service.get_live_status()
    # Ensure live event names stay in sync with runtime settings
    status["header_brand_title"] = get_setting("header_brand_title", getattr(settings.event, "header_brand_title", "") or "Event")
    status["header_brand_subtitle"] = get_setting("header_brand_subtitle", getattr(settings.event, "header_brand_subtitle", "Musical Night"))
    status["event_name"] = get_setting("event_name", status.get("event_name"))
    status["event_subtitle"] = get_setting("event_subtitle", status.get("event_subtitle"))
    status["live_display_enabled"] = feature_enabled("live_display_enabled")
    if not status["live_display_enabled"]:
        for key in ("now_performing",):
            status[key] = None
        for key in ("up_next", "upcoming", "performed", "on_hold", "gallery_images"):
            status[key] = []
        status["active_entry_id"] = None

    from fastapi.encoders import jsonable_encoder

    # The live feed is public: never include phone numbers or guardian details.
    serializable_status = strip_private(_redact_live_status(jsonable_encoder(status), status.get("active_entry_id")))
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


@router.put("/api/announcement")
def set_announcement(payload: AnnouncementRequest, _authorized: bool = Depends(verify_admin_pin)):
    from app.services.admin_service import admin_service
    try:
        admin_service.update_settings({"announcement": payload.text})
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return {"text": payload.text.strip()}


@router.get("/api/live-stream")
async def live_stream(request: Request):
    """Server-Sent Events: emits a version number whenever the live schedule changes."""
    from fastapi.responses import StreamingResponse

    async def events():
        queue = live_broadcaster.subscribe()
        try:
            yield "retry: 3000\n\n"
            yield f"data: {live_broadcaster.version}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    version = await asyncio.wait_for(queue.get(), timeout=SSE_KEEPALIVE_SECONDS)
                    yield f"data: {version}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            live_broadcaster.unsubscribe(queue)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/api/set-active/{entry_id}")
def set_active_performance(entry_id: str, _authorized: bool = Depends(require_console_enabled)):
    _run_or_404(event_service.set_active_performance, entry_id)
    return {"status": "success", "active_entry_id": entry_id}


@router.post("/api/clear-active")
def clear_active_performance(_authorized: bool = Depends(require_console_enabled)):
    event_service.clear_active_performance()
    return {"status": "success", "message": "Performance uncued and returned to queue"}


@router.get("/api/track-info/{entry_id}")
def get_track_info(entry_id: str, request: Request):
    target = db_service.get_performance(entry_id)
    if not target:
        raise HTTPException(status_code=404, detail="Performance entry not found")

    meta = audio_service.get_track_metadata(entry_id)
    meta["entry_id"] = entry_id
    meta["performer_name"] = target.get("performer_name")
    meta["song_title"] = target.get("song_title")
    meta["last_updated"] = target.get("last_updated")
    if not is_admin(request):
        meta["performer_name"] = NamePrivacy(db_service.get_all_performances()).name(target.get("performer_name"))
        if meta.get("filename"):
            meta["filename"] = "Backing track"
    return meta


def _entries_response(entries, request: Request) -> JSONResponse:
    """Same shape for everyone except the private keys: admins get them, everyone else gets them absent (not blank).
    Built here rather than by response_model, which would put the removed keys back as null/empty."""
    from fastapi.encoders import jsonable_encoder
    rows = jsonable_encoder([PerformanceEntry.model_validate(e).model_dump() for e in entries])
    if is_admin(request):
        return JSONResponse(content=rows)
    names = NamePrivacy(db_service.get_all_performances())
    public_rows = []
    for r in strip_private(rows):
        # Keep track status for the performer hub, but never expose file names,
        # demographics or free-form tags on unauthenticated responses.
        r = {k: v for k, v in r.items() if k not in ("stage_notes", "age_group", "partner_age_group", "extra_tags", "track_file")}
        r["performer_name"] = names.name(r.get("performer_name"))
        r["partner_name"] = names.partners(r.get("partner_name"))
        if r.get("track_version"):
            r["track_version"] = "available"
        public_rows.append(r)
    return JSONResponse(content=public_rows)


@router.get("/api/performances", response_model=List[PerformanceEntry])
def list_performances(request: Request):
    try:
        return _entries_response(event_service.get_performances(), request)
    except Exception as e:
        logger.exception("Failed to fetch performances: %s", e)
        raise HTTPException(status_code=500, detail="Failed to read performances")


@router.post("/api/export-now")
@router.post("/api/sync")  # pre-rename alias, kept for one release
def sync_data(_authorized: bool = Depends(verify_operator_pin)):
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
        return _entries_response(event_service.get_stage_queue(), request)
    except Exception as e:
        logger.exception("Failed to fetch stage queue: %s", e)
        raise HTTPException(status_code=500, detail="Failed to read queue")


VALID_STATUSES = ("Uploaded", "Upcoming", "Reset", "Performed", "Done", "Skipped", "On Hold", "On Stage", "Live")


@router.patch("/api/status/{entry_id}")
def update_status(entry_id: str, payload: StatusUpdateRequest, _authorized: bool = Depends(require_console_enabled)):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(VALID_STATUSES)}.")
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
            push=payload.should_save_files
        )
        backup_service.trigger_backup()
        return {
            "status": "success",
            "updated_count": updated,
            "is_dirty": db_service.is_sequence_dirty(),
            "files_saved": payload.should_save_files,
            "pushed_to_sheet": payload.should_save_files  # pre-rename alias, kept for one release
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
