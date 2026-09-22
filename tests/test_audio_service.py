import os
import zipfile
import pytest
from app.services.audio_service import sanitize_filename, audio_service

def test_sanitize_filename():
    assert sanitize_filename("Rahul Nair / Tum Hi Ho!") == "Rahul_Nair_Tum_Hi_Ho"
    assert sanitize_filename("Aayiram Kannumai (Karaoke)") == "Aayiram_Kannumai_Karaoke"
    assert sanitize_filename("Track #01 - Duet") == "Track_01_Duet"

def test_save_and_ensure_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_service, "cache_dir", str(tmp_path))
    content = b"TEST_AUDIO_STREAM_DATA"
    path = audio_service.save_upload_to_cache("PK-TEST", content)
    assert os.path.isfile(path)
    with open(path, "rb") as f:
        assert f.read() == content

def test_stream_file_range(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_service, "cache_dir", str(tmp_path))
    test_file = tmp_path / "test.mp3"
    test_data = b"0123456789" * 10  # 100 bytes
    test_file.write_bytes(test_data)

    # Full content without Range header
    res = audio_service.stream_file_range(str(test_file), None)
    assert res.status_code == 200
    assert res.headers["Content-Length"] == "100"

    # Partial range: bytes=0-49
    res_range = audio_service.stream_file_range(str(test_file), "bytes=0-49")
    assert res_range.status_code == 206
    assert res_range.headers["Content-Length"] == "50"
    assert res_range.headers["Content-Range"] == "bytes 0-49/100"

def test_export_sequenced_zip():
    buf, filename = audio_service.export_sequenced_zip()
    assert filename.startswith("Paattukoottam_Stage_Tracks_")
    assert filename.endswith(".zip")
    
    with zipfile.ZipFile(buf, "r") as zf:
        namelist = zf.namelist()
        assert "00_SEQUENCE_MANIFEST.txt" in namelist


def test_prune_cache_if_needed(tmp_path, monkeypatch):
    import time
    monkeypatch.setattr(audio_service, "cache_dir", str(tmp_path))

    # 1. Create a stale transcode artifact
    stale_transcode = tmp_path / "PK-OLD.transcode.mp4"
    stale_transcode.write_bytes(b"temp transcode data")
    # artificially set mtime to 2 hours ago
    past_time = time.time() - 7200
    os.utime(str(stale_transcode), (past_time, past_time))

    # 2. Create normal cache files
    f1 = tmp_path / "PK-001.mp3"
    f1.write_bytes(b"x" * 1024 * 1024)  # 1MB
    os.utime(str(f1), (past_time, past_time))

    f2 = tmp_path / "PK-002.mp3"
    f2.write_bytes(b"y" * 1024 * 1024)  # 1MB

    # Prune with a low max_size of 1.5MB and target 0.5MB
    deleted = audio_service.prune_cache_if_needed(max_size_mb=1, target_size_mb=1)
    assert deleted >= 1
    # stale transcode must have been removed
    assert not stale_transcode.exists()

