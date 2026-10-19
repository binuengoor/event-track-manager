import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.routers.auth import verify_admin_pin
from app.services.event_manager import event_manager, EventManagerError

logger = logging.getLogger("events-router")

router = APIRouter(tags=["events"])


class CreateEventRequest(BaseModel):
    name: str
    start_time: Optional[str] = ""
    venue: Optional[str] = ""
    subtitle: Optional[str] = ""
    copy_from: Optional[str] = "current"     # "current", "none", or an existing event id
    activate: bool = True


class ClearMediaRequest(BaseModel):
    confirm: str                              # must equal the event id (typed by the admin)


def _bad_request(ex: EventManagerError):
    return HTTPException(status_code=400, detail=str(ex))


@router.get("/api/admin/events")
async def list_events(_authorized: bool = Depends(verify_admin_pin)):
    events = await asyncio.to_thread(event_manager.list_events)
    return {"switching_enabled": event_manager.switching_enabled(), "active": event_manager.active_id(), "events": events}


@router.post("/api/admin/events")
async def create_event(payload: CreateEventRequest, _authorized: bool = Depends(verify_admin_pin)):
    try:
        event = await asyncio.to_thread(
            event_manager.create_event, payload.name, payload.start_time or "", payload.venue or "",
            payload.subtitle or "", payload.copy_from or "current", payload.activate)
    except EventManagerError as ex:
        raise _bad_request(ex)
    return {"status": "success", "event": event, "active": event_manager.active_id()}


@router.post("/api/admin/events/{event_id}/activate")
async def activate_event(event_id: str, _authorized: bool = Depends(verify_admin_pin)):
    try:
        result = await asyncio.to_thread(event_manager.activate, event_id)
    except EventManagerError as ex:
        raise _bad_request(ex)
    return {"status": "success", **result}


@router.post("/api/admin/events/{event_id}/clear-media")
async def clear_event_media(event_id: str, payload: ClearMediaRequest, _authorized: bool = Depends(verify_admin_pin)):
    """Deletes this event's audio/video files to free disk space. Records are kept."""
    if payload.confirm.strip() != event_id:
        raise HTTPException(status_code=400, detail="Type the event id to confirm.")
    try:
        result = await asyncio.to_thread(event_manager.clear_media, event_id)
    except EventManagerError as ex:
        raise _bad_request(ex)
    return {"status": "success", **result}
