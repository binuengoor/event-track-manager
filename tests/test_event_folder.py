import os
import io
import csv
import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.db_service import db_service
from app.services.track_store import track_store
from app.services.event_service import event_service
from app.services.export_service import export_service

ADMIN = {"X-Admin-PIN": settings.admin_pin}


def _perf(name="Maya Nair", song="Kannalane", **kw):
    return db_service.create_performance(performer_name=name, song_title=song, performance_type="Solo",
                                         contact_info="+1 610 555 0123", age_group="Senior", **kw)


def _drop(name_dir, filename, size=64, age=10):
    path = os.path.join(name_dir, filename)
    with open(path, "wb") as f:
        f.write(b"x" * size)
    old = time.time() - age
    os.utime(path, (old, old))
    return path


def test_track_lookup_matches_exact_entry_token_only():
    _drop(track_store.tracks_dir, "01_PK-1_A_Song.mp3")
    _drop(track_store.tracks_dir, "02_PK-10_B_Song.mp3")
    assert os.path.basename(track_store.find("PK-1")) == "01_PK-1_A_Song.mp3"
    assert os.path.basename(track_store.find("PK-10")) == "02_PK-10_B_Song.mp3"
    assert track_store.find("PK-100") is None


def test_dropping_a_file_in_tracks_marks_the_performance_uploaded_and_removal_reverts():
    eid = _perf()
    assert db_service.get_performance(eid)["track_status"] == "Pending"
    path = _drop(track_store.tracks_dir, f"01_{eid}_Maya_Nair_Kannalane.mp3")
    event_service.reconcile_tracks(force=True)
    perf = db_service.get_performance(eid)
    assert perf["track_status"] == "Uploaded"
    assert perf["drive_file_name"] == os.path.basename(path)
    os.remove(path)
    event_service.reconcile_tracks(force=True)
    perf = db_service.get_performance(eid)
    assert perf["track_status"] == "Pending" and not perf["drive_file_id"]


def test_acoustic_acts_keep_their_status_when_a_file_exists():
    eid = _perf("Guitar Guy", "Live Set", track_status="Acoustic")
    _drop(track_store.tracks_dir, f"{eid}_extra.mp3")
    event_service.reconcile_tracks(force=True)
    assert db_service.get_performance(eid)["track_status"] == "Acoustic"


def test_incoming_files_are_adopted_when_complete_and_named_with_an_entry_id():
    eid = _perf()
    ready = _drop(track_store.incoming_dir, f"{eid}_hand_delivered.mp3", age=10)
    still_copying = _drop(track_store.incoming_dir, "PK-999_unknown.mp3", age=10)
    fresh = _drop(track_store.incoming_dir, f"{eid}_fresh.wav", age=0)  # modified just now: may still be uploading
    event_service.reconcile_tracks(force=True)
    assert not os.path.exists(ready)
    assert os.path.basename(track_store.find(eid)) == f"{eid}_hand_delivered.mp3"
    assert os.path.exists(still_copying)  # no matching performance: left alone
    assert os.path.exists(fresh)          # too new: left for the next pass


def test_saving_a_new_version_archives_the_old_one_instead_of_deleting_it(tmp_path):
    eid = _perf()
    first = _drop(track_store.tracks_dir, f"01_{eid}_Maya_Kannalane.mp3", size=10)
    new_src = tmp_path / "new.mp3"; new_src.write_bytes(b"y" * 20)
    stored = track_store.save(eid, str(new_src), f"01_{eid}_Maya_Kannalane.mp3")
    assert os.path.getsize(stored) == 20
    archived = os.listdir(track_store.archive_dir)
    assert len(archived) == 1 and "_archived_" in archived[0]
    assert track_store.find(eid) == stored


def test_reorder_and_push_renames_files_to_the_new_sequence():
    a, b = _perf("A One", "Song A"), _perf("B Two", "Song B")
    _drop(track_store.tracks_dir, f"01_{a}_A_One_Song_A.mp3")
    _drop(track_store.tracks_dir, f"02_{b}_B_Two_Song_B.mp3")
    client = TestClient(app)
    res = client.post("/api/reorder-queue", headers=ADMIN, json={
        "items": [{"entry_id": a, "sequence_order": 2}, {"entry_id": b, "sequence_order": 1}], "push_to_sheet": True})
    assert res.status_code == 200
    assert os.path.basename(track_store.find(a)).startswith(f"02_{a}_")
    assert os.path.basename(track_store.find(b)).startswith(f"01_{b}_")
    assert db_service.get_performance(a)["drive_file_name"] == os.path.basename(track_store.find(a))
    assert db_service.is_sequence_dirty() is False


