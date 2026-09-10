import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_dashboard_endpoints(client):
    # 1. Performances board
    res_p = client.get("/api/dashboard/performances")
    assert res_p.status_code == 200
    p_data = res_p.json()
    assert isinstance(p_data, list)
    if len(p_data) > 0:
        first_p = p_data[0]
        assert "entry_id" in first_p
        assert "performer_name" in first_p
        assert "performance_type" in first_p

    # 2. Food board
    res_f = client.get("/api/dashboard/food")
    assert res_f.status_code == 200
    f_data = res_f.json()
    assert "groups" in f_data
    assert "serving_note" in f_data
    assert "enabled" in f_data
    assert isinstance(f_data["groups"], list)
    if f_data["groups"]:
        first_g = f_data["groups"][0]
        assert "group_id" in first_g
        assert "name" in first_g
