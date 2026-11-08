"""Bounded, signature-checked uploads for event posters and sponsor media."""
import os
import tempfile
import uuid
from typing import Any, Dict, List
from urllib.parse import quote

from app.config import get_setting, settings
from app.services.admin_service import admin_service
from app.services.event_service import event_service
from app.services.audio_workflow_service import audio_workflow_service
from app.services.event_manager import event_manager

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024
MAX_GALLERY_ITEMS = 50

IMAGE_MIMES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}
VIDEO_MIMES = {".mp4": "video/mp4", ".webm": "video/webm"}
POSTER_MIMES = {**IMAGE_MIMES, ".mp4": VIDEO_MIMES[".mp4"]}
GALLERY_MIMES = {**IMAGE_MIMES, **VIDEO_MIMES}
GALLERY_PUBLIC_MIMES = {**GALLERY_MIMES, ".svg": "image/svg+xml"}


class MediaAssetError(ValueError):
    pass


class MediaAssetTooLargeError(MediaAssetError):
    pass


class MediaAssetEventChangedError(MediaAssetError):
    pass


class MediaAssetSharedGalleryError(MediaAssetError):
    pass


class MediaAssetService:
    @staticmethod
    def _signature_matches(extension: str, header: bytes) -> bool:
        if extension == ".png":
            return header.startswith(b"\x89PNG\r\n\x1a\n")
        if extension in (".jpg", ".jpeg"):
            return header.startswith(b"\xff\xd8\xff")
        if extension == ".gif":
            return header.startswith((b"GIF87a", b"GIF89a"))
        if extension == ".webp":
            return len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP"
        if extension == ".mp4":
            return len(header) >= 8 and header[4:8] == b"ftyp"
        if extension == ".webm":
            return header.startswith(b"\x1a\x45\xdf\xa3")
        return False

    @staticmethod
    def _gallery_order() -> List[str]:
        value = get_setting("gallery_order", [])
        return value if isinstance(value, list) and all(isinstance(name, str) for name in value) else []

    def _gallery_names(self, folder: str = "") -> List[str]:
        folder = folder or settings.storage.gallery_dir
        if not folder or not os.path.isdir(folder):
            return []
        try:
            names = [
                name for name in os.listdir(folder)
                if not name.startswith(".")
                and os.path.splitext(name)[1].lower() in GALLERY_PUBLIC_MIMES
                and os.path.isfile(os.path.join(folder, name))
                and not os.path.islink(os.path.join(folder, name))
            ]
        except OSError:
            return []
        present = set(names)
        ordered = [name for name in self._gallery_order() if name in present]
        ordered_set = set(ordered)
        return ordered + sorted(name for name in names if name not in ordered_set)

    def gallery_items(self) -> List[Dict[str, str]]:
        with event_service._lock:
            return [{"name": name, "url": f"/event-media/gallery/{quote(name)}"} for name in self._gallery_names()]

    async def _store_upload(self, upload, directory: str, prefix: str, allowed: Dict[str, str]) -> Dict[str, str]:
        original = os.path.basename(upload.filename or "")
        extension = os.path.splitext(original)[1].lower()
        if extension not in allowed:
            raise MediaAssetError("This file type is not supported.")
        cap = MAX_VIDEO_BYTES if extension in VIDEO_MIMES else MAX_IMAGE_BYTES

        os.makedirs(directory, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".media-upload-", dir=directory)
        total = 0
        header = bytearray()
        try:
            with os.fdopen(fd, "wb") as output:
                while True:
                    chunk = await upload.read(256 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > cap:
                        raise MediaAssetTooLargeError(f"File exceeds the {cap // (1024 * 1024)} MB upload limit.")
                    if len(header) < 32:
                        header.extend(chunk[:32 - len(header)])
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if total == 0:
                raise MediaAssetError("The uploaded file is empty.")
            if not self._signature_matches(extension, bytes(header)):
                raise MediaAssetError("The file contents do not match the file extension.")

            name = f"{prefix}-{uuid.uuid4().hex}{extension}"
            destination = os.path.join(directory, name)
            return {"name": name, "path": temporary, "destination": destination,
                    "mime_type": allowed[extension]}
        except BaseException:
            if os.path.exists(temporary):
                os.remove(temporary)
            raise

    async def upload_poster(self, upload) -> Dict[str, str]:
        with event_service._lock:
            event_id, event_dir, gallery_dir = settings.event.id, settings.storage.event_dir, settings.storage.gallery_dir
        stored = await self._store_upload(upload, event_dir, "poster", POSTER_MIMES)
        url = f"/event-media/{quote(stored['name'])}"
        await self._run_finalizer(self._finish_poster_upload, event_id, event_dir, gallery_dir,
                                  stored["path"], stored["destination"], url)
        return {"filename": stored["name"], "url": url}

    async def upload_gallery(self, upload) -> Dict[str, str]:
        with event_service._lock:
            self._ensure_gallery_mutable()
            event_id, event_dir, gallery_dir = settings.event.id, settings.storage.event_dir, settings.storage.gallery_dir
            names = self._gallery_names(gallery_dir)
        if len(names) >= MAX_GALLERY_ITEMS:
            raise MediaAssetError(f"The gallery is limited to {MAX_GALLERY_ITEMS} files.")
        stored = await self._store_upload(upload, gallery_dir, "sponsor", GALLERY_MIMES)
        await self._run_finalizer(
            self._finish_gallery_upload, event_id, event_dir, gallery_dir,
            stored["path"], stored["destination"], stored["name"])
        return {"name": stored["name"], "url": f"/event-media/gallery/{quote(stored['name'])}"}

    async def _run_finalizer(self, function, *args):
        return await audio_workflow_service.run_thread_to_completion(function, *args)

    @staticmethod
    def _ensure_active_event(event_id: str, event_dir: str, gallery_dir: str) -> None:
        if (settings.event.id != event_id or settings.storage.event_dir != event_dir
                or settings.storage.gallery_dir != gallery_dir):
            raise MediaAssetEventChangedError(
                "The active event changed during upload. The file was kept with the prior event but not attached; retry for the selected event.")

    @staticmethod
    def _ensure_gallery_mutable() -> None:
        if os.getenv("GALLERY_DIR") and event_manager.switching_enabled():
            raise MediaAssetSharedGalleryError(
                "Gallery changes are disabled because GALLERY_DIR is shared while event switching is enabled. "
                "Unset GALLERY_DIR or pin the app to one event before changing gallery files.")

    @staticmethod
    def _finish_poster_upload(event_id: str, event_dir: str, gallery_dir: str,
                              staged_path: str, destination: str, url: str) -> None:
        with event_service._lock:
            try:
                MediaAssetService._ensure_active_event(event_id, event_dir, gallery_dir)
                os.chmod(staged_path, 0o644)
                os.replace(staged_path, destination)
                admin_service.update_settings({"event_poster_url": url})
            except MediaAssetEventChangedError:
                raise
            except BaseException:
                if get_setting("event_poster_url") != url and os.path.exists(destination):
                    os.replace(destination, staged_path)
                raise

    @staticmethod
    def _finish_gallery_upload(event_id: str, event_dir: str, gallery_dir: str,
                               staged_path: str, destination: str, filename: str) -> None:
        with event_service._lock:
            MediaAssetService._ensure_active_event(event_id, event_dir, gallery_dir)
            MediaAssetService._ensure_gallery_mutable()
            names = media_asset_service._gallery_names(gallery_dir)
            if len(names) >= MAX_GALLERY_ITEMS:
                if os.path.exists(staged_path):
                    os.remove(staged_path)
                raise MediaAssetError(f"The gallery is limited to {MAX_GALLERY_ITEMS} files.")
            os.chmod(staged_path, 0o644)
            os.replace(staged_path, destination)
            try:
                names = media_asset_service._gallery_names(gallery_dir)
                if filename not in names:
                    raise MediaAssetError("The uploaded file is no longer in the gallery folder.")
                saved_order = media_asset_service._gallery_order()
                order = [name for name in saved_order if name in set(names)]
                order.extend(name for name in names if name not in set(order))
                if filename not in order:
                    order.append(filename)
                admin_service.update_settings({"gallery_order": order})
            except BaseException:
                if filename not in (get_setting("gallery_order", []) or []) and os.path.exists(destination):
                    os.replace(destination, staged_path)
                raise

    def delete_gallery_file(self, filename: Any) -> None:
        if not isinstance(filename, str) or not filename or filename != os.path.basename(filename) or filename.startswith("."):
            raise MediaAssetError("Choose a gallery filename, not a path.")
        extension = os.path.splitext(filename)[1].lower()
        if extension not in GALLERY_PUBLIC_MIMES:
            raise MediaAssetError("Gallery file not found.")
        with event_service._lock:
            self._ensure_gallery_mutable()
            folder = settings.storage.gallery_dir
            candidate = os.path.join(folder, filename)
            root = os.path.realpath(folder)
            path = os.path.realpath(candidate)
            if os.path.islink(candidate) or os.path.commonpath((root, path)) != root or not os.path.isfile(path):
                raise FileNotFoundError(filename)
            new_order = [name for name in self._gallery_order() if name != filename]
            admin_service.update_settings({"gallery_order": new_order})
            os.remove(path)

    def set_gallery_order(self, filenames: Any) -> None:
        if not isinstance(filenames, list) or len(filenames) > MAX_GALLERY_ITEMS:
            raise MediaAssetError(f"Gallery order must list up to {MAX_GALLERY_ITEMS} filenames.")
        if any(not isinstance(name, str) or not name or name != os.path.basename(name) for name in filenames):
            raise MediaAssetError("Choose gallery filenames, not paths.")
        if len(filenames) != len(set(filenames)):
            raise MediaAssetError("A gallery file can appear only once in the order.")
        with event_service._lock:
            self._ensure_gallery_mutable()
            current = set(self._gallery_names(settings.storage.gallery_dir))
            if set(filenames) != current:
                raise MediaAssetError("The order must include each current gallery file exactly once.")
            admin_service.update_settings({"gallery_order": filenames})


media_asset_service = MediaAssetService()
