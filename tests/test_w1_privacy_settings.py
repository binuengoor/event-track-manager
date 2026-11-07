import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.privacy import public_name
from app.services.db_service import db_service

PHONE = "6105550142"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin():
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    return c


def _junior(client, name="Anika Menon", song="Twinkle", partner=None, ptype="Solo"):
    perf = {"performance_type": ptype, "song_title": song, "stage_notes": "SECRET NOTE"}
    if partner:
        perf["partner_name"] = partner
        perf["partner_phone"] = PHONE
    res = client.post("/api/signup", json={
        "performer_name": name, "contact_info": PHONE, "age_group": "Junior",
        "guardian_name": "Parent Menon", "guardian_phone": PHONE, "performances": [perf]})
    assert res.status_code == 200, res.text
    return res.json()["entry_ids"][0]


def _senior(client, name="Ravi Kumar", song="Senior Song"):
    res = client.post("/api/signup", json={
        "performer_name": name, "contact_info": PHONE, "age_group": "Senior",
        "performances": [{"performance_type": "Solo", "song_title": song, "stage_notes": "SENIOR NOTE"}]})
    assert res.status_code == 200, res.text
    return res.json()["entry_ids"][0]


# ------------------------------------------------------------------ contract 1
def test_public_name_helper():
    assert public_name("Anika Menon", "Junior") == "Anika M."
    assert public_name("Anika Menon", "junior", shorten_juniors=False) == "Anika Menon"
    assert public_name("Ravi Kumar", "Senior") == "Ravi Kumar"
    assert public_name("Ravi Kumar", "Senior", adult_opt_in=True) == "Ravi K."
    assert public_name("Anika", "Junior") == "Anika"


def test_every_public_emitter_shortens_junior_names_but_admin_keeps_full(client, admin):
    jid = _junior(client)
    _senior(client)
    _junior(client, name="Kiran Nair", song="Duet Song", partner="Anika Menon", ptype="Duet")

    def dumped(res):
        assert res.status_code == 200, res.text
        return json.dumps(res.json())

    for url in ("/api/dashboard/performances", "/api/live-status", "/api/performances", "/api/stage-queue",
                "/api/performer/names", "/api/signup/config"):
        text = dumped(client.get(url))
        assert "Anika Menon" not in text and "Kiran Nair" not in text, url
        assert "Anika M." in text and "Kiran N." in text, url
    # other_songs in a profile lookup of somebody else
    prof = client.get("/api/performer/profile", params={"name": "Ravi Kumar"})
    assert "Anika Menon" not in prof.text and "Anika M." in prof.text
    # admin keeps full names
    assert "Anika Menon" in admin.get("/api/performances").text
    assert "Anika Menon" in admin.get("/api/stage-queue").text


def test_shortening_can_be_switched_off(client, admin):
    _junior(client)
    assert admin.put("/api/admin/settings", json={"settings": {"shorten_junior_names": False}}).status_code == 200
    assert "Anika Menon" in client.get("/api/dashboard/performances").text
    assert admin.get("/api/admin/settings").json()["shorten_junior_names"] is False


def test_shorten_setting_default_true_and_validated(admin):
    assert admin.get("/api/admin/settings").json()["shorten_junior_names"] is True
    bad = admin.put("/api/admin/settings", json={"settings": {"shorten_junior_names": "maybe"}})
    assert bad.status_code == 400


def test_signup_config_registered_entries_have_short_name_and_entry_id_no_phones(client):
    jid = _junior(client)
    data = client.get("/api/signup/config").json()
    assert {"name": "Anika M.", "entry_id": jid} in data["registered_entries"]
    assert "Anika M." in data["registered_performers"]
    assert PHONE not in json.dumps(data)
    assert any(s["performer_name"] == "Anika M." for s in data["existing_songs"])


