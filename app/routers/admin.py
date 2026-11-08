import logging
from typing import Any, Optional
from fastapi import APIRouter, Body, HTTPException, Depends, File, UploadFile
from fastapi.responses import FileResponse

from app.services.admin_service import admin_service
from app.services.backup_service import backup_service
from app.services.readiness_service import readiness_service
from app.services.db_service import db_service
from app.services.export_service import export_service, SnapshotError
from app.services import lineup_service
from app.services.media_asset_service import (
    MediaAssetError, MediaAssetEventChangedError, MediaAssetSharedGalleryError,
    MediaAssetTooLargeError, media_asset_service,
)
from app.exceptions import InvalidAudioError, FileTooLargeError, PerformanceNotFoundError
from app.routers.auth import verify_admin_pin
from app.schemas import AdminParticipantUpdateRequest

logger = logging.getLogger("admin-router")

router = APIRouter(tags=["admin"])


@router.post("/api/admin/poster")
async def upload_admin_poster(file: UploadFile = File(...), _authorized: bool = Depends(verify_admin_pin)):
    try:
        stored = await media_asset_service.upload_poster(file)
    except MediaAssetEventChangedError as ex:
        raise HTTPException(status_code=409, detail=str(ex))
    except MediaAssetTooLargeError as ex:
        raise HTTPException(status_code=413, detail=str(ex))
    except MediaAssetError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return {"status": "success", **stored}


@router.get("/api/admin/gallery")
def get_admin_gallery(_authorized: bool = Depends(verify_admin_pin)):
    return {"files": media_asset_service.gallery_items()}


@router.post("/api/admin/gallery")
async def upload_admin_gallery_file(file: UploadFile = File(...), _authorized: bool = Depends(verify_admin_pin)):
    try:
        stored = await media_asset_service.upload_gallery(file)
    except MediaAssetEventChangedError as ex:
        raise HTTPException(status_code=409, detail=str(ex))
    except MediaAssetSharedGalleryError as ex:
        raise HTTPException(status_code=409, detail=str(ex))
    except MediaAssetTooLargeError as ex:
        raise HTTPException(status_code=413, detail=str(ex))
    except MediaAssetError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return {"status": "success", **stored}


@router.delete("/api/admin/gallery")
def delete_admin_gallery_file(payload: dict = Body(...), _authorized: bool = Depends(verify_admin_pin)):
    try:
        media_asset_service.delete_gallery_file(payload.get("filename"))
    except FileNotFoundError as ex:
        raise HTTPException(status_code=404, detail="Gallery file not found.") from ex
    except MediaAssetSharedGalleryError as ex:
        raise HTTPException(status_code=409, detail=str(ex))
    except MediaAssetError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return {"status": "success"}


@router.put("/api/admin/gallery/order")
def order_admin_gallery(payload: dict = Body(...), _authorized: bool = Depends(verify_admin_pin)):
    try:
        media_asset_service.set_gallery_order(payload.get("filenames"))
    except MediaAssetSharedGalleryError as ex:
        raise HTTPException(status_code=409, detail=str(ex))
    except MediaAssetError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return {"status": "success", "files": media_asset_service.gallery_items()}


@router.get("/api/admin/settings")
def get_admin_settings(_authorized: bool = Depends(verify_admin_pin)):
    return admin_service.get_settings()


@router.get("/api/admin/readiness")
async def get_readiness(_authorized: bool = Depends(verify_admin_pin)):
    """Checklist of things that would hurt on event day (PIN, storage, tracks, downloader, backups)."""
    return await readiness_service.run()


@router.get("/api/admin/presets")
def list_presets(_authorized: bool = Depends(verify_admin_pin)):
    """Preset catalog with a preview of the changes each one would make right now."""
    return admin_service.list_presets()


@router.get("/api/admin/food-templates")
def list_food_templates(_authorized: bool = Depends(verify_admin_pin)):
    return admin_service.FOOD_TEMPLATES


