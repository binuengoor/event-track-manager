import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.admin_service import admin_service


@pytest.fixture(autouse=True)
def reset_passcode():
    admin_service.update_settings({"event_passcode": ""})
    yield
    admin_service.update_settings({"event_passcode": ""})


def test_passcode_off_by_default():
    client = TestClient(app)
    # When passcode is empty, guest pages and public APIs are accessible without credentials
    res = client.get("/")
    assert res.status_code == 200
    res = client.get("/api/event-info")
    assert res.status_code == 200
    res = client.get("/signup")
    assert res.status_code == 200
    res = client.get("/api/health")
    assert res.status_code == 200


def test_admin_can_update_event_passcode():
    client = TestClient(app)
    res = client.put(
        "/api/admin/settings",
        json={"event_passcode": "open-sesame"},
        headers={"X-Admin-PIN": settings.admin_pin},
    )
    assert res.status_code == 200
    cur = admin_service.get_settings()
    assert cur["event_passcode"] == "open-sesame"


def test_gated_when_passcode_is_set():
    admin_service.update_settings({"event_passcode": "stage2026"})
    client = TestClient(app)

    # Guest pages redirect to gate
    res = client.get("/", follow_redirects=False)
    assert res.status_code in (302, 303, 307)
    assert "/gate" in res.headers.get("location", "")

    res = client.get("/signup", follow_redirects=False)
    assert res.status_code in (302, 303, 307)
    assert "/gate" in res.headers.get("location", "")

    # Public APIs return 401
    res = client.get("/api/event-info")
    assert res.status_code == 401
    assert "passcode" in res.json().get("detail", "").lower()

    res = client.get("/api/signup/config")
    assert res.status_code == 401

    # EXEMPT endpoints remain accessible without passcode:
    assert client.get("/api/health").status_code == 200
    assert client.get("/live").status_code == 200
    assert client.get("/api/live-status").status_code == 200
    assert client.get("/robots.txt").status_code == 200
    assert client.get("/static/css/tokens.css").status_code == 200

    # Staff with admin credentials can bypass gate
    res = client.get("/api/event-info", headers={"X-Admin-PIN": settings.admin_pin})
    assert res.status_code == 200


def test_unlock_via_query_token():
    admin_service.update_settings({"event_passcode": "stage2026"})
    client = TestClient(app)

    # Valid query token ?t=... allows access and sets cookie
    res = client.get("/signup?t=stage2026", follow_redirects=False)
    assert res.status_code in (200, 302, 303, 307)
    assert "etm_passcode" in res.headers.get("set-cookie", "")

    # Invalid query token ?t=wrong on a client without cookie redirects to gate
    client2 = TestClient(app)
    res2 = client2.get("/signup?t=wrong", follow_redirects=False)
    assert res2.status_code in (302, 303, 307)
    assert "/gate" in res2.headers.get("location", "")


def test_unlock_via_gate_and_api():
    admin_service.update_settings({"event_passcode": "stage2026"})
    client = TestClient(app)

    # Gate page loads cleanly
    res = client.get("/gate")
    assert res.status_code == 200
    assert "passcode" in res.text.lower()

    # Wrong passcode via API -> 401
    res = client.post("/api/auth/passcode", json={"passcode": "wrong"})
    assert res.status_code == 401

    # Correct passcode via API -> 200 + cookie
    res = client.post("/api/auth/passcode", json={"passcode": "stage2026"})
    assert res.status_code == 200
    assert "etm_passcode" in res.headers.get("set-cookie", "")

    # Now with cookie, guest pages and APIs work
    cookie = res.cookies.get("etm_passcode")
    client.cookies.set("etm_passcode", cookie)
    assert client.get("/").status_code == 200
    assert client.get("/api/event-info").status_code == 200
