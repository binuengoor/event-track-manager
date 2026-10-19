import os
import shutil
import pytest
from app.config import settings
from app.services.db_service import db_service

@pytest.fixture(autouse=True)
def isolate_test_db(tmp_path, monkeypatch):
    """
    Ensures every test runs against a clean, isolated SQLite database in a temp directory,
    preventing any test pollution from touching production or host databases.
    """
    # Isolate storage settings
    events_root = tmp_path / "events"
    event_dir = events_root / "test-event"
    for sub in ("tracks", "incoming", "backups", "gallery", "scratch"):
        (event_dir / sub).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings.storage, "cache_dir", str(event_dir / "scratch"))
    monkeypatch.setattr(settings.storage, "events_dir", str(events_root))
    monkeypatch.setattr(settings.event, "id", "test-event")
    monkeypatch.setattr(settings.storage, "event_dir", str(event_dir))
    monkeypatch.setattr(settings.storage, "tracks_dir", str(event_dir / "tracks"))
    monkeypatch.setattr(settings.storage, "gallery_dir", str(event_dir / "gallery"))
    from app.services.audio_service import audio_service
    monkeypatch.setattr(audio_service, "cache_dir", str(event_dir / "scratch"))
    
    # db_service resolves <event_dir>/event.db on every call, so patching settings above is enough (no pinned path);
    # that also lets tests exercise real event switching.
    db_service.db_manager.close_all()
    db_service._ensure_db()

    from app.events.listeners import register_default_listeners
    register_default_listeners()

    # Failed-login throttling is process-global; start every test with a clean slate.
    from app.routers.auth import failure_limiter
    failure_limiter.reset()

    yield
    
    db_service.db_manager.close_all()
