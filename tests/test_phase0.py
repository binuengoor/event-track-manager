"""Phase 0 (fixes and public-internet hardening). Each test failed before its fix."""
import asyncio
import io
import json
import os
import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.main import app
from app.config import settings
from app.services.db_service import db_service

PHONE = "610-555-0187"
PHONE_DIGITS = "6105550187"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin():
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    return c


def _signup(client, name="Zed Singer", ptype="Solo", **extra):
    perf = {"performance_type": ptype, "song_title": "Some Song"}
    perf.update(extra)
    res = client.post("/api/signup", json={"performer_name": name, "contact_info": PHONE, "age_group": "Senior",
                                           "performances": [perf]})
    assert res.status_code == 200, res.text
    return res.json()["entry_ids"][0]


def _checks():
    from app.services.readiness_service import readiness_service
    return {c["id"]: c for c in asyncio.run(readiness_service.run())["checks"]}


# ----------------------------------------------------------------------------- N1 readiness reports a failed export
def test_readiness_reports_a_failed_export_as_error(monkeypatch):
    monkeypatch.setattr(settings.backup, "enabled", True)
    log_id = db_service.log_backup_start()
    db_service.log_backup_error(log_id, "disk full")
    check = _checks()["backup"]
    assert check["status"] == "error" and "disk full" in check["detail"]


# ----------------------------------------------------------------------------- N2 public edit validation
def test_public_edit_rejects_unknown_track_status_and_type(client):
    eid = _signup(client)
    assert client.put(f"/api/signup/performance/{eid}", json={"track_status": "Uploaded"}).status_code == 400
    assert client.put(f"/api/signup/performance/{eid}", json={"track_status": "<script>"}).status_code == 400
    assert client.put(f"/api/signup/performance/{eid}", json={"performance_type": "Orchestra"}).status_code == 400
    perf = db_service.get_performance(eid)
    assert perf["track_status"] == "Pending" and perf["performance_type"] == "Solo"
    assert client.put(f"/api/signup/performance/{eid}", json={"track_status": "Acoustic"}).status_code == 200


def test_public_edit_enforces_length_limits(client):
    eid = _signup(client)
    assert client.put(f"/api/signup/performance/{eid}", json={"song_title": "x" * 500}).status_code == 400
    assert client.put(f"/api/signup/performance/{eid}", json={"stage_notes": "n" * 5000}).status_code == 400
    assert client.put(f"/api/signup/performance/{eid}", json={"partner_name": "p" * 300}).status_code == 400
    assert db_service.get_performance(eid)["song_title"] == "Some Song"


def test_public_edit_rechecks_the_duet_partner_rule(client):
    eid = _signup(client)
    res = client.put(f"/api/signup/performance/{eid}", json={"performance_type": "Duet"})
    assert res.status_code == 400 and "artner" in res.json()["detail"]
    res = client.put(f"/api/signup/performance/{eid}", json={"performance_type": "Duet", "partner_name": "Stranger Danger"})
    assert res.status_code == 400 and "phone" in res.json()["detail"]
    ok = client.put(f"/api/signup/performance/{eid}", json={"performance_type": "Duet", "partner_name": "Stranger Danger",
                                                            "partner_phone": "610-555-0999"})
    assert ok.status_code == 200
    assert db_service.get_performance(eid)["performance_type"] == "Duet"


def test_public_edit_unknown_entry_is_404_and_admin_edit_is_unconstrained(client, admin):
    assert client.put("/api/signup/performance/PK-999", json={"song_title": "Hi"}).status_code == 404
    eid = _signup(client)
    res = admin.put(f"/api/admin/participants/{eid}", json={"track_status": "Uploaded", "song_title": "Admin Title"})
    assert res.status_code == 200, res.text
    perf = db_service.get_performance(eid)
    assert perf["song_title"] == "Admin Title" and perf["track_status"] == "Uploaded"


# ----------------------------------------------------------------------------- N3 entry ids are never reused
def test_entry_ids_are_not_reused_after_deleting_the_highest(client):
    ids = [_signup(client, f"Person {i}") for i in range(3)]
    assert ids[-1].endswith("003")
    assert db_service.delete_performance(ids[-1])
    assert _signup(client, "Person 9").endswith("004")


def test_high_water_mark_backfills_from_existing_ids(client):
    first = _signup(client, "Only One")
    with db_service.performance_repo.get_connection() as conn:
        conn.execute("DELETE FROM sync_meta WHERE key LIKE 'entry_id_high_water%'")
        conn.commit()
    assert first.endswith("001")
    assert _signup(client, "Second").endswith("002")
    assert db_service.get_meta("entry_id_high_water") == "2"


