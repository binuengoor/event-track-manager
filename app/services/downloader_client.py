import logging
from typing import Optional, Dict, Any
import httpx
from app.config import settings

logger = logging.getLogger("downloader-client")

class DownloaderClient:
    def __init__(self, service_url: Optional[str] = None, timeout: int = 120):
        self.service_url = (service_url or settings.downloader.service_url).rstrip("/")
        self.timeout = timeout

    async def check_health(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.service_url}/health")
                if res.status_code == 200:
                    return res.json()
        except Exception as e:
            logger.warning("Downloader service health check failed: %s", e)
        return {"status": "unavailable"}

    async def extract_audio(self, url: str, entry_id: str) -> Dict[str, Any]:
        endpoint = f"{self.service_url}/api/extract"
        payload = {"url": url, "entry_id": entry_id}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(endpoint, json=payload)
            except httpx.ConnectError:
                raise RuntimeError("Downloader microservice is unreachable. Please verify the downloader container is running.")
            except httpx.TimeoutException:
                raise RuntimeError("Audio extraction timed out after 120 seconds. The video may be too long or YouTube throttled the connection.")

        if response.status_code != 200:
            err_data = response.json() if response.headers.get("content-type") == "application/json" else {}
            detail = err_data.get("detail", f"Extraction failed with status {response.status_code}: {response.text[:120]}")
            raise RuntimeError(detail)

        return response.json()

downloader_client = DownloaderClient()
