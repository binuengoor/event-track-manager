import os
import stat
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.db_service import db_service
from app.services.export_service import export_service
from app.services.track_store import track_store


@pytest.fixture
def admin():
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    return c


def _signup(client, name="Maya"):
    res = client.post("/api/signup", json={"performer_name": name, "age_group": "Senior", "contact_info": "610-555-0123",
                                           "performances": [{"performance_type": "Solo", "song_title": "Song"}]})
    assert res.status_code == 200, res.text
    return res.json()["entry_ids"][0]


def test_snapshot_files_are_private_and_listed(admin):
    path = export_service.snapshot_database()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    data = admin.get("/api/admin/snapshots").json()
    assert [s["name"] for s in data["snapshots"]] == [os.path.basename(path)]
    assert set(data["snapshots"][0]) == {"name", "size", "modified"}
    assert data["pre_migration"] == []


def test_pre_migration_listed_separately(admin):
    name = "pre-migration-20260101-101010-abcdef12.db"
    open(os.path.join(export_service.backups_dir, name), "wb").write(b"x")
    open(os.path.join(export_service.backups_dir, "notes.txt"), "wb").write(b"x")
    data = admin.get("/api/admin/snapshots").json()
    assert data["snapshots"] == []
    assert [s["name"] for s in data["pre_migration"]] == [name]


def test_migration_snapshot_is_private(tmp_path):
    import sqlite3
    from app.repositories.schema import ensure_database
    conn = sqlite3.connect(tmp_path / "event.db")
    conn.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)")
    conn.commit()
    ensure_database(conn)
    snap = next((tmp_path / "backups").glob("pre-migration-*.db"))
    assert stat.S_IMODE(snap.stat().st_mode) == 0o600
    conn.close()


@pytest.mark.parametrize("name", ["../event.db", "..%2Fevent.db", "event_20260101-000000.db/../../x", "event.db",
                                  "event_1.db", "%2e%2e/event_20260101-000000.db", "event_20260101-000000.db.bak",
                                  "pre-migration-x.db", "/etc/passwd", "event_20260101-000000.DB"])
def test_snapshot_names_are_strictly_validated(admin, name):
    for verb, suffix in (("get", "download"), ("post", "restore")):
        res = getattr(admin, verb)(f"/api/admin/snapshots/{name}/{suffix}")
        assert res.status_code in (400, 404, 405), (name, res.status_code)
    assert admin.get(f"/api/admin/snapshots/{name}/download").status_code != 200


def test_valid_name_but_missing_file_is_404(admin):
    assert admin.get("/api/admin/snapshots/event_20200101-000000.db/download").status_code == 404
    assert admin.post("/api/admin/snapshots/event_20200101-000000.db/restore").status_code == 404


def test_snapshot_endpoints_require_admin():
    c = TestClient(app)
    assert c.get("/api/admin/snapshots").status_code == 401
    assert c.get("/api/admin/snapshots/event_20200101-000000.db/download").status_code == 401
    assert c.post("/api/admin/snapshots/event_20200101-000000.db/restore").status_code == 401


def test_download_and_restore_with_safety_snapshot(admin):
    eid = _signup(admin, "Before Snapshot")
    path = export_service.snapshot_database()
    name = os.path.basename(path)
    res = admin.get(f"/api/admin/snapshots/{name}/download")
    assert res.status_code == 200 and res.content[:15] == b"SQLite format 3"

    _signup(admin, "After Snapshot")
    assert len(db_service.get_all_performances()) == 2
    res = admin.post(f"/api/admin/snapshots/{name}/restore")
    assert res.status_code == 200, res.text
    safety = res.json()["safety_snapshot"]
    assert safety != name and os.path.exists(os.path.join(export_service.backups_dir, safety))
    names = [p["performer_name"] for p in db_service.get_all_performances()]
    assert names == ["Before Snapshot"]
    # the safety snapshot holds the data that was live before the restore
    import sqlite3
    with sqlite3.connect(os.path.join(export_service.backups_dir, safety)) as old:
        assert old.execute("SELECT count(*) FROM performances").fetchone()[0] == 2
    logs = admin.get("/api/admin/activity-logs?days=1&action_type=snapshot_restore").json()
    assert logs and logs[0]["role"] == "admin"


def test_incoming_listing(admin):
    open(os.path.join(track_store.incoming_dir, "stray_song.mp3"), "wb").write(b"abc")
    open(os.path.join(track_store.incoming_dir, ".hidden"), "wb").write(b"abc")
    open(os.path.join(track_store.incoming_dir, "half.mp3.part"), "wb").write(b"abc")
    files = admin.get("/api/admin/incoming").json()["files"]
    assert [f["name"] for f in files] == ["stray_song.mp3"]
    assert files[0]["size"] == 3 and files[0]["modified"]
    assert TestClient(app).get("/api/admin/incoming").status_code == 401


def test_restore_previous_track(admin):
    eid = _signup(admin)
    assert admin.post(f"/api/admin/tracks/{eid}/restore").status_code == 404  # nothing archived
    assert admin.post("/api/admin/tracks/NOPE-999/restore").status_code == 404
    tdir = track_store.tracks_dir
    old = os.path.join(tdir, f"{eid}_Maya_Song.mp3")
    open(old, "wb").write(b"old-version")
    track_store.save(eid, _tmp(tdir, b"new-version-longer"), f"{eid}_Maya_Song.mp3")
    assert open(old, "rb").read() == b"new-version-longer"
    assert len(os.listdir(track_store.archive_dir)) == 1

    res = admin.post(f"/api/admin/tracks/{eid}/restore")
    assert res.status_code == 200, res.text
    assert res.json()["filename"] == f"{eid}_Maya_Song.mp3"
    assert open(old, "rb").read() == b"old-version"
    perf = db_service.get_performance(eid)
    assert perf["drive_file_name"] == f"{eid}_Maya_Song.mp3" and perf["track_status"] == "Uploaded"
    # the replaced (new) version is archived, not deleted
    assert any(open(os.path.join(track_store.archive_dir, n), "rb").read() == b"new-version-longer"
               for n in os.listdir(track_store.archive_dir))
    logs = admin.get(f"/api/admin/activity-logs?days=1&search={eid}").json()
    entry = next(l for l in logs if l["action_type"] == "track_restore")
    assert entry["role"] == "admin" and entry["performer_name"] == "Maya"


def _tmp(folder, data):
    p = os.path.join(folder, ".incoming.tmp")
    open(p, "wb").write(data)
    return p
