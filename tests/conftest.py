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
    test_db_dir = tmp_path / "test_cache"
    test_db_dir.mkdir(parents=True, exist_ok=True)
    test_db_file = test_db_dir / "event_data.db"
    
    # Isolate storage settings
    monkeypatch.setattr(settings.storage, "cache_dir", str(test_db_dir))
    
    # Re-point db_service to test db
    original_db_path = db_service._db_path
    db_service._db_path = str(test_db_file)
    db_service._ensure_db()
    
    yield
    
    # Restore original db_path
    db_service._db_path = original_db_path
