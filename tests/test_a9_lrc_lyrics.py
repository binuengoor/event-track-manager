import os
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.lyrics_service import parse_lrc, lyrics_service


SAMPLE_LRC = """[ti:Kannalane]
[ar:Chithra]
[al:Bombay]

[00:10.50]Kannalane Enadhu Kannai
[00:15.20]Netrodu Engeyo Kaanavillai
[00:22.00]Kattu Pattu Nirkka Villai
[00:27.80]Kaadhal Enbadha Illai Kaamam Enbadha
"""

SAMPLE_MULTI_TAG_LRC = """[00:05.00][00:25.00]Chorus line repeats
[00:12.00]Solo line
"""

SAMPLE_PLAIN_TEXT = """Just plain lyrics
Without any timestamps
Line three
"""


def test_parse_lrc_standard():
    parsed = parse_lrc(SAMPLE_LRC)
    assert parsed["is_timed"] is True
    lines = parsed["lines"]
    assert len(lines) == 4
    assert lines[0]["time"] == 10.5
    assert lines[0]["text"] == "Kannalane Enadhu Kannai"
    assert lines[1]["time"] == 15.2
    assert lines[1]["text"] == "Netrodu Engeyo Kaanavillai"
    assert lines[2]["time"] == 22.0
    assert lines[3]["time"] == 27.8


def test_parse_lrc_multi_tag_and_sorting():
    parsed = parse_lrc(SAMPLE_MULTI_TAG_LRC)
    assert parsed["is_timed"] is True
    lines = parsed["lines"]
    assert len(lines) == 3
    # Sorted by timestamp
    assert lines[0]["time"] == 5.0
    assert lines[0]["text"] == "Chorus line repeats"
    assert lines[1]["time"] == 12.0
    assert lines[1]["text"] == "Solo line"
    assert lines[2]["time"] == 25.0
    assert lines[2]["text"] == "Chorus line repeats"


def test_parse_plain_text_fallback():
    parsed = parse_lrc(SAMPLE_PLAIN_TEXT)
    assert parsed["is_timed"] is False
    assert parsed["lines"] == []
    assert "Just plain lyrics" in parsed["raw"]


def test_lyrics_endpoints_and_storage(tmp_path):
    client = TestClient(app)
    entry_id = "PK-999"

    # 1. Initially no lyrics
    res = client.get(f"/api/lyrics/{entry_id}")
    assert res.status_code == 200
    assert res.json()["has_lyrics"] is False

    # 2. Upload without admin auth -> 401
    res = client.post(f"/api/admin/acts/{entry_id}/lyrics", json={"lyrics": SAMPLE_LRC})
    assert res.status_code == 401

    # 3. Upload with admin auth -> 200
    res = client.post(
        f"/api/admin/acts/{entry_id}/lyrics",
        json={"lyrics": SAMPLE_LRC},
        headers={"X-Admin-PIN": settings.admin_pin}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["is_timed"] is True
    assert len(data["lines"]) == 4

    try:
        # 4. GET /api/lyrics returns the parsed lines
        res = client.get(f"/api/lyrics/{entry_id}")
        assert res.status_code == 200
        get_data = res.json()
        assert get_data["has_lyrics"] is True
        assert get_data["is_timed"] is True
        assert len(get_data["lines"]) == 4
        assert get_data["lines"][0]["text"] == "Kannalane Enadhu Kannai"

        # 5. Admin DELETE lyrics
        res = client.delete(
            f"/api/admin/acts/{entry_id}/lyrics",
            headers={"X-Admin-PIN": settings.admin_pin}
        )
        assert res.status_code == 200
        assert res.json()["status"] == "success"

        # 6. Verify deleted
        res = client.get(f"/api/lyrics/{entry_id}")
        assert res.status_code == 200
        assert res.json()["has_lyrics"] is False
    finally:
        # Cleanup if anything left
        lyrics_service.delete_lyrics(entry_id)
