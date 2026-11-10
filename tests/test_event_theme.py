from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_admin_colour_is_public_and_invalid_values_are_rejected():
    client = TestClient(app)
    admin = TestClient(app, headers={"X-Admin-PIN": settings.admin_pin})
    assert client.get("/api/event-info").json()["theme_accent"] == "coral"
    assert client.put("/api/admin/settings", json={"theme_accent": "blue"}).status_code in (401, 403)
    assert admin.put("/api/admin/settings", json={"theme_accent": "blue"}).status_code == 200
    assert client.get("/api/event-info").json()["theme_accent"] == "blue"
    assert admin.put("/api/admin/settings", json={"theme_accent": "invalid"}).status_code == 400
    assert client.get("/api/event-info").json()["theme_accent"] == "blue"