# ------------------------------------------------------------------ contract 3
def test_public_schedule_has_status_sequence_and_no_age_group_or_track_status(client, admin):
    a = _senior(client, "Ravi Kumar")
    b = _senior(client, "Mala Das", "Another")
    admin.patch(f"/api/status/{a}", json={"status": "Performed"})
    rows = {r["entry_id"]: r for r in client.get("/api/dashboard/performances").json()}
    for r in rows.values():
        assert "age_group" not in r and "track_status" not in r
        assert "sequence_order" in r and r["status"] in ("upcoming", "now", "done")
    assert rows[a]["status"] == "done"
    live = client.get("/api/live-status").json()
    entries = [live["now_performing"]] + live["up_next"] + live["upcoming"] + live["performed"] + live["on_hold"]
    entries = [e for e in entries if e]
    assert entries
    for e in entries:
        assert "age_group" not in e and "track_status" not in e and "stage_notes" not in e
        assert e["status"] in ("upcoming", "now", "done")
    # admin payloads unchanged
    adm = admin.get("/api/performances").json()
    assert all("age_group" in r and "track_status" in r and "stage_notes" in r for r in adm)


def test_active_performance_is_now(client, admin):
    a = _senior(client)
    assert admin.post(f"/api/set-active/{a}").status_code == 200
    rows = client.get("/api/dashboard/performances").json()
    assert rows[0]["status"] == "now"
    assert client.get("/api/live-status").json()["now_performing"]["status"] == "now"


# ------------------------------------------------------------------ contract 2
def test_announcement_roundtrip_and_stage_notes_never_public(client, admin):
    _senior(client)
    assert client.get("/api/live-status").json()["announcement"] == ""
    assert client.put("/api/announcement", json={"text": "Dinner at 6"}).status_code == 401
    res = admin.put("/api/announcement", json={"text": "Dinner at 6"})
    assert res.status_code == 200 and res.json() == {"text": "Dinner at 6"}
    assert client.get("/api/live-status").json()["announcement"] == "Dinner at 6"
    assert admin.put("/api/announcement", json={"text": "x" * 141}).status_code == 400
    for url in ("/api/live-status", "/api/performances", "/api/dashboard/performances", "/api/stage-queue"):
        assert "SENIOR NOTE" not in client.get(url).text, url
    assert "SENIOR NOTE" in admin.get("/api/performances").text


# ------------------------------------------------------------------ contract 6
def test_event_info_exposes_limits_and_extensions(client, admin):
    info = client.get("/api/event-info").json()
    assert info["max_audio_upload_mb"] == 200 and info["max_video_upload_mb"] == 500
    assert info["allowed_extensions"] == ["mp3", "wav", "m4a", "mp4", "webm"]
    assert admin.put("/api/admin/settings", json={"settings": {"max_audio_upload_mb": 50}}).status_code == 200
    assert client.get("/api/event-info").json()["max_audio_upload_mb"] == 50
    assert admin.put("/api/admin/settings", json={"settings": {"max_video_upload_mb": "lots"}}).status_code == 400


def test_upload_rejects_bad_extension_with_400(client):
    eid = _senior(client)
    res = client.post("/api/upload", data={"entry_id": eid, "submission_type": "file"},
                      files={"file": ("track.exe", io.BytesIO(b"x" * 10), "application/octet-stream")})
    assert res.status_code == 400 and ".mp3" in res.json()["detail"]
    res = client.post("/api/upload", data={"entry_id": eid, "submission_type": "file", "media_type": "video"},
                      files={"file": ("track.mp3", io.BytesIO(b"x" * 10), "audio/mpeg")})
    assert res.status_code == 400 and ".mp4" in res.json()["detail"]


def test_upload_size_limit_follows_setting_per_kind(client, admin):
    eid = _senior(client)
    db_service.set_app_setting("max_audio_upload_mb", 1)
    res = client.post("/api/upload", data={"entry_id": eid, "submission_type": "file"},
                      files={"file": ("a.mp3", io.BytesIO(b"x" * (1024 * 1024 + 10)), "audio/mpeg")})
    assert res.status_code == 413 and "1MB" in res.json()["detail"]