@router.post("/api/admin/food-items/bulk")
def bulk_add_food_items(body: dict = Body(...), _authorized: bool = Depends(verify_admin_pin)):
    try:
        return admin_service.bulk_add_food(str(body.get("text", "")), str(body.get("default_group") or "Potluck"))
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.post("/api/admin/apply-preset")
def apply_preset(body: dict = Body(...), _authorized: bool = Depends(verify_admin_pin)):
    preset = body.get("preset", "")
    try:
        return admin_service.apply_preset(preset)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.put("/api/admin/settings")
def update_admin_settings(payload: Any = Body(...), _authorized: bool = Depends(verify_admin_pin)):
    items = payload.get("settings", payload) if isinstance(payload, dict) else {}
    try:
        count = admin_service.update_settings(items)
        return {"status": "success", "updated_count": count}
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.get("/api/admin/summary")
def get_admin_summary(_authorized: bool = Depends(verify_admin_pin)):
    return admin_service.get_summary()


@router.get("/api/admin/backup-status")
def get_backup_status_endpoint(_authorized: bool = Depends(verify_admin_pin)):
    return backup_service.get_backup_status()


@router.post("/api/admin/backup-now")
async def trigger_immediate_backup(_authorized: bool = Depends(verify_admin_pin)):
    return await backup_service.backup_now(force=True)


@router.get("/api/admin/roster")
def list_admin_roster(_authorized: bool = Depends(verify_admin_pin)):
    """Returns canonical participants roster with attached performances and food signups."""
    return db_service.get_all_participants()


@router.get("/api/admin/participants")
def list_admin_participants(_authorized: bool = Depends(verify_admin_pin)):
    """Returns all performances/participants directly from SQLite with food signup details."""
    return admin_service.list_participants_with_food()


@router.put("/api/admin/participants/{entry_id}")
def update_admin_participant(entry_id: str, payload: AdminParticipantUpdateRequest, _authorized: bool = Depends(verify_admin_pin)):
    """Updates participant details directly in SQLite and triggers debounced backup."""
    dump_dict = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    try:
        return admin_service.update_participant(entry_id, dump_dict)
    except PerformanceNotFoundError as ex:
        raise HTTPException(status_code=404, detail=str(ex))
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.delete("/api/admin/participants/{entry_id}")
async def delete_admin_participant(entry_id: str, _authorized: bool = Depends(verify_admin_pin)):
    """Deletes a participant performance from SQLite and triggers backup."""
    async with lineup_service.audio_workflow_service.lock_entry(entry_id):
        try:
            return await lineup_service.audio_workflow_service.run_thread_to_completion(
                admin_service.delete_participant, entry_id)
        except PerformanceNotFoundError as ex:
            raise HTTPException(status_code=404, detail=str(ex))


@router.get("/api/admin/activity-logs")
def get_admin_activity_logs(
    days: Optional[int] = 7,
    limit: int = 200,
    search: str = "",
    action_type: str = "",
    _authorized: bool = Depends(verify_admin_pin)
):
    """Returns activity audit log entries with optional days, search, and action filters."""
    return db_service.get_activity_logs(
        days=days,
        limit=limit,
        search=search,
        action_type=action_type
    )


# --------------------------------------------------------------------------- database snapshots
@router.get("/api/admin/snapshots")
def list_snapshots(_authorized: bool = Depends(verify_admin_pin)):
    return export_service.list_snapshots()


@router.get("/api/admin/snapshots/{name}/download")
def download_snapshot(name: str, _authorized: bool = Depends(verify_admin_pin)):
    try:
        path = export_service.snapshot_path(name)
    except SnapshotError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Snapshot not found.")
    return FileResponse(path, media_type="application/octet-stream", filename=name,
                        headers={"Cache-Control": "no-store"})


