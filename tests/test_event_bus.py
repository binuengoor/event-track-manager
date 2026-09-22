import pytest
import asyncio
from app.events.bus import EventBus, Event


def test_event_bus_subscribe_and_publish():
    bus = EventBus()
    received = []

    def handler(event: Event):
        received.append(event)

    bus.subscribe("test.event", handler)
    bus.publish("test.event", message="hello world", count=42)

    assert len(received) == 1
    assert received[0].name == "test.event"
    assert received[0].data["message"] == "hello world"
    assert received[0].data["count"] == 42


def test_event_bus_wildcard_subscriber():
    bus = EventBus()
    received = []

    def wildcard_handler(event: Event):
        received.append(event.name)

    bus.subscribe("*", wildcard_handler)
    bus.publish("order.created", id=1)
    bus.publish("user.signup", username="alice")

    assert received == ["order.created", "user.signup"]


def test_event_bus_unsubscribe():
    bus = EventBus()
    received = []

    def handler(event: Event):
        received.append(event)

    bus.subscribe("my.event", handler)
    bus.publish("my.event", val=1)
    assert len(received) == 1

    bus.unsubscribe("my.event", handler)
    bus.publish("my.event", val=2)
    assert len(received) == 1


def test_event_bus_exception_isolation():
    bus = EventBus()
    success_received = []

    def failing_handler(event: Event):
        raise ValueError("Handler crashed!")

    def passing_handler(event: Event):
        success_received.append(event.data.get("status"))

    bus.subscribe("test.fail", failing_handler)
    bus.subscribe("test.fail", passing_handler)

    # Should not raise exception
    bus.publish("test.fail", status="survived")
    assert success_received == ["survived"]


@pytest.mark.asyncio
async def test_event_bus_async_handler():
    bus = EventBus()
    results = []

    async def async_handler(event: Event):
        await asyncio.sleep(0.01)
        results.append(event.data["val"])

    bus.subscribe("async.event", async_handler)
    bus.publish("async.event", val=99)

    # Give the background task a moment to run
    await asyncio.sleep(0.05)
    assert results == [99]


def test_domain_events_rename_and_delete(monkeypatch):
    from app.events.bus import event_bus
    from app.services.db_service import db_service
    from app.services.audio_service import audio_service

    purged_entries = []
    monkeypatch.setattr(audio_service, "purge_cache", lambda entry_id: purged_entries.append(entry_id))

    # Test performance delete event
    event_bus.publish("performance.deleted", entry_id="PK-999")
    assert "PK-999" in purged_entries

    # Test performer rename event cascades to food signups
    g_id = db_service.add_food_group("Event Bus Group")
    i_id = db_service.add_food_item("Event Bus Dish", g_id)
    db_service.claim_food_item(i_id, "Old Singer", "Biryani")

    event_bus.publish("performer.renamed", old_name="Old Singer", new_name="New Singer")
    fs = db_service.get_food_signup_for_signer("New Singer")
    assert fs is not None
    assert fs["signer_name"] == "New Singer"
