import asyncio
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.db_service import db_service
from app.services.event_service import event_service
from app.services.live_broadcaster import LiveBroadcaster

ADMIN = {"X-Admin-PIN": settings.admin_pin}


def _perf(name="Live Singer"):
    return db_service.create_performance(performer_name=name, song_title="Song", performance_type="Solo", contact_info="6105550100")


def test_digest_is_stable_until_the_schedule_changes():
    eid = _perf()
    b = LiveBroadcaster()
    assert b.check_once() is False          # first look just records the baseline
    assert b.check_once() is False          # nothing changed
    event_service.set_active_performance(eid)
    assert b.check_once() is True and b.version == 1   # cue -> change
    assert b.check_once() is False
    event_service.update_status(eid, "Performed")
    event_service.clear_active_performance()
    assert b.check_once() is True and b.version == 2


def test_digest_never_includes_phone_numbers():
    _perf()
    b = LiveBroadcaster()
    from fastapi.encoders import jsonable_encoder
    import json
    from app.services.stage_service import stage_service
    from app.privacy import strip_private
    assert "6105550100" not in json.dumps(strip_private(jsonable_encoder(stage_service.get_live_status())))


@pytest.mark.asyncio
async def test_subscribers_are_notified_once_and_the_loop_stops_when_nobody_listens(monkeypatch):
    import app.services.live_broadcaster as lb
    monkeypatch.setattr(lb, "CHECK_INTERVAL_SECONDS", 0.05)
    eid = _perf()
    b = LiveBroadcaster()
    q = b.subscribe()
    await asyncio.sleep(0.2)                       # baseline taken
    event_service.set_active_performance(eid)
    version = await asyncio.wait_for(q.get(), timeout=2)
    assert version == 1
    await asyncio.sleep(0.2)
    assert q.empty()                               # no spurious pings
    b.unsubscribe(q)
    await asyncio.sleep(0.2)
    assert b._task is None or b._task.done()      # background check ends with the last viewer


@pytest.mark.asyncio
async def test_stream_endpoint_sends_retry_hint_then_current_version_and_cleans_up(monkeypatch):
    import app.routers.stage as stage_router
    monkeypatch.setattr(stage_router, "SSE_KEEPALIVE_SECONDS", 0.05)
    from app.routers.stage import live_stream
    from app.services.live_broadcaster import live_broadcaster

    class FakeRequest:
        calls = 0
        async def is_disconnected(self):
            FakeRequest.calls += 1
            return FakeRequest.calls > 1          # the client goes away after the first loop turn

    res = await live_stream(FakeRequest())
    assert res.media_type == "text/event-stream"
    assert res.headers["cache-control"] == "no-cache"
    chunks = [c async for c in res.body_iterator]
    assert chunks[0] == "retry: 3000\n\n"
    assert chunks[1].startswith("data: ")
    assert chunks[2] == ": keepalive\n\n"
    assert not live_broadcaster._subscribers      # unsubscribed in `finally`
