import pytest
from app.config import load_config

def test_load_default_config():
    cfg = load_config()
    assert cfg.event.id is not None
    assert cfg.columns.entry_id == -1  # auto-generated
    assert cfg.columns.performer_name == 0
    assert cfg.columns.song_title == 8
    assert cfg.columns.sequence_order == 6
    assert cfg.columns.track_status == 11
    assert cfg.columns.drive_file_id == 13
    assert cfg.storage.max_upload_size_mb == 200

def test_pin_override(monkeypatch):
    monkeypatch.setenv("ADMIN_PIN", "9999")
    cfg = load_config()
    assert cfg.admin_pin == "9999"
