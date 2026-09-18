import io
import zipfile
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_service_worker_endpoint():
    res = client.get("/sw.js")
    assert res.status_code == 200
    assert "application/javascript" in res.headers.get("content-type", "")
    assert res.headers.get("service-worker-allowed") == "/"
    assert "no-cache" in res.headers.get("cache-control", "")
    assert "paattukoottam-console" in res.text

def test_export_tracks_zip_auth():
    # Without PIN should return 401 Unauthorized
    res = client.get("/api/admin/export-tracks-zip")
    assert res.status_code == 401

def test_export_tracks_zip_success():
    res = client.get("/api/admin/export-tracks-zip", headers={"x-admin-pin": "2026"})
    assert res.status_code == 200
    assert "application/zip" in res.headers.get("content-type", "")
    assert "attachment; filename=" in res.headers.get("content-disposition", "")

    # Read zip bytes and verify archive validity
    zip_bytes = io.BytesIO(res.content)
    with zipfile.ZipFile(zip_bytes, "r") as zf:
        namelist = zf.namelist()
        assert "00_Show_Run_Sheet.txt" in namelist
        assert "00_SEQUENCE_MANIFEST.txt" in namelist

        run_sheet = zf.read("00_Show_Run_Sheet.txt").decode("utf-8")
        assert "EMA Paattukoottam" in run_sheet
        assert "Show Run Sheet" in run_sheet

def test_export_tracks_zip_query_param_pin():
    res = client.get("/api/admin/export-tracks-zip?pin=2026")
    assert res.status_code == 200
    assert "application/zip" in res.headers.get("content-type", "")
