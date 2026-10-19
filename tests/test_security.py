import os
import pytest
from fastapi.testclient import TestClient

from app.main import app, DATA_DIR
from app.config import settings
from app.routers import auth as auth_module

PHONE = "610-555-0123"
SECRET_NAME = "Parent Secret"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin():
    c = TestClient(app)
    c.headers.update({"X-Admin-PIN": settings.admin_pin})
    return c


def _signup_junior(client, name="Test Kid"):
    res = client.post("/api/signup", json={
        "performer_name": name,
        "age_group": "Junior",
        "guardian_name": SECRET_NAME,
        "guardian_phone": PHONE,
        "performances": [{"performance_type": "Solo", "song_title": "Test Song"}],
    })
    assert res.status_code == 200, res.text
    return res.json()["entry_ids"][0]


def _assert_no_pii(text):
    assert PHONE not in text
    assert SECRET_NAME not in text


def test_public_endpoints_never_expose_phones(client):
    _signup_junior(client)
    for path in ("/api/live-status", "/api/performances", "/api/stage-queue",
                 "/api/dashboard/performances", "/api/dashboard/food", "/api/signup/config",
                 "/api/performer/profile?name=Test Kid"):
        res = client.get(path)
        assert res.status_code == 200, path
        _assert_no_pii(res.text)


def test_admin_still_sees_phones_in_stage_queue(client, admin):
    _signup_junior(client)
    assert PHONE in admin.get("/api/stage-queue").text
    assert PHONE in admin.get("/api/admin/participants").text


def test_food_signup_phone_is_not_public(client, admin):
    gid = admin.post("/api/admin/food-groups", json={"name": "Sec Group"}).json()["group_id"]
    iid = admin.post("/api/admin/food-items", json={"name": "Sec Item", "group_id": gid}).json()["item_id"]
    free = {"item_id": iid}
    res = client.post("/api/signup", json={
        "performer_name": "Food Only", "contact_info": PHONE, "registration_type": "food_only",
        "food_signup": {"item_id": free["item_id"], "dish_description": "Samosa"},
    })
    assert res.status_code == 200, res.text
    assert PHONE not in client.get("/api/dashboard/food").text
    assert PHONE not in client.get("/api/signup/config").text
    assert PHONE in admin.get("/api/admin/food-items").text


def test_profile_requires_exact_name(client):
    _signup_junior(client, "Test Kid")
    assert client.get("/api/performer/profile?name=e").json()["performances"] == []
    assert client.get("/api/performer/profile?name=Test").json()["performances"] == []
    assert len(client.get("/api/performer/profile?name=test kid").json()["performances"]) == 1


def test_editing_without_phone_does_not_wipe_private_fields(client, admin):
    entry_id = _signup_junior(client)
    res = client.put(f"/api/signup/performance/{entry_id}", json={"song_title": "New Song", "partner_phone": "", "guardian_phone": ""})
    assert res.status_code == 200
    perf = next(p for p in admin.get("/api/stage-queue").json() if p["entry_id"] == entry_id)
    assert perf["song_title"] == "New Song"
    assert perf["guardian_phone"] == PHONE


def test_pin_in_query_string_is_rejected(client):
    assert client.get(f"/api/admin/summary?pin={settings.admin_pin}").status_code == 401


def test_login_cookie_does_not_contain_pin(client):
    res = client.post("/api/auth/login", json={"pin": settings.admin_pin})
    assert res.status_code == 200
    cookie = res.headers["set-cookie"]
    assert f"={settings.admin_pin};" not in cookie
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert client.get("/api/admin/summary").status_code == 200  # session cookie works


def test_wrong_pin_is_rate_limited_even_for_correct_pin(client):
    for _ in range(auth_module.MAX_FAILS_PER_CLIENT):
        assert client.post("/api/auth/login", json={"pin": "0000x"}).status_code == 401
    assert client.post("/api/auth/login", json={"pin": "0000x"}).status_code == 429
    assert client.post("/api/auth/login", json={"pin": settings.admin_pin}).status_code == 429
    assert client.get("/api/admin/summary", headers={"X-Admin-PIN": settings.admin_pin}).status_code == 429


def test_header_guessing_also_counts_as_failures(client):
    for _ in range(auth_module.MAX_FAILS_PER_CLIENT):
        assert client.get("/api/admin/summary", headers={"X-Admin-PIN": "bad"}).status_code == 401
    assert client.get("/api/admin/summary", headers={"X-Admin-PIN": "bad"}).status_code == 429


@pytest.mark.parametrize("payload", [
    {"max_solo_per_participant": "banana"},
    {"max_performances_per_participant": 9999},
    {"signup_enabled": "maybe"},
    {"performance_types": "Solo"},
    {"age_groups": [{"requires_guardian": True}]},
    {"not_a_real_setting": "x"},
])
def test_invalid_settings_are_rejected(admin, payload):
    res = admin.put("/api/admin/settings", json={"settings": payload})
    assert res.status_code == 400, res.text


def test_valid_settings_roundtrip_and_signup_still_works(admin, client):
    res = admin.put("/api/admin/settings", json={"settings": {"max_solo_per_participant": "2", "signup_enabled": "true"}})
    assert res.status_code == 200
    ok = client.post("/api/signup", json={
        "performer_name": "Another One", "contact_info": "6105550199", "age_group": "Senior",
        "performances": [{"performance_type": "Solo", "song_title": "X"}],
    })
    assert ok.status_code == 200, ok.text


