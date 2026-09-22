import os
import io
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.audio_service import audio_service
from app.services.google_service import google_service, PerformanceEntry

client = TestClient(app)


def test_video_cache_and_media_type(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_service, "cache_dir", str(tmp_path))

    entry_id = "PK-VID-1"
    # Initially, defaults to .mp3 if neither exists
    default_p = audio_service.get_cache_path(entry_id)
    assert default_p.endswith(f"{entry_id}.mp3")
    assert audio_service.get_media_type(entry_id) == "audio"

    # Save a mock MP4 file
    mp4_path = tmp_path / f"{entry_id}.mp4"
    mp4_path.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2mp41\x00\x00\x00\x08free")

    # Now get_cache_path should discover .mp4 automatically
    discovered_p = audio_service.get_cache_path(entry_id)
    assert discovered_p.endswith(f"{entry_id}.mp4")
    assert audio_service.get_media_type(entry_id) == "video"

    # Purge cache removes both .mp4 and .mp3
    purged = audio_service.purge_cache(entry_id)
    assert purged is True
    assert not os.path.exists(discovered_p)


def test_stage_monitor_routes():
    # Direct access to stage monitor
    res = client.get("/console/stage-monitor")
    assert res.status_code == 200
    assert "Stage Confidence Monitor" in res.text
    assert "stage-video" in res.text
    assert "muted" in res.text

    # Redirect /stage-monitor -> /console/stage-monitor
    redirect_res = client.get("/stage-monitor", follow_redirects=False)
    assert redirect_res.status_code == 302
    assert redirect_res.headers["location"] == "/console/stage-monitor"


def test_video_upload_and_stream(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_service, "cache_dir", str(tmp_path))

    # Add a mock performance to google_service
    test_entry = PerformanceEntry(
        entry_id="PK-TEST-VIDEO",
        performer_name="Test Singer",
        song_title="Test Karaoke Video",
        performance_type="Solo",
        track_status="Pending",
        media_type="audio"
    )
    monkeypatch.setattr(google_service, "_mock_data", [test_entry])

    # Upload video file
    video_content = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2mp41\x00\x00\x00\x08free" + b"A" * 1000
    files = {"file": ("karaoke_lyrics.mp4", io.BytesIO(video_content), "video/mp4")}
    data = {
        "entry_id": "PK-TEST-VIDEO",
        "submission_type": "file",
        "media_type": "video"
    }

    res = client.post("/api/upload", data=data, files=files)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "success"
    assert body["media_type"] == "video"
    assert body["filename"].endswith(".mp4")

    # Stream video and verify Content-Type: video/mp4 and range support
    stream_res = client.get("/api/stream/PK-TEST-VIDEO")
    assert stream_res.status_code == 200
    assert "video/mp4" in stream_res.headers["content-type"]
    assert "Accept-Ranges" in stream_res.headers

    # HTTP 206 Partial Content range request
    range_res = client.get("/api/stream/PK-TEST-VIDEO", headers={"Range": "bytes=0-100"})
    assert range_res.status_code == 206
    assert "video/mp4" in range_res.headers["content-type"]
    assert range_res.headers["Content-Length"] == "101"
    assert "bytes 0-100/" in range_res.headers["Content-Range"]


@pytest.mark.asyncio
async def test_video_upload_size_limit(monkeypatch):
    from app.services.audio_workflow_service import audio_workflow_service
    from app.exceptions import FileTooLargeError

    test_entry = PerformanceEntry(
        entry_id="PK-SIZE-TEST",
        performer_name="Test Singer",
        song_title="Test Song",
        performance_type="Solo",
        track_status="Pending"
    )
    monkeypatch.setattr(google_service, "_mock_data", [test_entry])

    class FakeLargeBytes:
        def __len__(self):
            return 501 * 1024 * 1024

    with pytest.raises(FileTooLargeError) as exc_info:
        await audio_workflow_service.process_track_upload(
            entry_id="PK-SIZE-TEST",
            submission_type="file",
            media_type="video",
            file_content=FakeLargeBytes()
        )
    assert "500MB" in str(exc_info.value)


@pytest.mark.asyncio
async def test_downloader_client_media_type_payload(monkeypatch):
    import httpx
    from app.services.downloader_client import downloader_client

    captured_payload = {}

    class MockTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            import json
            nonlocal captured_payload
            captured_payload = json.loads(request.content.decode("utf-8"))
            return httpx.Response(200, json={
                "status": "success",
                "entry_id": captured_payload["entry_id"],
                "title": "Mock Video",
                "file_path": "/data/cache/PK-TEST-YTDL.mp4",
                "file_name": "PK-TEST-YTDL.mp4",
                "media_type": captured_payload["media_type"]
            })

    mock_client = httpx.AsyncClient(transport=MockTransport())
    monkeypatch.setattr(downloader_client, "_get_client", lambda timeout=None: mock_client)

    res = await downloader_client.extract_audio("https://www.youtube.com/watch?v=mock123", "PK-TEST-YTDL", media_type="video")
    assert res["status"] == "success"
    assert res["media_type"] == "video"
    assert captured_payload["media_type"] == "video"
    assert captured_payload["url"] == "https://www.youtube.com/watch?v=mock123"
    assert captured_payload["entry_id"] == "PK-TEST-YTDL"

