import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.config import get_setting, settings
from app.routers.auth import verify_admin_pin
from app.services.backup_service import backup_service
from app.services.datasets import build_datasets, event_kind
from app.services.db_service import db_service
from app.services.export_service import export_service, DOWNLOAD_FORMATS

logger = logging.getLogger("data-router")

router = APIRouter(tags=["data"])


class PaymentUpdate(BaseModel):
    participant_id: str
    paid: bool
    note: Optional[str] = None


class PaymentSaveRequest(BaseModel):
    updates: List[PaymentUpdate]


@router.get("/api/admin/data")
async def get_event_data(_authorized: bool = Depends(verify_admin_pin)):
    """All tables for the admin viewer. Also refreshes signups.xlsx/csv in the event folder."""
    exported = None
    try:
        exported = await asyncio.to_thread(export_service.export_now, False)
    except Exception as ex:
        logger.warning("Refreshing the export on admin load failed: %s", ex)
    tables = await asyncio.to_thread(build_datasets)
    return {
        "event_id": get_setting("event_id", settings.event.id),
        "event_name": get_setting("event_name", settings.event.name),
        "kind": event_kind(),
        "tables": tables,
        "formats": {k: v[0] for k, v in DOWNLOAD_FORMATS.items()},
        "exported_files": exported["files"] if exported else [],
    }


@router.get("/api/admin/data/download")
async def download_event_data(format: str = "xlsx", sheet: str = "", _authorized: bool = Depends(verify_admin_pin)):
    try:
        content, media_type, filename = await asyncio.to_thread(export_service.render_download, format, sheet)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})


@router.get("/api/admin/payments")
async def list_payments(_authorized: bool = Depends(verify_admin_pin)):
    """Alphabetical list of everyone who sings (performers and duet partners) with a paid flag."""
    if not event_kind()["stage"]:
        return {"enabled": False, "singers": [], "paid": 0, "total": 0}
    singers = db_service.get_singers()
    paid = sum(1 for s in singers if s["paid"])
    return {"enabled": True, "singers": singers, "paid": paid, "total": len(singers)}


@router.put("/api/admin/payments")
async def save_payments(payload: PaymentSaveRequest, _authorized: bool = Depends(verify_admin_pin)):
    if not event_kind()["stage"]:
        raise HTTPException(status_code=400, detail="Payments are tracked for events with stage performances.")
    changed = db_service.set_paid([u.model_dump() for u in payload.updates])
    backup_service.trigger_backup()
    db_service.log_activity(action_type="admin_edit", performer_name="Admin",
                            summary=f"Updated payment status for {changed} singer(s)", source="admin")
    singers = db_service.get_singers()
    return {"status": "success", "changed": changed, "paid": sum(1 for s in singers if s["paid"]), "total": len(singers)}