# ----------------------------------------------------------------------------- N6 consistent redacted shape
PRIVATE = ("contact_info", "guardian_name", "guardian_phone", "partner_phone")


def test_public_lists_omit_private_keys_but_admin_keeps_them(client, admin):
    _signup(client)
    for path in ("/api/performances", "/api/stage-queue"):
        row = client.get(path).json()[0]
        assert not any(k in row for k in PRIVATE), (path, row.keys())
        assert row["performer_name"] == "Zed Singer" and "song_title" in row
        arow = admin.get(path).json()[0]
        assert all(k in arow for k in PRIVATE) and arow["contact_info"] == PHONE


# ----------------------------------------------------------------------------- N10 no phones in activity details
def test_activity_log_details_never_contain_phone_numbers(client, admin):
    eid = _signup(client, "Phone Test", ptype="Duet", partner_name="Pal", partner_phone="610-555-0111")
    client.put(f"/api/signup/performance/{eid}", json={"partner_phone": "610-555-0222", "song_title": "New"})
    db_service.log_activity("custom", "X", f"Called {PHONE}", details=json.dumps({"note": f"ring {PHONE_DIGITS}", "phone": PHONE}))
    logs = admin.get("/api/admin/activity-logs?days=1").json()
    assert logs
    blob = json.dumps(logs)
    for digits in ("6105550187", "610-555-0187", "6105550111", "610-555-0111", "6105550222", "610-555-0222"):
        assert digits not in blob


# ----------------------------------------------------------------------------- A9 media types
@pytest.mark.parametrize("ext,mime,kind", [
    (".mov", "video/quicktime", "video"), (".webm", "video/webm", "video"), (".mkv", "video/x-matroska", "video"),
    (".m4v", "video/x-m4v", "video"), (".wav", "audio/wav", "audio"), (".flac", "audio/flac", "audio"),
    (".m4a", "audio/mp4", "audio"), (".aac", "audio/aac", "audio"), (".ogg", "audio/ogg", "audio"),
])
def test_media_types_for_hand_delivered_formats(client, admin, ext, mime, kind):
    eid = _signup(client)
    with open(os.path.join(settings.storage.tracks_dir, f"{eid}_Some_Song{ext}"), "wb") as f:
        f.write(b"\x00" * 2048)
    res = client.get(f"/api/stream/{eid}")
    assert res.status_code in (200, 206) and res.headers["content-type"].split(";")[0] == mime
    assert admin.get(f"/api/download-track/{eid}").headers["content-type"].split(";")[0] == mime
    assert client.get(f"/api/track-info/{eid}").json()["media_type"] == kind


# ----------------------------------------------------------------------------- A12 event list singers
def test_event_list_counts_singers(client, admin):
    _signup(client, "Lead Singer", ptype="Duet", partner_name="Second Voice", partner_phone="610-555-0333")
    ev = admin.get("/api/admin/events").json()["events"][0]
    assert ev["singers"] == 2


# ----------------------------------------------------------------------------- N16 robots
def test_every_response_carries_noindex_and_robots_txt_disallows_all(client):
    expected = "noindex, nofollow, noarchive"
    for path in ("/", "/signup", "/api/event-info", "/api/performances", "/api/nope-404", "/static/css/style.css"):
        assert client.get(path).headers.get("x-robots-tag") == expected, path
    res = client.get("/robots.txt")
    assert res.status_code == 200 and res.text == "User-agent: *\nDisallow: /"
    assert res.headers["x-robots-tag"] == expected


