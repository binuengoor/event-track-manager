import os
import threading

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.audio_service import audio_service
from app.services.audio_workflow_service import audio_workflow_service
from app.services.db_service import db_service
from app.services import loudness_service as loudness_module


def _entry(name="A5 Singer"):
    return db_service.create_performance(
        performer_name=name, song_title="Test Song", performance_type="Solo",
        age_group="Senior", track_status="Pending",
    )


def test_upload_returns_precheck_facts_without_waiting_for_loudness(monkeypatch):
    entry_id = _entry()
    client = TestClient(app)

    async def transcode(_source, destination, **_kwargs):
        with open(destination, "wb") as f:
            f.write(b"verified audio")
        return True

    monkeypatch.setattr(audio_service, "async_transcode_to_standard_mp3", transcode)
    monkeypatch.setattr(audio_workflow_service, "_ffprobe_duration", lambda _path: 12.5)
    monkeypatch.setattr(audio_workflow_service, "_verify_audio_details", lambda _path: ("00:12", 12.5))
    scheduled = []
    monkeypatch.setattr(loudness_module.loudness_service, "schedule", lambda entry, path: scheduled.append((entry, path)))
    monkeypatch.setattr(loudness_module.loudness_service, "cached", lambda _entry, _path: None)

    response = client.post(
        "/api/upload", data={"entry_id": entry_id, "submission_type": "file", "media_type": "audio"},
        files={"file": ("song.mp3", b"input", "audio/mpeg")},
    )
    assert response.status_code == 200, response.text
    checks = response.json()["checks"]
    assert checks == {"duration_s": 12.5, "loudness_lufs": None, "gain_db": None, "format_ok": True}
    assert scheduled and scheduled[0][0] == entry_id
    assert "filename" not in checks and "file" not in checks


def test_performer_profile_refresh_exposes_safe_loudness_facts_and_acoustic_flag(monkeypatch):
    entry_id = _entry("Profile Singer")
    db_service.update_performance_field(entry_id, "track_status", "Acoustic")
    track_path = os.path.join(settings.storage.tracks_dir, f"{entry_id}_song.mp3")
    with open(track_path, "wb") as f:
        f.write(b"audio")
    monkeypatch.setattr(loudness_module.loudness_service, "cached", lambda _entry, _path: {
        "loudness_lufs": -19.5, "gain_db": 3.5, "format_ok": True,
        "duration_s": 23.25, "file": "private-path.mp3", "true_peak_db": -4.0,
    })

    response = TestClient(app).get("/api/performer/profile", params={"name": "Profile Singer"})
    assert response.status_code == 200, response.text
    song = response.json()["performances"][0]
    assert song["is_acoustic"] is True
    assert song["checks"] == {"duration_s": 23.25, "loudness_lufs": -19.5, "gain_db": 3.5, "format_ok": True}
    assert "private-path.mp3" not in response.text
    assert "true_peak_db" not in response.text
    assert "track_file" not in song


def test_public_live_performer_has_acoustic_boolean_without_track_status_or_personal_fields():
    entry_id = _entry("Public Acoustic")
    db_service.update_performance_field(entry_id, "track_status", "Acoustic")
    client = TestClient(app)
    response = client.post(f"/api/set-active/{entry_id}", headers={"X-Admin-PIN": settings.admin_pin})
    assert response.status_code == 200, response.text
    live = client.get("/api/live-status").json()["now_performing"]
    assert live["is_acoustic"] is True
    assert "track_status" not in live
    assert "contact_info" not in live and "guardian_phone" not in live


def test_legacy_track_without_verification_does_not_claim_format_passed():
    entry_id = _entry("Legacy Track Singer")
    db_service.update_performance_field(entry_id, "duration", "01:23")
    track_path = os.path.join(settings.storage.tracks_dir, f"{entry_id}_song.mp3")
    with open(track_path, "wb") as f:
        f.write(b"legacy-track")

    response = TestClient(app).get("/api/performer/profile", params={"name": "Legacy Track Singer"})
    assert response.status_code == 200, response.text
    checks = response.json()["performances"][0]["checks"]
    assert checks == {"duration_s": 83.0, "loudness_lufs": None, "gain_db": None, "format_ok": None}


