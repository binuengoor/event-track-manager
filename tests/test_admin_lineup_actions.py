import asyncio
import os
import threading
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


@pytest.mark.parametrize("delete_route", ["acts", "participants"])
def test_delete_waits_for_inflight_track_replacement(admin, monkeypatch, delete_route):
    from app.services.audio_workflow_service import audio_workflow_service
    from app.services.audio_service import audio_service

    entry_id = _act()
    started = threading.Event()
    release = threading.Event()
    async def controlled_transcode(_source, _destination, **_kwargs):
        started.set()
        await asyncio.to_thread(release.wait, 5)
        return False

    monkeypatch.setattr(audio_service, "async_transcode_to_standard_mp3", controlled_transcode)
    monkeypatch.setattr(audio_workflow_service, "_verify_audio", lambda _path: "00:01")
    upload_response = []
    delete_response = []
    upload_thread = threading.Thread(target=lambda: upload_response.append(
        admin.post(f"/api/admin/acts/{entry_id}/track", files={"file": ("new.mp3", b"new-track", "audio/mpeg")})))
    upload_thread.start()
    assert started.wait(timeout=5), "replacement never reached verification"

    delete_thread = threading.Thread(target=lambda: delete_response.append(
        admin.delete(f"/api/admin/{delete_route}/{entry_id}")))
    delete_thread.start()
    try:
        # With per-entry serialization, delete cannot commit while replacement is between
        # verification and track installation. This short wait distinguishes the old race.
        delete_thread.join(timeout=0.1)
        assert delete_thread.is_alive(), "delete did not wait for the in-flight replacement"
    finally:
        release.set()
        upload_thread.join(timeout=5)
        delete_thread.join(timeout=5)

    assert not upload_thread.is_alive() and not delete_thread.is_alive()
    assert upload_response[0].status_code == 200, upload_response[0].text
    assert delete_response[0].status_code == 200, delete_response[0].text
    assert db_service.get_performance(entry_id) is None
    assert track_store.find(entry_id) is None


@pytest.mark.asyncio
async def test_cancelled_thread_work_keeps_entry_lock_until_worker_finishes():
    from app.services.audio_workflow_service import AudioWorkflowService

    workflow = AudioWorkflowService()
    started = threading.Event()
    release = threading.Event()
    acquired_by_waiter = threading.Event()

    def blocked_work():
        started.set()
        assert release.wait(timeout=5)
        return "finished"

    async def first_request():
        async with workflow.lock_entry("ENTRY-1"):
            return await workflow.run_thread_to_completion(blocked_work)

    async def waiting_request():
        async with workflow.lock_entry("ENTRY-1"):
            acquired_by_waiter.set()

    first = asyncio.create_task(first_request())
    assert await asyncio.to_thread(started.wait, 5)
    first.cancel()
    await asyncio.sleep(0.05)
    assert not first.done(), "request cancellation released its lock while thread work was active"

    waiter = asyncio.create_task(waiting_request())
    await asyncio.sleep(0.05)
    assert not acquired_by_waiter.is_set()

    release.set()
    with pytest.raises(asyncio.CancelledError):
        await first
    await waiter
    assert acquired_by_waiter.is_set()
    assert workflow._entry_locks == {}


@pytest.mark.asyncio
async def test_idle_entry_locks_are_removed_from_registry():
    from app.services.audio_workflow_service import AudioWorkflowService

    workflow = AudioWorkflowService()
    for index in range(100):
        async with workflow.lock_entry(f"missing-{index}"):
            pass
    assert workflow._entry_locks == {}


@pytest.mark.asyncio
async def test_cancel_during_track_install_finishes_metadata_update(monkeypatch, tmp_path):
    from app.services.audio_workflow_service import audio_workflow_service
    from app.services.audio_service import audio_service

    entry_id = _act()
    started = threading.Event()
    release = threading.Event()
    original_save = track_store.save

    def delayed_save(*args, **kwargs):
        started.set()
        assert release.wait(timeout=5)
        return original_save(*args, **kwargs)

    async def leave_original_file(_source, _destination, **_kwargs):
        return False

    monkeypatch.setattr(track_store, "save", delayed_save)
    monkeypatch.setattr(audio_service, "async_transcode_to_standard_mp3", leave_original_file)
    monkeypatch.setattr(audio_workflow_service, "_verify_audio", lambda _path: "00:01")
    upload = tmp_path / "replacement.mp3"
    upload.write_bytes(b"replacement-track")

    task = asyncio.create_task(audio_workflow_service.process_track_upload(
        entry_id, file_path=str(upload), original_filename="replacement.mp3", audit_source="admin", audit_role="admin"))
    assert await asyncio.to_thread(started.wait, 5)
    task.cancel()
    await asyncio.sleep(0.05)
    assert not task.done(), "cancellation escaped while the install and metadata worker was active"
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    perf = db_service.get_performance(entry_id)
    assert perf["track_status"] == "Uploaded"
    assert perf["track_file"] == os.path.basename(track_store.find(entry_id))
    assert open(track_store.find(entry_id), "rb").read() == b"replacement-track"


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

