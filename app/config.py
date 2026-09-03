import os
import yaml
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field

class EventConfig(BaseModel):
    id: str = "ema-paattukoottam-2026"
    name: str = "EMA Paattukoottam Musical Night"

class DriveFoldersConfig(BaseModel):
    active_folder_id: str = "1FQ1goCkaSajLjGv8Yt_vrWTS6krmZufW"
    archive_folder_id: str = "1T6zqI02lKQfLfqpPRjQOhn561uUEKDil"

class GoogleConfig(BaseModel):
    service_account_json_path: str = "/secrets/credentials.json"
    sheet_id: str = "1bRvoj4ZlAmSRz972uhTDMfXlYgksH-BOH-zmygp5YRQ"
    sheet_range: str = "Song Sign-Up!A2:O"
    drive_folders: DriveFoldersConfig = Field(default_factory=DriveFoldersConfig)

class ColumnsConfig(BaseModel):
    entry_id: int = -1          # -1 means auto-generate from row (e.g. PK-002)
    performer_name: int = 0    # Col A: Singer (1)
    performance_type: int = 5  # Col F: Solo/Duet/Group
    partner_name: int = 2      # Col C: Singer (2)
    song_title: int = 8        # Col I: Song Name
    movie_name: int = 9        # Col J: Movie/Album Name
    youtube_url: int = 10      # Col K: Karaoke Youtube URL
    sequence_order: int = 6    # Col G: Sequence
    track_status: int = 11     # Col L: Track Uploaded
    drive_file_id: int = 13    # Col N: Drive File ID
    last_updated: int = 14     # Col O: Last Updated

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

    if os.getenv("ADMIN_PIN"):
        config.admin_pin = os.getenv("ADMIN_PIN")

    creds_path = os.getenv("GOOGLE_CREDENTIALS_PATH", config.google.service_account_json_path)
    config.google.service_account_json_path = creds_path

    mock_env = os.getenv("MOCK_GOOGLE_API", "").lower()
    if mock_env in ("true", "1", "yes"):
        config.mock_google_api = True
    elif not os.path.isfile(creds_path) or config.google.sheet_id.startswith("REPLACE_WITH"):
        config.mock_google_api = True
    else:
        config.mock_google_api = False

    if os.getenv("MAX_UPLOAD_SIZE_MB"):
        try:
            config.storage.max_upload_size_mb = int(os.getenv("MAX_UPLOAD_SIZE_MB"))
        except ValueError:
            pass

    if os.getenv("DOWNLOADER_SERVICE_URL"):
        config.downloader.service_url = os.getenv("DOWNLOADER_SERVICE_URL")

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
