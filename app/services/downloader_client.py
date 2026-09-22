import logging
from typing import Optional, Dict, Any
import httpx
from app.config import settings

logger = logging.getLogger("downloader-client")


class DownloaderClient:
    """HTTP client communicating with the YouTube downloader sidecar service using a pooled connection."""

    def __init__(self, service_url: Optional[str] = None, timeout: int = 120):
        self.service_url = (service_url or settings.downloader.service_url).rstrip("/")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def start(self):
        """Initializes persistent AsyncClient with connection pooling."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)

    async def close(self):
        """Closes the persistent AsyncClient pool."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def _get_client(self, timeout: Optional[float] = None) -> httpx.AsyncClient:
        if self._client is not None and not self._client.is_closed:
            return self._client
        return httpx.AsyncClient(timeout=timeout or self.timeout)

    async def check_health(self) -> Dict[str, Any]:
        try:
            client = self._get_client(timeout=5.0)
            should_close = (client != self._client)
            try:
                res = await client.get(f"{self.service_url}/health")
                if res.status_code == 200:
                    return res.json()
            finally:
                if should_close:
                    await client.aclose()
        except Exception as e:
            logger.warning("Downloader service health check failed: %s", e)
        return {"status": "unavailable"}

    async def extract_audio(self, url: str, entry_id: str, media_type: str = "audio") -> Dict[str, Any]:
        endpoint = f"{self.service_url}/api/extract"
        payload = {"url": url, "entry_id": entry_id, "media_type": media_type}

        client = self._get_client(timeout=self.timeout)
        should_close = (client != self._client)
        try:
            try:
                response = await client.post(endpoint, json=payload)
            except httpx.ConnectError:
                raise RuntimeError("Downloader microservice is unreachable. Please verify the downloader container is running.")
            except httpx.TimeoutException:
                raise RuntimeError("Media extraction timed out after 120 seconds. The video may be too long or YouTube throttled the connection.")
        finally:
            if should_close:
                await client.aclose()

        if response.status_code != 200:
            err_data = response.json() if response.headers.get("content-type") == "application/json" else {}
            detail = err_data.get("detail", f"Extraction failed with status {response.status_code}: {response.text[:120]}")
            raise RuntimeError(detail)

        return response.json()


downloader_client = DownloaderClient()