def test_loudness_background_job_writes_facts_to_event_where_track_was_uploaded(monkeypatch, tmp_path):
    svc = loudness_module.LoudnessService()
    event_a = tmp_path / "event-a"
    event_b = tmp_path / "event-b"
    event_a.mkdir()
    event_b.mkdir()
    track_path = event_a / "tracks" / "E-1.mp3"
    track_path.parent.mkdir()
    track_path.write_bytes(b"event-a-track")
    started = threading.Event()
    finish = threading.Event()

    def slow_measure(_path):
        started.set()
        assert finish.wait(5)
        return {"lufs": -20.0, "true_peak": -5.0}

    monkeypatch.setattr(loudness_module, "measure_file", slow_measure)
    monkeypatch.setattr(settings.storage, "event_dir", str(event_a))
    assert svc.schedule("E-1", str(track_path))
    assert started.wait(5)
    monkeypatch.setattr(settings.storage, "event_dir", str(event_b))
    finish.set()

    expected = event_a / loudness_module.FACTS_FILENAME
    for _ in range(100):
        if expected.exists():
            break
        threading.Event().wait(0.01)
    assert expected.exists(), "worker did not write the upload event facts"
    assert "E-1" in expected.read_text()
    assert not (event_b / loudness_module.FACTS_FILENAME).exists()


def test_loudness_deduplication_is_scoped_to_event_and_entry(monkeypatch, tmp_path):
    svc = loudness_module.LoudnessService()
    first = tmp_path / "event-a" / "tracks" / "E-1.mp3"
    second = tmp_path / "event-b" / "tracks" / "E-1.mp3"
    first.parent.mkdir(parents=True)
    second.parent.mkdir(parents=True)
    first.write_bytes(b"first event")
    second.write_bytes(b"second event")
    started = {"a": threading.Event(), "b": threading.Event()}
    release = threading.Event()

    def slow_measure(path):
        key = "a" if "event-a" in path else "b"
        started[key].set()
        assert release.wait(5)
        return {"lufs": -20.0 if key == "a" else -22.0, "true_peak": -5.0}

    monkeypatch.setattr(loudness_module, "measure_file", slow_measure)
    assert svc.schedule("E-1", str(first))
    assert started["a"].wait(5)
    assert svc.schedule("E-1", str(second)), "same entry id in another event must not dedupe"
    assert started["b"].wait(5)
    release.set()
    for _ in range(100):
        if (first.parent.parent / loudness_module.FACTS_FILENAME).exists() and (second.parent.parent / loudness_module.FACTS_FILENAME).exists():
            break
        threading.Event().wait(0.01)
    assert svc.cached("E-1", str(first))["loudness_lufs"] == -20.0
    assert svc.cached("E-1", str(second))["loudness_lufs"] == -22.0


def test_replacement_during_measurement_requeues_current_track(monkeypatch, tmp_path):
    svc = loudness_module.LoudnessService()
    path = tmp_path / "event" / "tracks" / "E-1.mp3"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"old track")
    first_started = threading.Event()
    release_first = threading.Event()
    calls = []

    def measure(_path):
        calls.append(1)
        if len(calls) == 1:
            first_started.set()
            assert release_first.wait(5)
            return {"lufs": -30.0, "true_peak": -5.0}
        return {"lufs": -21.0, "true_peak": -5.0}

    monkeypatch.setattr(loudness_module, "measure_file", measure)
    assert svc.record_verification("E-1", str(path), 10.0)
    assert svc.schedule("E-1", str(path))
    assert first_started.wait(5)
    path.write_bytes(b"replacement is longer")
    svc.record_verification("E-1", str(path), 20.0)
    assert not svc.schedule("E-1", str(path)), "same-event in-flight work stays deduplicated"
    release_first.set()
    for _ in range(200):
        rec = svc.cached("E-1", str(path))
        if rec and rec.get("loudness_lufs") is not None:
            break
        threading.Event().wait(0.01)
    assert rec["duration_s"] == 20.0
    assert rec["loudness_lufs"] == -21.0
