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
    event_dir = tmp_path / "event"
    for sub in ("tracks", "incoming", "backups", "gallery", "scratch"):
        (event_dir / sub).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings.storage, "cache_dir", str(event_dir / "scratch"))
    monkeypatch.setattr(settings.storage, "event_dir", str(event_dir))
    monkeypatch.setattr(settings.storage, "tracks_dir", str(event_dir / "tracks"))
    monkeypatch.setattr(settings.storage, "gallery_dir", str(event_dir / "gallery"))
    from app.services.audio_service import audio_service
    monkeypatch.setattr(audio_service, "cache_dir", str(event_dir / "scratch"))
    
    # Re-point db_service to the test event folder's database (same file the default manager resolves to)
    test_db_file = event_dir / "event.db"
    original_db_path = db_service._db_path
    db_service._db_path = str(test_db_file)
    db_service._ensure_db()

    from app.events.listeners import register_default_listeners
    register_default_listeners()

    # Failed-login throttling is process-global; start every test with a clean slate.
    from app.routers.auth import failure_limiter
    failure_limiter.reset()

    yield
    
    # Restore original states
    db_service._db_path = original_db_path
