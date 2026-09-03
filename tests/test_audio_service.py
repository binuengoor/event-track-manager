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
