import os

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services.stage_service import stage_service


PNG = b"\x89PNG\r\n\x1a\n" + b"test image bytes"
JPEG = b"\xff\xd8\xff" + b"test jpeg bytes"
MP4 = b"\x00\x00\x00\x18ftypisom" + b"test mp4 bytes"
WEBM = b"\x1a\x45\xdf\xa3" + b"test webm bytes"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin():
    client = TestClient(app)
    client.headers.update({"X-Admin-PIN": settings.admin_pin})
    return client


def test_poster_upload_requires_admin_validates_magic_and_updates_event_info(admin, client):
    assert client.post("/api/admin/poster", files={"file": ("poster.png", PNG, "image/png")}).status_code == 401

    bad = admin.post("/api/admin/poster", files={"file": ("poster.png", JPEG, "image/png")})
    assert bad.status_code == 400

    response = admin.post("/api/admin/poster", files={"file": ("poster.png", PNG, "image/png")})
    assert response.status_code == 200, response.text
    url = response.json()["url"]
    assert url.startswith("/event-media/")
    served = client.get(url)
    assert served.content == PNG
    assert served.headers["cache-control"] == "no-store"
    assert client.get("/api/event-info").json()["poster_url"] == url


def test_poster_replacement_preserves_previous_upload(admin, client):
    first = admin.post("/api/admin/poster", files={"file": ("poster.png", PNG, "image/png")}).json()
    second = admin.post("/api/admin/poster", files={"file": ("poster.jpg", JPEG, "image/jpeg")}).json()
    assert first["url"] != second["url"]
    assert client.get(first["url"]).content == PNG
    assert client.get(second["url"]).content == JPEG
    assert client.get("/api/event-info").json()["poster_url"] == second["url"]


def test_gallery_upload_order_delete_and_live_feed(admin, client):
    assert client.post("/api/admin/gallery", files={"file": ("a.png", PNG, "image/png")}).status_code == 401
    first = admin.post("/api/admin/gallery", files={"file": ("a.png", PNG, "image/png")})
    second = admin.post("/api/admin/gallery", files={"file": ("b.mp4", MP4, "video/mp4")})
    assert first.status_code == 200 and second.status_code == 200
    a, b = first.json(), second.json()
    assert a["url"].startswith("/event-media/gallery/")
    image_response = client.get(a["url"])
    assert image_response.content == PNG
    assert image_response.headers["cache-control"] == "no-store"
    assert client.get(b["url"]).headers["content-type"].startswith("video/mp4")

    files = admin.get("/api/admin/gallery").json()["files"]
    assert {item["name"] for item in files} == {a["name"], b["name"]}
    ordered = admin.put("/api/admin/gallery/order", json={"filenames": [b["name"], a["name"]]})
    assert ordered.status_code == 200, ordered.text
    assert stage_service.get_gallery_images() == [b["url"], a["url"]]

    assert admin.request("DELETE", "/api/admin/gallery", json={"filename": b["name"]}).status_code == 200
    assert client.get(b["url"]).status_code == 404
    assert [item["name"] for item in admin.get("/api/admin/gallery").json()["files"]] == [a["name"]]


def test_gallery_upload_rejects_magic_mismatch_and_traversal(admin):
    mismatch = admin.post("/api/admin/gallery", files={"file": ("sponsor.png", JPEG, "image/png")})
    assert mismatch.status_code == 400
    assert admin.request("DELETE", "/api/admin/gallery", json={"filename": "../poster.png"}).status_code == 400
    assert admin.put("/api/admin/gallery/order", json={"filenames": ["../../outside.png"]}).status_code == 400


def test_gallery_management_endpoints_require_admin(client):
    assert client.get("/api/admin/gallery").status_code == 401
    assert client.request("DELETE", "/api/admin/gallery", json={"filename": "sponsor.png"}).status_code == 401
    assert client.put("/api/admin/gallery/order", json={"filenames": []}).status_code == 401


def test_media_upload_caps_are_enforced_while_streaming(admin, monkeypatch):
    from app.services import media_asset_service

    monkeypatch.setattr(media_asset_service, "MAX_IMAGE_BYTES", 8)
    response = admin.post("/api/admin/gallery", files={"file": ("large.png", PNG, "image/png")})
    assert response.status_code == 413


def test_event_media_urls_follow_active_event_and_are_path_scoped(admin, client, monkeypatch, tmp_path):
    data_dir = tmp_path / "legacy-public-data"
    data_dir.mkdir()
    (data_dir / "shared.png").write_bytes(PNG)
    monkeypatch.setenv("DATA_DIR", str(data_dir))

    uploaded = admin.post("/api/admin/poster", files={"file": ("poster.png", PNG, "image/png")}).json()
    old_url = uploaded["url"]
    assert client.get(old_url).content == PNG
    assert client.get("/data/shared.png").content == PNG
    assert (data_dir / uploaded["filename"]).exists() is False
    assert os.path.isfile(os.path.join(settings.storage.event_dir, uploaded["filename"]))

    other_dir = tmp_path / "other-event"
    other_dir.mkdir()
    (other_dir / "gallery").mkdir()
    monkeypatch.setattr(settings.storage, "event_dir", str(other_dir))
    monkeypatch.setattr(settings.storage, "gallery_dir", str(other_dir / "gallery"))
    monkeypatch.setattr(settings.event, "id", "other-event")
    assert client.get(old_url).status_code == 404

    assert client.get("/event-media/%2e%2e%2foutside.png").status_code == 404
    assert client.get("/event-media/gallery/%2e%2e%2foutside.png").status_code == 404


