import pytest
from fastapi import HTTPException
from downloader.main import validate_media_url, ytdl_match_filter


def test_validate_media_url_valid():
    assert validate_media_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert validate_media_url("https://youtu.be/dQw4w9WgXcQ") == "https://youtu.be/dQw4w9WgXcQ"
    assert validate_media_url("https://music.youtube.com/watch?v=12345") == "https://music.youtube.com/watch?v=12345"
    assert validate_media_url("https://soundcloud.com/artist/track") == "https://soundcloud.com/artist/track"


def test_validate_media_url_ssrf_and_invalid():
    # Intranet / metadata IP
    with pytest.raises(HTTPException) as exc:
        validate_media_url("http://169.254.169.254/latest/meta-data/")
    assert exc.value.status_code == 400

    # Localhost
    with pytest.raises(HTTPException) as exc:
        validate_media_url("http://localhost:8000/api/admin")
    assert exc.value.status_code == 400

    # Non-whitelisted domain
    with pytest.raises(HTTPException) as exc:
        validate_media_url("https://malicious-site.com/payload.mp3")
    assert exc.value.status_code == 400

    # Invalid scheme
    with pytest.raises(HTTPException) as exc:
        validate_media_url("ftp://youtube.com/track")
    assert exc.value.status_code == 400


def test_ytdl_match_filter_duration_and_live():
    # Live stream must be rejected
    res_live = ytdl_match_filter({"is_live": True, "duration": 300})
    assert res_live is not None
    assert "Livestreams are not supported" in res_live

    # Long duration (> 1200s) must be rejected
    res_long = ytdl_match_filter({"is_live": False, "duration": 1800})
    assert res_long is not None
    assert "exceeds the 20-minute maximum limit" in res_long

    # Normal video is accepted
    res_ok = ytdl_match_filter({"is_live": False, "duration": 240})
    assert res_ok is None
