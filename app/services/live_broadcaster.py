"""Pushes "something changed" to /live viewers (Server-Sent Events) instead of every screen polling every 5 s.

One shared background task checks the live state once per second no matter how many screens are connected,
and tells subscribers only when it actually changes. Clients then fetch /api/live-status once.
"""
import json
import asyncio
import hashlib
import logging
from typing import Set, Optional

from fastapi.encoders import jsonable_encoder

from app.privacy import strip_private
from app.services.stage_service import stage_service

logger = logging.getLogger("live-broadcaster")

CHECK_INTERVAL_SECONDS = 1.0


class LiveBroadcaster:
    def __init__(self):
        self.version = 0
        self._digest: Optional[str] = None
        self._subscribers: Set[asyncio.Queue] = set()
        self._task: Optional[asyncio.Task] = None

    def _snapshot_digest(self) -> str:
        status = strip_private(jsonable_encoder(stage_service.get_live_status()))
        return hashlib.sha1(json.dumps(status, sort_keys=True, default=str).encode()).hexdigest()

    def check_once(self) -> bool:
        """Recomputes the state digest; bumps the version and returns True if it changed."""
        digest = self._snapshot_digest()
        if digest != self._digest:
            first = self._digest is None
            self._digest = digest
            if not first:
                self.version += 1
            return not first
        return False

    async def _loop(self):
        try:
            while self._subscribers:
                try:
                    changed = await asyncio.to_thread(self.check_once)
                except Exception as ex:
                    logger.warning("Live state check failed: %s", ex)
                    changed = False
                if changed:
                    for q in list(self._subscribers):
                        q.put_nowait(self.version)
                await asyncio.sleep(CHECK_INTERVAL_SECONDS)
        finally:
            self._task = None
            self._digest = None

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=8)
        self._subscribers.add(q)
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._loop())
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)


live_broadcaster = LiveBroadcaster()
