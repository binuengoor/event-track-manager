import os
import yaml
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field

class EventConfig(BaseModel):
    id: str = "ema-paattukoottam"
    name: str = "EMA Paattukoottam Musical Night"

class DriveFoldersConfig(BaseModel):
    active_folder_id: str = "mock_active_folder"
    archive_folder_id: str = "mock_archive_folder"

class GoogleConfig(BaseModel):
    service_account_json_path: str = "/secrets/credentials.json"
    sheet_id: str = "mock_sheet_id"
    sheet_range: str = "Signups!A2:I"
    drive_folders: DriveFoldersConfig = Field(default_factory=DriveFoldersConfig)

class ColumnsConfig(BaseModel):
    entry_id: int = 0
    performer_name: int = 1
    performance_type: int = 2
    partner_name: int = 3
    song_title: int = 4
    sequence_order: int = 5
    track_status: int = 6
    drive_file_id: int = 7
    last_updated: int = 8

class StorageConfig(BaseModel):
    cache_dir: str = "/data/cache"
    max_upload_size_mb: int = 50

class DownloaderConfig(BaseModel):
    service_url: str = "http://downloader:8001"
    timeout_seconds: int = 120

class AppConfig(BaseModel):
    event: EventConfig = Field(default_factory=EventConfig)
    google: GoogleConfig = Field(default_factory=GoogleConfig)
    columns: ColumnsConfig = Field(default_factory=ColumnsConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    downloader: DownloaderConfig = Field(default_factory=DownloaderConfig)

    admin_pin: str = "2026"
    mock_google_api: bool = False

def load_config() -> AppConfig:
    config_file = os.getenv("CONFIG_PATH", "config.yaml")
    data: Dict[str, Any] = {}

    if os.path.isfile(config_file):
        with open(config_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

    config = AppConfig(**data)

    # Environment variable overrides
    if os.getenv("ADMIN_PIN"):
        config.admin_pin = os.getenv("ADMIN_PIN")

    creds_path = os.getenv("GOOGLE_CREDENTIALS_PATH", config.google.service_account_json_path)
    config.google.service_account_json_path = creds_path

    # If explicitly enabled, or if credentials file doesn't exist, enable mock mode
    mock_env = os.getenv("MOCK_GOOGLE_API", "").lower()
    if mock_env in ("true", "1", "yes"):
        config.mock_google_api = True
    elif not os.path.isfile(creds_path) or config.google.sheet_id.startswith("REPLACE_WITH"):
        config.mock_google_api = True

    if os.getenv("DOWNLOADER_SERVICE_URL"):
        config.downloader.service_url = os.getenv("DOWNLOADER_SERVICE_URL")

    # Cache directory handling (Docker container vs local host)
    if os.getenv("CACHE_DIR"):
        config.storage.cache_dir = os.getenv("CACHE_DIR")
    elif not os.path.exists("/.dockerenv") and config.storage.cache_dir.startswith("/data"):
        config.storage.cache_dir = "./data/cache"

    try:
        os.makedirs(config.storage.cache_dir, exist_ok=True)
    except OSError:
        config.storage.cache_dir = "./data/cache"
        os.makedirs(config.storage.cache_dir, exist_ok=True)

    return config

settings = load_config()
