import os
import pytest
from app.config import load_config

def test_load_default_config():
    cfg = load_config()
    assert cfg.event.id is not None
    # Everything lives in one event folder: database, exports, tracks, backups, gallery
    assert cfg.storage.event_dir.endswith(cfg.event.id)
    assert cfg.storage.tracks_dir == os.path.join(cfg.storage.event_dir, "tracks")
    assert cfg.storage.gallery_dir == os.path.join(cfg.storage.event_dir, "gallery")
    expected_upload_mb = int(os.getenv("MAX_UPLOAD_SIZE_MB", 100))
    assert cfg.storage.max_upload_size_mb == expected_upload_mb

def test_pin_override(monkeypatch):
    monkeypatch.setenv("ADMIN_PIN", "9999")
    cfg = load_config()
    assert cfg.admin_pin == "9999"

def test_parse_event_datetime_timezones():
    from app.config import parse_event_datetime
    # EDT is -04:00 in September
    iso_edt = parse_event_datetime("09-19-2026 05:00PM", tz_name="America/New_York")
    assert iso_edt == "2026-09-19T17:00:00-04:00"

    # PDT is -07:00 in September
    iso_pdt = parse_event_datetime("09-19-2026 05:00PM", tz_name="America/Los_Angeles")
    assert iso_pdt == "2026-09-19T17:00:00-07:00"

def test_runtime_env_docker_detection(monkeypatch):
    monkeypatch.setenv("RUNTIME_ENV", "docker")
    monkeypatch.delenv("CACHE_DIR", raising=False)
    monkeypatch.setattr("os.makedirs", lambda *args, **kwargs: None)
    cfg = load_config()
    # In docker, /data/cache is preserved when directory creation succeeds
    assert cfg.storage.cache_dir == "/data/cache"
