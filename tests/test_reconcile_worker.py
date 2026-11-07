import threading

from app.config import settings
from app.services.event_service import EventService, event_service
from app.services.event_manager import event_manager
from app.services.track_store import track_store


def test_worker_recovers_after_error_and_stops(monkeypatch):
    service = EventService()
    monkeypatch.setattr("app.services.event_service.RECONCILE_INTERVAL_SECONDS", 0.01)
    calls = []
    completed = threading.Event()
    def reconcile():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("temporary error")
        completed.set()
    monkeypatch.setattr(service, "reconcile_tracks", reconcile)
    service.start_reconcile_worker()
    worker = service._worker
    service.start_reconcile_worker()
    assert service._worker is worker
    try:
        assert completed.wait(2)
    finally:
        service.stop_reconcile_worker()
    assert not worker.is_alive()
    assert len(calls) >= 2


def test_read_does_not_reconcile_but_forced_read_does(monkeypatch):
    service = EventService()
    calls = []
    monkeypatch.setattr(service, "reconcile_tracks", lambda force=False: calls.append(force))
    monkeypatch.setattr("app.services.event_service.db_service.get_all_performances", lambda: [])
    assert service.get_performances() == []
    assert calls == []
    assert service.get_performances(force_sync=True) == []
    assert calls == [True]


def test_event_switch_waits_for_inflight_reconcile(monkeypatch):
    other = event_manager.create_event("Other event", activate=False)["id"]
    original_dir = settings.storage.event_dir
    entered = threading.Event()
    release = threading.Event()
    switched = threading.Event()
    observations = []
    errors = []
    def scan():
        if not entered.is_set():
            entered.set()
            observations.append(settings.storage.event_dir)
            if not release.wait(3):
                raise RuntimeError("test timed out")
            observations.append(settings.storage.event_dir)
        return {}
    monkeypatch.setattr(track_store, "scan", scan)
    def reconcile():
        try:
            event_service.reconcile_tracks(force=True)
        except Exception as exc:
            errors.append(exc)
    def switch():
        try:
            event_manager.activate(other)
            switched.set()
        except Exception as exc:
            errors.append(exc)
    scanner = threading.Thread(target=reconcile)
    changer = threading.Thread(target=switch)
    scanner.start()
    assert entered.wait(2)
    changer.start()
    try:
        assert not switched.wait(0.15)
        assert settings.storage.event_dir == original_dir
    finally:
        release.set()
        scanner.join(3)
        changer.join(3)
    assert not scanner.is_alive() and not changer.is_alive()
    assert not errors
    assert observations == [original_dir, original_dir]
    assert switched.is_set()
    assert settings.event.id == other


def test_worker_adopts_new_track_without_a_read_request(monkeypatch):
    from pathlib import Path
    import time
    from app.services.db_service import db_service

    monkeypatch.setattr("app.services.event_service.RECONCILE_INTERVAL_SECONDS", 0.02)
    entry = db_service.create_performance(performer_name="Singer", song_title="Song")
    import os
    incoming = Path(track_store.incoming_dir, f"{entry}_track.mp3")
    incoming.write_bytes(b"sample track")
    # Model a completed drop: recently modified files are deliberately held
    # for three seconds so a still-writing upload is never adopted.
    stable_time = time.time() - 10
    os.utime(incoming, (stable_time, stable_time))
    service = EventService()
    service.start_reconcile_worker()
    deadline = time.monotonic() + 3
    try:
        while time.monotonic() < deadline:
            if db_service.get_performance(entry)["track_status"] == "Uploaded":
                break
            threading.Event().wait(0.02)
        assert db_service.get_performance(entry)["track_status"] == "Uploaded"
        assert track_store.find(entry) is not None
    finally:
        service.stop_reconcile_worker()


def test_shutdown_timeout_does_not_spawn_overlapping_worker(monkeypatch):
    service = EventService()
    entered = threading.Event()
    release = threading.Event()
    monkeypatch.setattr("app.services.event_service.RECONCILE_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr("app.services.event_service.RECONCILE_JOIN_TIMEOUT_SECONDS", 0.05)
    def blocked():
        entered.set()
        release.wait(2)
    monkeypatch.setattr(service, "reconcile_tracks", blocked)
    service.start_reconcile_worker()
    assert entered.wait(2)
    try:
        worker = service._worker
        service.stop_reconcile_worker()
        assert worker.is_alive()
        assert service._worker is worker
        import pytest
        with pytest.raises(RuntimeError, match="still stopping"):
            service.start_reconcile_worker()
    finally:
        release.set()
        worker.join(2)
        service.stop_reconcile_worker()
    assert not worker.is_alive()


def test_app_lifespan_starts_and_stops_worker():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app):
        worker = event_service._worker
        assert worker is not None and worker.is_alive()
    assert not worker.is_alive()