# ------------------------------------------------------------------ food gating
def test_food_put_and_delete_are_gated_by_feature_flag(client, admin):
    admin.put("/api/admin/settings", json={"settings": {"food_signup_enabled": False}})
    assert client.put("/api/signup/food/anything", json={"dish_description": "x"}).status_code == 400
    assert client.delete("/api/signup/food/anything").status_code == 400


# ------------------------------------------------------------------ contract 4
def test_vault_manifest_requires_admin_and_lists_audio_and_video(client, admin, tmp_path):
    import hashlib, os
    a = _senior(client, "Ravi Kumar")
    b = _senior(client, "Mala Das", "Video Song")
    tdir = settings.storage.tracks_dir
    with open(os.path.join(tdir, f"{a}_x.mp3"), "wb") as f:
        f.write(b"audio-bytes")
    with open(os.path.join(tdir, f"{b}_y.mp4"), "wb") as f:
        f.write(b"video-bytes")
    assert client.get("/api/vault/manifest").status_code == 401
    data = admin.get("/api/vault/manifest").json()
    assert data["event_id"]
    by_id = {t["entry_id"]: t for t in data["tracks"]}
    assert by_id[a]["kind"] == "audio" and by_id[b]["kind"] == "video"
    assert by_id[a]["sha256"] == hashlib.sha256(b"audio-bytes").hexdigest()
    assert by_id[b]["size"] == len(b"video-bytes")
    assert by_id[a]["url"] == f"/api/stream/{a}"
    assert "duration" in by_id[a]


# ------------------------------------------------------------------ zip extras
def test_zip_has_playlist_and_html_run_sheet(admin, client):
    import os
    a = _senior(client, "Ravi <b>Kumar", "Song & Dance")
    with open(os.path.join(settings.storage.tracks_dir, f"{a}_x.mp3"), "wb") as f:
        f.write(b"audio")
    res = admin.get("/api/export-zip")
    assert res.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(res.content))
    names = zf.namelist()
    assert "00_Playlist.m3u8" in names and "00_Run_Sheet.html" in names
    playlist = zf.read("00_Playlist.m3u8").decode().splitlines()
    assert playlist[0] == "#EXTM3U"
    audio_names = [n for n in names if n.endswith(".mp3")]
    assert audio_names and audio_names[0] in playlist
    html = zf.read("00_Run_Sheet.html").decode()
    assert "<table" in html and "Ravi &lt;b&gt;Kumar" in html and "Song &amp; Dance" in html
    assert "<b>Kumar" not in html


# ------------------------------------------------------------------ coordinator extras
def test_status_patch_rejects_unknown_values(client, admin):
    a = _senior(client)
    for bad in ("Bogus", "Completed", ""):
        assert admin.patch(f"/api/status/{a}", json={"status": bad}).status_code == 400
    for good in ("Performed", "Upcoming", "On Hold", "Done", "Skipped", "On Stage"):
        assert admin.patch(f"/api/status/{a}", json={"status": good}).status_code == 200


def test_both_registration_requires_a_dish(client):
    res = client.post("/api/signup", json={
        "performer_name": "Dish Dodger", "contact_info": PHONE, "age_group": "Senior", "registration_type": "both",
        "performances": [{"performance_type": "Solo", "song_title": "S"}],
        "food_signup": {"item_id": "", "dish_description": ""}})
    assert res.status_code == 400
    assert res.json()["detail"] == "Choose a dish or switch off the dish part."
    assert db_service.get_all_performances() == []


def test_food_registration_without_dish_does_not_ask_for_a_performance(client):
    res = client.post("/api/signup", json={
        "performer_name": "Only Food", "contact_info": PHONE, "registration_type": "food", "performances": []})
    assert res.status_code == 400
    assert "performance" not in res.json()["detail"].lower()
    assert "dish" in res.json()["detail"].lower()
