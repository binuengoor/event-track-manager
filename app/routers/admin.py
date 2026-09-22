import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request

from app.services.admin_service import admin_service
from app.services.backup_service import backup_service
from app.services.db_service import db_service
from app.routers.auth import verify_admin_pin
from app.schemas import AdminParticipantUpdateRequest
from app.exceptions import PerformanceNotFoundError

logger = logging.getLogger("admin-router")

router = APIRouter(tags=["admin"])


@router.get("/api/admin/settings")
async def get_admin_settings(_authorized: bool = Depends(verify_admin_pin)):
    return admin_service.get_settings()


@router.post("/api/admin/apply-preset")
async def apply_preset(request: Request, _authorized: bool = Depends(verify_admin_pin)):
    body = await request.json()
    preset = body.get("preset", "")
    try:
        return admin_service.apply_preset(preset)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.put("/api/admin/settings")
async def update_admin_settings(request: Request, _authorized: bool = Depends(verify_admin_pin)):
    payload = await request.json()
    items = payload.get("settings", payload) if isinstance(payload, dict) else {}
    try:
        count = admin_service.update_settings(items)
        return {"status": "success", "updated_count": count}
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.get("/api/admin/summary")
async def get_admin_summary(_authorized: bool = Depends(verify_admin_pin)):
    return admin_service.get_summary()


@router.get("/api/admin/backup-status")
async def get_backup_status_endpoint(_authorized: bool = Depends(verify_admin_pin)):
    return backup_service.get_backup_status()


@router.post("/api/admin/backup-now")
async def trigger_immediate_backup(_authorized: bool = Depends(verify_admin_pin)):
    return await backup_service.backup_now()


@router.get("/api/admin/roster")
async def list_admin_roster(_authorized: bool = Depends(verify_admin_pin)):
    """Returns canonical participants roster with attached performances and food signups."""
    return db_service.get_all_participants()


@router.get("/api/admin/participants")
async def list_admin_participants(_authorized: bool = Depends(verify_admin_pin)):
    """Returns all performances/participants directly from SQLite with food signup details."""
    return admin_service.list_participants_with_food()


@router.put("/api/admin/participants/{entry_id}")
async def update_admin_participant(entry_id: str, payload: AdminParticipantUpdateRequest, _authorized: bool = Depends(verify_admin_pin)):
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
    try:
        return admin_service.delete_participant(entry_id)
    except PerformanceNotFoundError as ex:
        raise HTTPException(status_code=404, detail=str(ex))


@router.get("/api/admin/activity-logs")
async def get_admin_activity_logs(
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