def test_new_event_does_not_inherit_poster_or_gallery_order(admin, client):
    poster = admin.post("/api/admin/poster", files={"file": ("poster.png", PNG, "image/png")}).json()
    gallery = admin.post("/api/admin/gallery", files={"file": ("sponsor.png", PNG, "image/png")}).json()

    created = admin.post("/api/admin/events", json={"name": "Separate Media Event", "copy_from": "current"})
    assert created.status_code == 200, created.text
    assert admin.get("/api/admin/gallery").json()["files"] == []
    assert client.get(gallery["url"]).status_code == 404
    assert client.get(poster["url"]).status_code == 404
    assert client.get("/api/event-info").json()["poster_url"] == ""


def test_upload_aborts_setting_update_if_active_event_changes_midstream(admin, monkeypatch, tmp_path):
    from app.services import media_asset_service

    other_dir = tmp_path / "switched-event"
    other_gallery = other_dir / "gallery"
    other_gallery.mkdir(parents=True)
    prior_event_id = settings.event.id
    prior_event_dir = settings.storage.event_dir
    prior_gallery_dir = settings.storage.gallery_dir
    saved_paths = []
    original_store = media_asset_service.media_asset_service._store_upload

    async def store_then_switch(upload, directory, prefix, allowed):
        stored = await original_store(upload, directory, prefix, allowed)
        saved_paths.append(stored["path"])
        monkeypatch.setattr(settings.event, "id", "switched-event")
        monkeypatch.setattr(settings.storage, "event_dir", str(other_dir))
        monkeypatch.setattr(settings.storage, "gallery_dir", str(other_gallery))
        return stored

    monkeypatch.setattr(media_asset_service.media_asset_service, "_store_upload", store_then_switch)
    response = admin.post("/api/admin/poster", files={"file": ("poster.png", PNG, "image/png")})
    assert response.status_code == 409, response.text
    assert saved_paths and os.path.isfile(saved_paths[0])
    assert settings.event.id == "switched-event"
    assert prior_event_id != settings.event.id
    assert prior_event_dir != settings.storage.event_dir
    assert prior_gallery_dir != settings.storage.gallery_dir


def test_gallery_upload_stays_hidden_if_event_switches_midstream(admin, monkeypatch, tmp_path):
    from app.services import media_asset_service

    other_dir = tmp_path / "switched-event"
    other_gallery = other_dir / "gallery"
    other_gallery.mkdir(parents=True)
    old_event_id = settings.event.id
    old_event_dir = settings.storage.event_dir
    old_gallery_dir = settings.storage.gallery_dir
    saved_paths = []
    asset_service = media_asset_service.media_asset_service
    original_store = asset_service._store_upload

    async def store_then_switch(upload, directory, prefix, allowed):
        stored = await original_store(upload, directory, prefix, allowed)
        saved_paths.append(stored["path"])
        monkeypatch.setattr(settings.event, "id", "switched-event")
        monkeypatch.setattr(settings.storage, "event_dir", str(other_dir))
        monkeypatch.setattr(settings.storage, "gallery_dir", str(other_gallery))
        return stored

    monkeypatch.setattr(asset_service, "_store_upload", store_then_switch)
    response = admin.post("/api/admin/gallery", files={"file": ("sponsor.png", PNG, "image/png")})
    assert response.status_code == 409, response.text
    assert saved_paths and os.path.isfile(saved_paths[0])
    assert os.path.basename(saved_paths[0]).startswith(".media-upload-")

    monkeypatch.setattr(settings.event, "id", old_event_id)
    monkeypatch.setattr(settings.storage, "event_dir", old_event_dir)
    monkeypatch.setattr(settings.storage, "gallery_dir", old_gallery_dir)
    assert admin.get("/api/admin/gallery").json()["files"] == []


def test_gallery_limit_is_checked_again_at_locked_finalization(admin, monkeypatch):
    from app.services import media_asset_service

    monkeypatch.setattr(media_asset_service, "MAX_GALLERY_ITEMS", 1)
    asset_service = media_asset_service.media_asset_service
    original_store = asset_service._store_upload
    raced_path = os.path.join(settings.storage.gallery_dir, "sponsor-concurrent.png")

    async def store_then_race(upload, directory, prefix, allowed):
        stored = await original_store(upload, directory, prefix, allowed)
        with open(raced_path, "wb") as output:
            output.write(PNG)
        return stored

    monkeypatch.setattr(asset_service, "_store_upload", store_then_race)
    response = admin.post("/api/admin/gallery", files={"file": ("sponsor.png", PNG, "image/png")})
    assert response.status_code == 400, response.text
    assert os.path.isfile(raced_path)
    assert len(os.listdir(settings.storage.gallery_dir)) == 1


def test_shared_gallery_override_blocks_mutations_but_preserves_reads(admin, client, monkeypatch):
    monkeypatch.setenv("GALLERY_DIR", settings.storage.gallery_dir)
    shared_file = os.path.join(settings.storage.gallery_dir, "legacy.png")
    with open(shared_file, "wb") as output:
        output.write(PNG)

    upload = admin.post("/api/admin/gallery", files={"file": ("new.png", PNG, "image/png")})
    assert upload.status_code == 409 and "shared" in upload.json()["detail"].lower()
    delete = admin.request("DELETE", "/api/admin/gallery", json={"filename": "legacy.png"})
    assert delete.status_code == 409 and os.path.isfile(shared_file)
    order = admin.put("/api/admin/gallery/order", json={"filenames": ["legacy.png"]})
    assert order.status_code == 409

    files = admin.get("/api/admin/gallery").json()["files"]
    assert [item["name"] for item in files] == ["legacy.png"]
    assert client.get(files[0]["url"]).content == PNG