# ----------------------------------------------------------------------------- N17 rate-limit key
def _request(headers, host="10.0.0.9"):
    scope = {"type": "http", "method": "GET", "path": "/", "query_string": b"", "client": (host, 1234),
             "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]}
    return Request(scope)


def test_rate_limit_key_default_uses_first_forwarded_for(monkeypatch):
    from app.routers.auth import client_key
    monkeypatch.delenv("TRUST_CLOUDFLARE", raising=False)
    req = _request({"X-Forwarded-For": "1.2.3.4, 5.6.7.8", "CF-Connecting-IP": "9.9.9.9"})
    assert client_key(req) == "1.2.3.4"
    assert client_key(_request({})) == "10.0.0.9"


def test_rate_limit_key_trusts_cloudflare_header_only_when_enabled(monkeypatch):
    from app.routers.auth import client_key
    monkeypatch.setenv("TRUST_CLOUDFLARE", "true")
    req = _request({"X-Forwarded-For": "1.2.3.4", "CF-Connecting-IP": "9.9.9.9"})
    assert client_key(req) == "9.9.9.9"
    assert client_key(_request({"X-Forwarded-For": "1.2.3.4"})) == "1.2.3.4"   # header absent: fall back
    monkeypatch.setenv("TRUST_CLOUDFLARE", "false")
    assert client_key(req) == "1.2.3.4"


# ----------------------------------------------------------------------------- PIN readiness
def test_readiness_warns_only_for_default_admin_pin(monkeypatch):
    monkeypatch.setattr(settings, "admin_pin", "4821")
    check = _checks()["pin"]
    assert check["status"] == "ok"
    assert "operator" not in check["detail"].lower()
    monkeypatch.setattr(settings, "admin_pin", "2026")
    check = _checks()["pin"]
    assert check["status"] == "warn" and "default" in check["detail"].lower()
    assert "2026" not in check["detail"]


# ----------------------------------------------------------------------------- N15 upload cap and message
def test_max_upload_size_setting_raises_the_audio_cap_and_413_is_friendly(client, monkeypatch):
    from app.services.audio_workflow_service import audio_workflow_service as aws
    monkeypatch.setattr(settings.storage, "max_upload_size_mb", 300)
    assert aws.max_upload_bytes(False) == 300 * 1024 * 1024
    assert aws.max_upload_bytes(True) == 500 * 1024 * 1024
    monkeypatch.setattr(aws, "max_upload_bytes", staticmethod(lambda is_video: 1024))
    eid = _signup(client)
    res = client.post("/api/upload", data={"entry_id": eid, "submission_type": "file"},
                      files={"file": ("big.mp3", io.BytesIO(b"x" * 5000), "audio/mpeg")})
    assert res.status_code == 413
    detail = res.json()["detail"]
    assert "maximum allowed size" in detail and "compress" in detail.lower()


# ----------------------------------------------------------------------------- readiness additions (6.8)
def test_readiness_reports_database_integrity(monkeypatch):
    assert _checks()["db_integrity"]["status"] == "ok"
    monkeypatch.setattr("app.services.readiness_service.ReadinessService._quick_check_rows",
                        lambda self: ["row 1 missing from index"])
    check = _checks()["db_integrity"]
    assert check["status"] == "error" and "row 1" in check["detail"]


def test_readiness_flags_database_tracks_missing_on_disk(client):
    eid = _signup(client)
    db_service.update_performance_field(eid, "drive_file_name", "ghost.mp3")
    db_service.update_performance_field(eid, "track_status", "Uploaded")
    check = _checks()["track_files"]
    assert check["status"] == "error" and eid in check["detail"]


def test_readiness_warns_under_2gb_free(monkeypatch):
    monkeypatch.setattr("app.services.readiness_service.shutil.disk_usage",
                        lambda p: SimpleNamespace(total=100 * 1024**3, used=0, free=int(1.5 * 1024**3)))
    assert _checks()["disk"]["status"] == "warn"


# ----------------------------------------------------------------------------- ffprobe validation
def test_ffprobe_rejects_files_without_a_real_stream_or_duration(monkeypatch, tmp_path):
    from app.services import audio_workflow_service as mod
    from app.exceptions import InvalidAudioError
    svc = mod.audio_workflow_service
    f = tmp_path / "x.mp3"
    f.write_bytes(b"data")
    monkeypatch.setattr(mod.shutil, "which", lambda name: "/usr/bin/ffprobe")

    def fake(payload):
        return lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr(mod.subprocess, "run", fake({"streams": [], "format": {"duration": "10.0"}}))
    with pytest.raises(InvalidAudioError):
        svc._ffprobe_duration(str(f))
    monkeypatch.setattr(mod.subprocess, "run", fake({"streams": [{"codec_type": "audio"}], "format": {"duration": "0.0"}}))
    with pytest.raises(InvalidAudioError):
        svc._ffprobe_duration(str(f))
    monkeypatch.setattr(mod.subprocess, "run", fake({"streams": [{"codec_type": "audio"}], "format": {"duration": "12.5"}}))
    assert svc._ffprobe_duration(str(f)) == 12.5
    monkeypatch.setattr(mod.subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a, 1, stdout="", stderr="Invalid data"))
    with pytest.raises(InvalidAudioError):
        svc._ffprobe_duration(str(f))


def test_ffprobe_missing_degrades_gracefully(monkeypatch, tmp_path):
    from app.services import audio_workflow_service as mod
    f = tmp_path / "x.mp3"
    f.write_bytes(b"data")
    monkeypatch.setattr(mod.shutil, "which", lambda name: None)
    assert mod.audio_workflow_service._ffprobe_duration(str(f)) is None
