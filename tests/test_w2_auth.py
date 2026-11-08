import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.routers import auth as auth_module
from app.routers.auth import register_auth_handlers, failure_limiter


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("TRUST_CLOUDFLARE", raising=False)
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    register_auth_handlers(app)
    app.middleware_stack = None  # rebuild so the handler registered above is live
    return TestClient(app)


def test_missing_credentials_never_lock_out_the_organizer(client):
    for _ in range(auth_module.MAX_FAILS_PER_CLIENT * 3):
        assert client.get("/api/admin/settings").status_code == 401
    res = client.post("/api/auth/login", json={"pin": settings.admin_pin})
    assert res.status_code == 200
    assert client.get("/api/admin/settings").status_code == 200


def test_empty_login_pin_is_not_counted(client):
    for _ in range(auth_module.MAX_FAILS_PER_CLIENT * 2):
        assert client.post("/api/auth/login", json={"pin": ""}).status_code == 401
    assert client.post("/api/auth/login", json={"pin": settings.admin_pin}).status_code == 200


def test_wrong_pin_header_still_locks_out_with_retry_after(client):
    bad = {"X-Admin-PIN": "wrong-pin"}
    for _ in range(auth_module.MAX_FAILS_PER_CLIENT):
        assert client.get("/api/admin/settings", headers=bad).status_code == 401
    res = client.get("/api/admin/settings", headers=bad)
    assert res.status_code == 429
    body = res.json()
    assert int(res.headers["Retry-After"]) == body["retry_after"] > 0
    assert body["retry_after"] <= auth_module.FAIL_WINDOW_SECONDS
    # even the right PIN is refused during lockout
    assert client.post("/api/auth/login", json={"pin": settings.admin_pin}).status_code == 429


def test_bad_cookie_counts(client):
    client.cookies.set("admin_session", "stale")
    for _ in range(auth_module.MAX_FAILS_PER_CLIENT):
        assert client.get("/api/admin/settings").status_code == 401
    assert client.get("/api/admin/settings").status_code == 429


def test_global_limit_blocks_every_client(client, monkeypatch):
    monkeypatch.setattr(auth_module, "MAX_FAILS_GLOBAL", 3)
    for i in range(3):
        failure_limiter.record_failure(f"10.0.0.{i}")
    res = client.post("/api/auth/login", json={"pin": settings.admin_pin})
    assert res.status_code == 429 and res.headers["Retry-After"]


def test_rotating_forwarded_for_cannot_dodge_lockout_by_default(client):
    for i in range(auth_module.MAX_FAILS_PER_CLIENT):
        res = client.post("/api/auth/login", json={"pin": "bad-pin"}, headers={"X-Forwarded-For": f"9.9.9.{i}"})
        assert res.status_code == 401
    res = client.post("/api/auth/login", json={"pin": "bad-pin"}, headers={"X-Forwarded-For": "9.9.9.200"})
    assert res.status_code == 429


def test_forwarded_for_is_the_key_only_when_proxy_is_trusted(client, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY", "true")
    for _ in range(auth_module.MAX_FAILS_PER_CLIENT):
        assert client.post("/api/auth/login", json={"pin": "bad-pin"}, headers={"X-Forwarded-For": "7.7.7.7"}).status_code == 401
    assert client.post("/api/auth/login", json={"pin": "bad-pin"}, headers={"X-Forwarded-For": "7.7.7.7"}).status_code == 429
    # a different forwarded client is unaffected
    assert client.post("/api/auth/login", json={"pin": settings.admin_pin}, headers={"X-Forwarded-For": "8.8.8.8"}).status_code == 200


def test_cloudflare_header_ignored_unless_trusted(monkeypatch):
    from types import SimpleNamespace
    req = SimpleNamespace(headers={"cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2"},
                          client=SimpleNamespace(host="3.3.3.3"))
    monkeypatch.delenv("TRUST_CLOUDFLARE", raising=False)
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    assert auth_module.client_key(req) == "3.3.3.3"
    monkeypatch.setenv("TRUST_CLOUDFLARE", "1")
    assert auth_module.client_key(req) == "1.1.1.1"


def test_logout_clears_admin_session():
    from app.config import settings
    client = TestClient(app)
    assert client.post("/api/auth/login", json={"pin": settings.admin_pin}).status_code == 200
    assert client.get("/api/admin/settings").status_code == 200       # cookie session works
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/admin/settings").status_code == 401       # cookie is gone
    assert client.post("/api/auth/logout").status_code == 200          # safe when already signed out
