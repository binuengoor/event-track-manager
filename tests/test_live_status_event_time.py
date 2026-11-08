import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture
def admin():
    client = TestClient(app)
    client.headers.update({"X-Admin-PIN": settings.admin_pin})
    return client


@pytest.mark.parametrize(("start_time", "legacy_time", "expected"), [
    ("06-14-2027 06:00PM", "", "2027-06-14T18:00:00-04:00"),
    ("", "06/14/2027 06:00 PM", "2027-06-14T18:00:00-04:00"),
    ("2027-06-14T18:00:00+02:00", "", "2027-06-14T18:00:00+02:00"),
])
def test_live_status_uses_current_saved_start_time(admin, start_time, legacy_time, expected):
    response = admin.put("/api/admin/settings", json={"settings": {
        "event_start_time": start_time,
        "event_date_time": legacy_time,
    }})
    assert response.status_code == 200, response.text

    status = admin.get("/api/live-status").json()
    assert status["event_start_time_iso"] == expected