def test_deleting_a_performance_archives_its_track():
    eid = _perf()
    _drop(track_store.tracks_dir, f"01_{eid}_x.mp3")
    client = TestClient(app)
    assert client.delete(f"/api/admin/participants/{eid}", headers=ADMIN).status_code == 200
    assert track_store.find(eid) is None
    assert any(eid in n for n in os.listdir(track_store.archive_dir))


def test_export_writes_xlsx_csv_and_snapshot_atomically():
    _perf("Formula Guy", "=HYPERLINK(\"http://evil\")")
    res = export_service.export_now(snapshot=True, force_snapshot=True)
    base = settings.storage.event_dir
    for name in ("signups.xlsx", "signups.csv", "potluck.csv"):
        assert os.path.getsize(os.path.join(base, name)) > 0
    assert res["snapshot"] and os.path.exists(os.path.join(base, "backups", res["snapshot"]))
    assert not [n for n in os.listdir(base) if n.startswith(".tmp_")]

    from openpyxl import load_workbook
    wb = load_workbook(os.path.join(base, "signups.xlsx"))
    assert wb.sheetnames == ["Performances", "Run Sheet", "Potluck", "Participants"]
    rows = list(wb["Performances"].values)
    assert rows[0][0] == "Entry ID" and any(r[2] == "Formula Guy" for r in rows[1:])
    song = next(r for r in rows[1:] if r[2] == "Formula Guy")[10]
    assert song.startswith("'=")                    # formulas are neutralized
    phone = next(r for r in rows[1:] if r[2] == "Formula Guy")[6]
    assert phone == "+1 610 555 0123"               # real phone numbers are untouched

    with open(os.path.join(base, "signups.csv"), encoding="utf-8-sig") as f:
        assert next(csv.reader(f))[0] == "Entry ID"


def test_snapshot_retention_keeps_only_the_newest(monkeypatch):
    monkeypatch.setattr(settings.backup, "keep_snapshots", 3)
    for i in range(6):
        export_service.snapshot_database()
        time.sleep(1.05)
    assert len([n for n in os.listdir(os.path.join(settings.storage.event_dir, "backups")) if n.startswith("event_")]) == 3


def test_sync_endpoint_requires_pin_and_writes_files():
    _perf()
    client = TestClient(app)
    assert client.post("/api/sync").status_code == 401
    res = client.post("/api/sync", headers=ADMIN)
    assert res.status_code == 200
    body = res.json()
    assert body["count"] >= 1 and "signups.xlsx" in body["files"]
    assert os.path.exists(os.path.join(settings.storage.event_dir, "signups.xlsx"))


def test_backup_status_describes_the_local_export():
    client = TestClient(app)
    status = client.get("/api/admin/backup-status", headers=ADMIN).json()
    assert status["backup_target_sheet"] == "signups.xlsx"
    assert status["event_dir"] == settings.storage.event_dir


def test_legacy_cached_tracks_are_migrated_into_tracks_dir():
    eid = _perf()
    legacy = os.path.join(settings.storage.cache_dir, f"{eid}.mp3")
    with open(legacy, "wb") as f:
        f.write(b"legacy audio")
    assert event_service.migrate_legacy_cache_tracks() == 1
    stored = track_store.find(eid)
    assert stored and os.path.dirname(stored) == track_store.tracks_dir
    assert os.path.exists(legacy)  # the old copy is left alone
    assert event_service.migrate_legacy_cache_tracks() == 0  # idempotent


def test_renumbering_keeps_the_file_version_so_the_offline_vault_stays_valid():
    eid = _perf()
    _drop(track_store.tracks_dir, f"01_{eid}_Maya_Nair_Kannalane.mp3")
    event_service.reconcile_tracks(force=True)
    before = db_service.get_performance(eid)
    assert before["drive_file_id"].startswith("v")
    client = TestClient(app)
    client.post("/api/reorder-queue", headers=ADMIN, json={"items": [{"entry_id": eid, "sequence_order": 7}], "push_to_sheet": True})
    after = db_service.get_performance(eid)
    assert after["drive_file_name"].startswith(f"07_{eid}_") and after["drive_file_name"] != before["drive_file_name"]
    assert after["drive_file_id"] == before["drive_file_id"]          # same content -> vault entry still valid
    # replacing the content changes the version
    path = track_store.find(eid)
    with open(path, "wb") as f:
        f.write(b"different audio bytes" * 10)
    event_service.reconcile_tracks(force=True)
    assert db_service.get_performance(eid)["drive_file_id"] != before["drive_file_id"]
