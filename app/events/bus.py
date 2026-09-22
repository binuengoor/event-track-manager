import inspect
import logging
from datetime import datetime, timezone
from typing import Callable, Dict, List, Any, Optional

logger = logging.getLogger("event-bus")


class Event:
    """Represents a domain event in the system."""

    def __init__(self, name: str, data: Optional[Dict[str, Any]] = None):
        self.name = name
        self.data = data or {}
        self.timestamp = datetime.now(timezone.utc).isoformat()

    def __repr__(self):
        return f"<Event {self.name} at {self.timestamp}: {self.data}>"


class EventBus:
    """
    Lightweight, in-process publish-subscribe event broker.
    Enables loose coupling across domain boundaries.
    """

    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}

    def subscribe(self, event_name: str, handler: Callable):
        """Registers a callback handler for a specific event name or wildcard '*'."""
        if event_name not in self._subscribers:
            self._subscribers[event_name] = []
        if handler not in self._subscribers[event_name]:
            self._subscribers[event_name].append(handler)
            logger.debug("Subscribed %s to %s", handler.__name__, event_name)

    def unsubscribe(self, event_name: str, handler: Callable):
        """Removes a callback handler from an event."""
        if event_name in self._subscribers and handler in self._subscribers[event_name]:
            self._subscribers[event_name].remove(handler)

    def publish(self, event_name: str, **payload) -> Event:
        """
        Dispatches an event synchronously to all registered listeners.
        Catches listener exceptions to prevent one failure from interrupting the pipeline.
        """
        event = Event(event_name, payload)
        handlers = self._subscribers.get(event_name, []) + self._subscribers.get("*", [])
        for handler in handlers:
            try:
                if inspect.iscoroutinefunction(handler):
                    import asyncio
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(handler(event))
                    except RuntimeError:
                        asyncio.run(handler(event))
                else:
                    handler(event)
            except Exception as ex:
                logger.error("Error executing event handler %s for %s: %s", handler, event_name, ex)
        return event

    def clear(self):
        """Clears all registered subscribers (useful for testing)."""
        self._subscribers.clear()


event_bus = EventBus()
