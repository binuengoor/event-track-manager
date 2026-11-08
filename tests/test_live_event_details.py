import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture
def admin():
    client = TestClient(app)
    client.headers.update({"X-Admin-PIN": settings.admin_pin})
    return client


@pytest.fixture
def client():
    return TestClient(app)


def test_doors_and_post_event_link_round_trip_to_public_live_status(admin, client):
    values = {
        "doors_open_time": "Doors open at 5:30 PM",
        "post_event_link_url": "https://example.org/photos-and-feedback?event=2026",
    }
    saved = admin.put("/api/admin/settings", json={"settings": values})
    assert saved.status_code == 200, saved.text
    details = admin.get("/api/admin/settings").json()
    assert {key: details[key] for key in values} == values

    live = client.get("/api/live-status").json()
    assert live["doors_open_time"] == values["doors_open_time"]
    assert live["post_event_link_url"] == values["post_event_link_url"]


@pytest.mark.parametrize("url", [
    "javascript:alert(1)",
    "ftp://example.org/photos",
    "https://",
    "https://user:password@example.org/photos",
    "example.org/photos",
])
def test_post_event_link_requires_http_or_https_host_without_credentials(admin, url):
    response = admin.put("/api/admin/settings", json={"settings": {"post_event_link_url": url}})
    assert response.status_code == 400, response.text
    assert "http" in response.json()["detail"].lower()


def test_post_event_link_can_be_cleared_and_doors_time_is_optional_text(admin, client):
    response = admin.put("/api/admin/settings", json={"settings": {
        "doors_open_time": "",
        "post_event_link_url": "",
    }})
    assert response.status_code == 200, response.text
    live = client.get("/api/live-status").json()
    assert live["doors_open_time"] == ""
    assert live["post_event_link_url"] == ""


def test_new_event_does_not_copy_doors_or_post_event_link(admin, client):
    saved = admin.put("/api/admin/settings", json={"settings": {
        "doors_open_time": "5:00 PM",
        "post_event_link_url": "https://example.org/old-event",
    }})
    assert saved.status_code == 200

    created = admin.post("/api/admin/events", json={"name": "Next Event Details", "copy_from": "current"})
    assert created.status_code == 200, created.text
    details = admin.get("/api/admin/settings").json()
    assert details["doors_open_time"] == ""
    assert details["post_event_link_url"] == ""
    live = client.get("/api/live-status").json()
    assert live["doors_open_time"] == ""
    assert live["post_event_link_url"] == ""
