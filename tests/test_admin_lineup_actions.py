import os
import pytest

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.db_service import db_service
from app.services.track_store import track_store


@pytest.fixture
def admin():
    client = TestClient(app)
    client.headers.update({"X-Admin-PIN": settings.admin_pin})
    return client


def _act(name="Maya Nair", song="Kannalane"):
    return db_service.create_performance(performer_name=name, song_title=song, performance_type="Solo",
                                         contact_info="6105550123", age_group="Senior")


def test_add_act_is_admin_only_validates_and_audits(admin):
    payload = {"performer_name": "New Singer", "song_title": "New Song", "performance_type": "Solo"}
    assert TestClient(app).post("/api/admin/acts", json=payload).status_code == 401
    assert admin.post("/api/admin/acts", json={"performer_name": " "}).status_code == 400
    assert admin.post("/api/admin/acts", json={**payload, "performance_type": "Unknown"}).status_code == 400
    response = admin.post("/api/admin/acts", json=payload)
    assert response.status_code == 200, response.text
    entry_id = response.json()["entry_id"]
    assert db_service.get_performance(entry_id)["performer_name"] == "New Singer"
    logs = db_service.get_activity_logs(days=None, limit=20, action_type="admin_act_add")
    assert any(log["entry_id"] == entry_id for log in logs)


def test_delete_act_archives_track_and_never_reuses_id(admin):
    entry_id = _act()
    assert TestClient(app).delete(f"/api/admin/acts/{entry_id}").status_code == 401
    track_path = os.path.join(track_store.tracks_dir, f"{entry_id}_Maya_Song.mp3")
    open(track_path, "wb").write(b"old-track")
    response = admin.delete(f"/api/admin/acts/{entry_id}")
    assert response.status_code == 200, response.text
    assert not os.path.exists(track_path) and any(entry_id in name for name in os.listdir(track_store.archive_dir))
    assert admin.delete(f"/api/admin/acts/{entry_id}").status_code == 404
    added = admin.post("/api/admin/acts", json={"performer_name": "Next Singer", "song_title": "Next"})
    assert int(added.json()["entry_id"].rsplit("-", 1)[1]) > int(entry_id.rsplit("-", 1)[1])


def test_delete_database_failure_restores_active_track(admin, monkeypatch):
    entry_id = _act()
    track_path = os.path.join(track_store.tracks_dir, f"{entry_id}_Maya_Song.mp3")
    with open(track_path, "wb") as track:
        track.write(b"keep-on-delete-failure")

    def fail_delete(_entry_id):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(db_service, "delete_performance", fail_delete)
    client = TestClient(app, raise_server_exceptions=False)
    client.headers.update({"X-Admin-PIN": settings.admin_pin})
    assert client.delete(f"/api/admin/acts/{entry_id}").status_code == 500
    assert db_service.get_performance(entry_id) is not None
    assert os.path.exists(track_path)
    assert open(track_path, "rb").read() == b"keep-on-delete-failure"
    assert not os.listdir(track_store.archive_dir)


def test_delete_post_commit_error_does_not_restore_orphan_track(admin, monkeypatch):
    entry_id = _act()
    track_path = os.path.join(track_store.tracks_dir, f"{entry_id}_Maya_Song.mp3")
    with open(track_path, "wb") as track:
        track.write(b"archive-after-commit")

    def fail_log(*_args, **_kwargs):
        raise RuntimeError("audit storage unavailable")

    monkeypatch.setattr(db_service, "log_activity", fail_log)
    client = TestClient(app, raise_server_exceptions=False)
    client.headers.update({"X-Admin-PIN": settings.admin_pin})
    assert client.delete(f"/api/admin/acts/{entry_id}").status_code == 500
    assert db_service.get_performance(entry_id) is None
    assert not os.path.exists(track_path)
    archived = [name for name in os.listdir(track_store.archive_dir) if entry_id in name]
    assert len(archived) == 1
    assert open(os.path.join(track_store.archive_dir, archived[0]), "rb").read() == b"archive-after-commit"


def test_replace_track_archives_previous_and_updates_metadata(admin, monkeypatch):
    from app.services.audio_workflow_service import audio_workflow_service
    monkeypatch.setattr(audio_workflow_service, "_verify_audio", lambda path: "00:01")
    entry_id = _act()
    assert TestClient(app).post(f"/api/admin/acts/{entry_id}/track", files={"file": ("new.mp3", b"x", "audio/mpeg")}).status_code == 401
    old = os.path.join(track_store.tracks_dir, f"{entry_id}_old.mp3")
    open(old, "wb").write(b"old-track")
    response = admin.post(f"/api/admin/acts/{entry_id}/track", files={"file": ("new.mp3", b"new-track-data", "audio/mpeg")})
    assert response.status_code == 200, response.text
    perf = db_service.get_performance(entry_id)
    assert perf["track_status"] == "Uploaded" and perf["track_file"].endswith(".mp3")
    assert open(track_store.find(entry_id), "rb").read() == b"new-track-data"
    assert any(open(os.path.join(track_store.archive_dir, name), "rb").read() == b"old-track"
               for name in os.listdir(track_store.archive_dir))
    logs = db_service.get_activity_logs(days=None, limit=20, action_type="track_upload")
    replace_log = next(log for log in logs if log["entry_id"] == entry_id)
    assert replace_log["source"] == "admin" and replace_log["role"] == "admin"
    assert admin.post(f"/api/admin/acts/{entry_id}/track", files={"file": ("../bad.exe", b"bad", "application/octet-stream")}).status_code == 400
    assert admin.post(f"/api/admin/acts/{entry_id}/track", files={"file": ("empty.mp3", b"", "audio/mpeg")}).status_code == 400
    assert admin.post("/api/admin/acts/NOPE-999/track", files={"file": ("new.mp3", b"data", "audio/mpeg")}).status_code == 404


def test_match_incoming_file_uses_canonical_name_and_archives_old_track(admin, tmp_path):
    entry_id = _act()
    assert TestClient(app).post(f"/api/admin/acts/{entry_id}/match", json={"filename": "hand-delivered.mp3"}).status_code == 401
    old = os.path.join(track_store.tracks_dir, f"{entry_id}_old.mp3")
    open(old, "wb").write(b"old-track")
    source = os.path.join(track_store.incoming_dir, "hand-delivered.mp3")
    open(source, "wb").write(b"incoming-track")
    response = admin.post(f"/api/admin/acts/{entry_id}/match", json={"filename": "hand-delivered.mp3"})
    assert response.status_code == 200, response.text
    assert not os.path.exists(source)
    assert os.path.basename(track_store.find(entry_id)) == f"01_{entry_id}_Maya_Nair_Kannalane.mp3"
    assert open(track_store.find(entry_id), "rb").read() == b"incoming-track"
    assert any(open(os.path.join(track_store.archive_dir, name), "rb").read() == b"old-track"
               for name in os.listdir(track_store.archive_dir))
    assert admin.post(f"/api/admin/acts/{entry_id}/match", json={"filename": "../outside.mp3"}).status_code == 400
    assert admin.post(f"/api/admin/acts/{entry_id}/match", json={"filename": "missing.mp3"}).status_code == 404
    assert admin.post(f"/api/admin/acts/NOPE-999/match", json={"filename": "hand-delivered.mp3"}).status_code == 404
    external = tmp_path / "external.mp3"
    external.write_bytes(b"outside")
    os.symlink(external, os.path.join(track_store.incoming_dir, "linked.mp3"))
    assert admin.post(f"/api/admin/acts/{entry_id}/match", json={"filename": "linked.mp3"}).status_code == 404
    assert external.read_bytes() == b"outside"