def test_data_mount_blocks_tracks_exports_and_database_files(client):
    for sub in ("cache", "db", "tracks", "backups"):
        os.makedirs(os.path.join(DATA_DIR, sub), exist_ok=True)
    secret = os.path.join(DATA_DIR, "tracks", "leak.png")
    dbfile = os.path.join(DATA_DIR, "event.db")
    for p in (secret, dbfile):
        with open(p, "w") as f:
            f.write("x")
    try:
        assert client.get("/data/tracks/leak.png").status_code == 404
        assert client.get("/data/event.db").status_code == 404
        assert client.get("/data/signups.xlsx").status_code == 404
    finally:
        for p in (secret, dbfile):
            os.remove(p)


def test_console_disabled_blocks_stage_control(admin):
    admin.put("/api/admin/settings", json={"settings": {"console_enabled": False}})
    assert admin.post("/api/set-active/PK-002").status_code == 403
    assert admin.post("/api/clear-active").status_code == 403
    admin.put("/api/admin/settings", json={"settings": {"console_enabled": True}})
    assert admin.post("/api/clear-active").status_code == 200


def test_live_display_disabled_returns_empty_schedule(admin, client):
    _signup_junior(client)
    admin.put("/api/admin/settings", json={"settings": {"live_display_enabled": False}})
    live = client.get("/api/live-status").json()
    assert live["live_display_enabled"] is False
    assert live["upcoming"] == [] and live["up_next"] == [] and live["now_performing"] is None


def test_dashboard_and_signup_scripts_escape_user_content():
    here = os.path.dirname(os.path.dirname(__file__))
    js = open(os.path.join(here, "app", "static", "js", "dashboard.js"), encoding="utf-8").read()
    for raw in ("${item.signer_name}", "${item.dish_description}", "${p.display_performer}", "${group.name}", "${item.name}"):
        assert raw not in js, f"unescaped {raw} in dashboard.js"
    signup = open(os.path.join(here, "app", "static", "js", "signup.js"), encoding="utf-8").read()
    assert "${item.signer_name" not in signup.replace("escapeHtml(item.signer_name", "")


def test_legacy_database_is_migrated_into_event_folder(tmp_path, monkeypatch):
    import sqlite3
    from app.repositories.base import DatabaseManager
    cache = tmp_path / "old_cache"; event = tmp_path / "new_event_folder"
    cache.mkdir()
    legacy = sqlite3.connect(cache / "event_data.db")
    legacy.execute("CREATE TABLE t (v TEXT)"); legacy.execute("INSERT INTO t VALUES ('kept')"); legacy.commit(); legacy.close()
    monkeypatch.setattr(settings.storage, "cache_dir", str(cache))
    monkeypatch.setattr(settings.storage, "event_dir", str(event))
    path = DatabaseManager().db_path
    assert path == str(event / "event.db")
    assert sqlite3.connect(path).execute("SELECT v FROM t").fetchone()[0] == "kept"


def test_cache_pruning_never_deletes_database_files(tmp_path, monkeypatch):
    from app.services.audio_service import audio_service
    monkeypatch.setattr(audio_service, "cache_dir", str(tmp_path))
    (tmp_path / "event_data.db").write_bytes(b"d" * 1024 * 1024)
    (tmp_path / "PK-001.mp3").write_bytes(b"a" * 1024 * 1024)
    audio_service.prune_cache_if_needed(max_size_mb=1, target_size_mb=0)
    assert (tmp_path / "event_data.db").exists()


# --------------------------------------------------------------------------- operator (sound console) PIN
@pytest.fixture
def operator_pin(monkeypatch):
    monkeypatch.setattr(settings, "operator_pin", "7777")
    return "7777"


def test_operator_pin_runs_the_console_but_not_admin(operator_pin, client):
    op = {"X-Admin-PIN": operator_pin}
    eid = _signup_junior(client)
    assert client.post(f"/api/set-active/{eid}", headers=op).status_code == 200
    assert client.post("/api/clear-active", headers=op).status_code == 200
    assert client.get("/api/admin/settings", headers=op).status_code == 403
    assert client.get("/api/admin/roster", headers=op).status_code == 403
    assert client.put("/api/admin/settings", headers=op, json={"settings": {"signup_enabled": False}}).status_code == 403
    assert client.post("/api/admin/apply-preset", headers=op, json={"preset": "potluck"}).status_code == 403


def test_operator_never_sees_phone_numbers(operator_pin, client):
    _signup_junior(client)
    queue = client.get("/api/stage-queue", headers={"X-Admin-PIN": operator_pin})
    assert queue.status_code == 200 and PHONE not in queue.text


def test_operator_login_sets_a_role_scoped_cookie(operator_pin, client):
    res = client.post("/api/auth/login", json={"pin": operator_pin})
    assert res.status_code == 200 and res.json()["role"] == "operator"
    assert "operator_session" in res.headers["set-cookie"] and operator_pin not in res.headers["set-cookie"]
    assert client.post("/api/clear-active").status_code == 200       # cookie opens the console
    assert client.get("/api/admin/summary").status_code == 403         # but not admin


def test_wrong_role_does_not_count_as_a_failed_guess(operator_pin, client):
    for _ in range(auth_module.MAX_FAILS_PER_CLIENT + 2):
        assert client.get("/api/admin/summary", headers={"X-Admin-PIN": operator_pin}).status_code == 403
    assert client.get("/api/admin/summary", headers={"X-Admin-PIN": settings.admin_pin}).status_code == 200


def test_operator_pin_is_off_by_default_and_cannot_equal_admin_pin(monkeypatch, client):
    monkeypatch.setattr(settings, "operator_pin", "")
    assert client.post("/api/auth/login", json={"pin": ""}).status_code == 401
    monkeypatch.setattr(settings, "operator_pin", settings.admin_pin)
    res = client.post("/api/auth/login", json={"pin": settings.admin_pin})
    assert res.json()["role"] == "admin"