@router.post("/api/admin/snapshots/{name}/restore")
def restore_snapshot(name: str, _authorized: bool = Depends(verify_admin_pin)):
    """Replaces the live database with a snapshot; a safety snapshot of the current data is taken first."""
    try:
        result = export_service.restore_snapshot(name)
    except SnapshotError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Snapshot not found.")
    db_service.log_activity(action_type="snapshot_restore", performer_name="", source="admin", role="admin",
                            summary=f"Restored database snapshot {name} (safety copy {result['safety_snapshot']})")
    return {"status": "success", **result}


# --------------------------------------------------------------------------- lineup helpers
@router.get("/api/admin/incoming")
def list_incoming_files(_authorized: bool = Depends(verify_admin_pin)):
    """Files waiting in incoming/ that are not attached to an act yet."""
    return {"files": lineup_service.list_incoming()}


@router.post("/api/admin/tracks/{entry_id}/restore")
def restore_previous_track(entry_id: str, _authorized: bool = Depends(verify_admin_pin)):
    """Brings back the newest archived previous track of an act (the current one is archived, not deleted)."""
    try:
        result = lineup_service.restore_previous_track(entry_id)
    except lineup_service.NoArchivedTrackError:
        raise HTTPException(status_code=404, detail="There is no earlier track archived for this act.")
    if result is None:
        raise HTTPException(status_code=404, detail="Entry not found.")
    return result


@router.post("/api/admin/acts")
def add_admin_act(payload: dict = Body(...), _authorized: bool = Depends(verify_admin_pin)):
    try:
        return lineup_service.add_act(payload)
    except lineup_service.LineupActionError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.delete("/api/admin/acts/{entry_id}")
async def delete_admin_act(entry_id: str, _authorized: bool = Depends(verify_admin_pin)):
    async with lineup_service.audio_workflow_service.lock_entry(entry_id):
        def delete_locked():
            perf = db_service.get_performance(entry_id)
            if not perf:
                raise HTTPException(status_code=404, detail="Act not found.")
            archived_tracks = lineup_service.track_store.archive_existing(entry_id)
            try:
                return admin_service.delete_participant(entry_id)
            except PerformanceNotFoundError as ex:
                if db_service.get_performance(entry_id) is not None:
                    lineup_service.restore_archived_tracks(archived_tracks)
                raise HTTPException(status_code=404, detail=str(ex))
            except Exception:
                # admin_service can fail after the DELETE committed (for example while logging).
                # In that case the performance.deleted listener has also archived the track;
                # restoring it would leave an orphaned live track with no performance row.
                if db_service.get_performance(entry_id) is not None:
                    lineup_service.restore_archived_tracks(archived_tracks)
                raise

        return await lineup_service.audio_workflow_service.run_thread_to_completion(delete_locked)


@router.post("/api/admin/acts/{entry_id}/track")
async def replace_admin_act_track(entry_id: str, file: UploadFile = File(...),
                                  _authorized: bool = Depends(verify_admin_pin)):
    try:
        return await lineup_service.replace_track(entry_id, file)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Act not found.")
    except lineup_service.LineupActionError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except InvalidAudioError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except FileTooLargeError as ex:
        raise HTTPException(status_code=413, detail=str(ex))
    except PerformanceNotFoundError as ex:
        raise HTTPException(status_code=404, detail=str(ex))


@router.post("/api/admin/acts/{entry_id}/match")
async def match_admin_act_track(entry_id: str, payload: dict = Body(...), _authorized: bool = Depends(verify_admin_pin)):
    async with lineup_service.audio_workflow_service.lock_entry(entry_id):
        try:
            return await lineup_service.audio_workflow_service.run_thread_to_completion(
                lineup_service.match_incoming, entry_id, str(payload.get("filename") or ""))
        except FileNotFoundError as ex:
            if db_service.get_performance(entry_id) is None:
                raise HTTPException(status_code=404, detail="Act not found.")
            raise HTTPException(status_code=404, detail="Incoming file not found.") from ex
        except lineup_service.LineupActionError as ex:
            raise HTTPException(status_code=400, detail=str(ex))
