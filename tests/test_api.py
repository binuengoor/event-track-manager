import io
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings

def test_health_check():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert data["app"] == "event-track-manager"

def test_event_info():
    client = TestClient(app)
    res = client.get("/api/event-info")
    assert res.status_code == 200
    data = res.json()
    assert "event_name" in data
    assert "event_id" in data
    assert "poster_url" in data
    assert "venue" in data
    assert "event_start_time_iso" in data
    assert data["poster_url"] == "/data/paattukoottam_animated.gif"

def test_landing_and_tracks_pages():
    client = TestClient(app)
    # Landing page at root /
    res_root = client.get("/")
    assert res_root.status_code == 200
    assert "Sing & Serenade" in res_root.text
    assert "Upload Tracks" in res_root.text
    assert "Live Program" in res_root.text
    assert "Console" in res_root.text

    # Tracks page at /tracks
    res_tracks = client.get("/tracks")
    assert res_tracks.status_code == 200
    assert "Upload Your Backing Track" in res_tracks.text

    # Redirects for /upload and /intake
    res_up = client.get("/upload", follow_redirects=False)
    assert res_up.status_code in (302, 307)
    assert res_up.headers["location"] == "/tracks"

    res_in = client.get("/intake", follow_redirects=False)
    assert res_in.status_code in (302, 307)
    assert res_in.headers["location"] == "/tracks"

def test_data_static_serving():
    import os
    from app.main import DATA_DIR
    test_file = os.path.join(DATA_DIR, "test_banner.txt")
    with open(test_file, "w") as f:
        f.write("banner content")
    try:
        client = TestClient(app)
        res = client.get("/data/test_banner.txt")
        assert res.status_code == 200
        assert res.text == "banner content"
    finally:
        if os.path.exists(test_file):
            os.remove(test_file)

def test_list_performances():
    client = TestClient(app)
    res = client.get("/api/performances")
    assert res.status_code == 200
    items = res.json()
    assert isinstance(items, list)
    assert len(items) > 0
    first = items[0]
    assert "entry_id" in first
    assert "performer_name" in first
    assert "song_title" in first

def test_stage_queue():
    client = TestClient(app)
    res = client.get("/api/stage-queue")
    assert res.status_code == 200
    items = res.json()
    assert isinstance(items, list)
    assert len(items) > 0
    seq_orders = [x["sequence_order"] for x in items]
    assert seq_orders == sorted(seq_orders)

def test_admin_auth():
    client = TestClient(app)
    # Invalid PIN
    res_fail = client.post("/api/auth/login", json={"pin": "wrong_pin"})
    assert res_fail.status_code == 401

    # Valid PIN
    res_ok = client.post("/api/auth/login", json={"pin": settings.admin_pin})
    assert res_ok.status_code == 200
    assert res_ok.json()["status"] == "success"

def test_upload_and_stream():
    client = TestClient(app)
    # Get first available entry
    perf_res = client.get("/api/performances")
    first_id = perf_res.json()[0]["entry_id"]

    # Direct audio file upload
    file_content = b"ID3" + b"\x00" * 200
    res = client.post(
        "/api/upload",
        data={"entry_id": first_id, "submission_type": "file"},
        files={"file": ("test_track.mp3", io.BytesIO(file_content), "audio/mpeg")}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["entry_id"] == first_id

    # Now stream the track
    stream_res = client.get(f"/api/stream/{first_id}")
    assert stream_res.status_code == 200
    assert stream_res.headers["Content-Type"] == "audio/mpeg"

def test_status_update_with_auth():
    client = TestClient(app)
    perf_res = client.get("/api/performances")
    first_id = perf_res.json()[0]["entry_id"]

    # Unauthorized request without PIN header or cookie
    res_unauth = client.patch(f"/api/status/{first_id}", json={"status": "Performed"})
    assert res_unauth.status_code == 401

    # Authorized via header
    res_auth = client.patch(
        f"/api/status/{first_id}",
        json={"status": "Performed"},
        headers={"X-Admin-PIN": settings.admin_pin}
    )
    assert res_auth.status_code == 200
    assert res_auth.json()["new_status"] == "Performed"

def test_export_zip_with_auth():
    client = TestClient(app)
    # Unauthorized
    res_unauth = client.get("/api/export-zip")
    assert res_unauth.status_code == 401

    # Authorized
    res = client.get("/api/export-zip", headers={"X-Admin-PIN": settings.admin_pin})
    assert res.status_code == 200
    assert res.headers["Content-Type"] == "application/zip"
    assert len(res.content) > 0

def test_staged_reorder_and_push_sequence():
    client = TestClient(app)
    perf_res = client.get("/api/performances")
    items = perf_res.json()
    assert len(items) >= 2
    
    first_id = items[0]["entry_id"]
    second_id = items[1]["entry_id"]

    # Reorder staged locally (push_to_sheet=False)
    reorder_payload = {
        "items": [
            {"entry_id": first_id, "sequence_order": 2},
            {"entry_id": second_id, "sequence_order": 1}
        ],
        "push_to_sheet": False
    }
    res_reorder = client.post(
        "/api/reorder-queue",
        json=reorder_payload,
        headers={"X-Admin-PIN": settings.admin_pin}
    )
    assert res_reorder.status_code == 200
    data = res_reorder.json()
    assert data["status"] == "success"
    assert data["pushed_to_sheet"] is False

    # Check live status returns is_dirty=True
    live_res = client.get("/api/live-status")
    assert live_res.status_code == 200
    assert live_res.json()["is_dirty"] is True

    # Now explicitly push sequence to sheet
    push_res = client.post(
        "/api/push-sequence",
        headers={"X-Admin-PIN": settings.admin_pin}
    )
    assert push_res.status_code == 200
    push_data = push_res.json()
    assert push_data["status"] == "success"

    # Dirty flag should now be False
    live_res2 = client.get("/api/live-status")
    assert live_res2.status_code == 200
    assert live_res2.json()["is_dirty"] is False
