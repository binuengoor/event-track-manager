import os
import re
import yaml
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field

def extract_google_id(url_or_id: Optional[str]) -> str:
    """Extracts a Google Sheet/Drive folder ID from a URL or returns raw ID."""
    if not url_or_id:
        return ""
    val = str(url_or_id).strip()
    
    # Match /spreadsheets/d/([a-zA-Z0-9_-]+)
    m_sheet = re.search(r'/spreadsheets/d/([a-zA-Z0-9_-]+)', val)
    if m_sheet:
        return m_sheet.group(1)
        
    # Match /folders/([a-zA-Z0-9_-]+)
    m_folder = re.search(r'/folders/([a-zA-Z0-9_-]+)', val)
    if m_folder:
        return m_folder.group(1)
        
    # Match id=([a-zA-Z0-9_-]+)
    m_param = re.search(r'[?&]id=([a-zA-Z0-9_-]+)', val)
    if m_param:
        return m_param.group(1)
        
    # Match /file/d/([a-zA-Z0-9_-]+)
    m_file = re.search(r'/file/d/([a-zA-Z0-9_-]+)', val)
    if m_file:
        return m_file.group(1)
        
    # Raw ID fallback
    clean = val.split('?')[0].split('#')[0].strip('/')
    return clean

def load_dotenv_file(filepath: str = ".env") -> None:
    """Simple, zero-dependency .env loader that populates os.environ."""
    if not os.path.isfile(filepath):
        return
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass

# Load .env file at startup
load_dotenv_file(".env")
load_dotenv_file(os.path.join(os.path.dirname(__file__), "..", ".env"))

from datetime import datetime

def parse_event_datetime(dt_str: Optional[str]) -> Optional[str]:
    """Parses flexible date-time strings (e.g. 09-28-2026 06:30PM) to ISO format."""
    if not dt_str:
        return None
    val = dt_str.strip()
    formats = [
        "%m-%d-%Y %I:%M%p",    # 09-28-2026 06:30PM
        "%m-%d-%Y %I:%M %p",   # 09-28-2026 06:30 PM
        "%m/%d/%Y %I:%M%p",    # 09/28/2026 06:30PM
        "%m/%d/%Y %I:%M %p",   # 09/28/2026 06:30 PM
        "%Y-%m-%d %H:%M:%S",   # 2026-09-28 18:30:00
        "%Y-%m-%d %H:%M",      # 2026-09-28 18:30
        "%Y-%m-%dT%H:%M:%S",   # 2026-09-28T18:30:00
        "%Y-%m-%dT%H:%M",      # 2026-09-28T18:30
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(val, fmt)
            return dt.isoformat()
        except ValueError:
            continue
    return val

class EventConfig(BaseModel):
    id: str = "paattukoottam-2026"
    name: str = "EMA Paattukoottam"
    subtitle: str = "Musical Night • Track Submission"
    start_time: Optional[str] = None
    start_time_iso: Optional[str] = None

class DriveFoldersConfig(BaseModel):
    active_folder_id: str = "1FQ1goCkaSajLjGv8Yt_vrWTS6krmZufW"
    archive_folder_id: str = "1T6zqI02lKQfLfqpPRjQOhn561uUEKDil"

class GoogleConfig(BaseModel):
    service_account_json_path: str = "./secrets/credentials.json"
    service_account_json: Optional[str] = None
    sheet_id: str = "1bRvoj4ZlAmSRz972uhTDMfXlYgksH-BOH-zmygp5YRQ"
    sheet_tab_name: str = "Song Sign-Up"
    sheet_range: str = "Song Sign-Up!A2:O"
    drive_folders: DriveFoldersConfig = Field(default_factory=DriveFoldersConfig)

class ColumnNamesConfig(BaseModel):
    performer_name: str = "Singer (1)"
    partner_name: str = "Singer (2)"
    performance_type: str = "Solo/Duet/Group"
    sequence_order: str = "Sequence"
    song_title: str = "Song Name"
    movie_name: str = "Movie/Album Name"
    performance_status: str = "Performance Status"
    track_status: str = "Track Uploaded"
    duration: str = "Duration (Minutes)"
    drive_file_id: str = "Drive File ID"
    last_updated: str = "Last Updated"

class ColumnsConfig(BaseModel):
    entry_id: int = -1
    performer_name: int = 0
    performance_type: int = 5
    partner_name: int = 2
    song_title: int = 8
    movie_name: int = 9
    performance_status: int = 10
    track_status: int = 11
    sequence_order: int = 6
    duration: int = 12
    drive_file_id: int = 13
    last_updated: int = 14

class StorageConfig(BaseModel):
    cache_dir: str = "/data/cache"
    max_upload_size_mb: int = 200

class DownloaderConfig(BaseModel):
    service_url: str = "http://downloader:8001"
    timeout_seconds: int = 120

class AppConfig(BaseModel):
    event: EventConfig = Field(default_factory=EventConfig)
    google: GoogleConfig = Field(default_factory=GoogleConfig)
    column_names: ColumnNamesConfig = Field(default_factory=ColumnNamesConfig)
    columns: ColumnsConfig = Field(default_factory=ColumnsConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    downloader: DownloaderConfig = Field(default_factory=DownloaderConfig)
    console_extra_columns: List[str] = Field(default_factory=lambda: ["Age Group (Junior/Senior)"])

    admin_pin: str = "2026"
    mock_google_api: bool = False

def load_config() -> AppConfig:
    config_file = os.getenv("CONFIG_PATH", "config.yaml")
    data: Dict[str, Any] = {}

    if os.path.isfile(config_file):
        with open(config_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

    config = AppConfig(**data)

    # 1. Event branding & metadata overrides
    if os.getenv("APP_TITLE"):
        config.event.name = os.getenv("APP_TITLE")
    if os.getenv("APP_SUBTITLE"):
        config.event.subtitle = os.getenv("APP_SUBTITLE")
    if os.getenv("EVENT_ID"):
        config.event.id = os.getenv("EVENT_ID")
    if os.getenv("EVENT_START_TIME"):
        config.event.start_time = os.getenv("EVENT_START_TIME")
        config.event.start_time_iso = parse_event_datetime(config.event.start_time)

    # 2. Google Workspace & Drive URLs / IDs
    sheet_url_env = os.getenv("GOOGLE_SHEET_URL") or os.getenv("SHEET_ID")
    if sheet_url_env:
        extracted = extract_google_id(sheet_url_env)
        if extracted:
            config.google.sheet_id = extracted

    tab_name_env = os.getenv("SHEET_TAB_NAME")
    if tab_name_env:
        config.google.sheet_tab_name = tab_name_env
        config.google.sheet_range = f"{tab_name_env}!A2:O"

    active_folder_env = os.getenv("GOOGLE_DRIVE_ACTIVE_FOLDER") or os.getenv("ACTIVE_FOLDER_ID")
    if active_folder_env:
        extracted = extract_google_id(active_folder_env)
        if extracted:
            config.google.drive_folders.active_folder_id = extracted

    archive_folder_env = os.getenv("GOOGLE_DRIVE_ARCHIVE_FOLDER") or os.getenv("ARCHIVE_FOLDER_ID")
    if archive_folder_env:
        extracted = extract_google_id(archive_folder_env)
        if extracted:
            config.google.drive_folders.archive_folder_id = extracted

    # Service account credentials
    creds_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON_PATH") or os.getenv("GOOGLE_CREDENTIALS_PATH")
    if creds_path:
        if not os.path.isfile(creds_path) and os.path.isfile("/secrets/credentials.json"):
            config.google.service_account_json_path = "/secrets/credentials.json"
        elif not os.path.isfile(creds_path) and os.path.isfile(os.path.join(os.getcwd(), "secrets", "credentials.json")):
            config.google.service_account_json_path = os.path.join(os.getcwd(), "secrets", "credentials.json")
        else:
            config.google.service_account_json_path = creds_path

    raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if raw_json:
        config.google.service_account_json = raw_json

    # 3. Dynamic Column Names
    col_mapping = {
        "COL_PERFORMER_NAME": "performer_name",
        "COL_PARTNER_NAME": "partner_name",
        "COL_PERFORMANCE_TYPE": "performance_type",
        "COL_SEQUENCE": "sequence_order",
        "COL_SONG_TITLE": "song_title",
        "COL_MOVIE_NAME": "movie_name",
        "COL_PERFORMANCE_STATUS": "performance_status",
        "COL_TRACK_STATUS": "track_status",
        "COL_DURATION": "duration",
        "COL_DRIVE_FILE_ID": "drive_file_id",
        "COL_LAST_UPDATED": "last_updated",
    }
    for env_k, field_name in col_mapping.items():
        if os.getenv(env_k):
            setattr(config.column_names, field_name, os.getenv(env_k))

    # 4. Security, Storage & Networking
    if os.getenv("ADMIN_PIN"):
        config.admin_pin = os.getenv("ADMIN_PIN")

    if os.getenv("MAX_UPLOAD_SIZE_MB"):
        try:
            config.storage.max_upload_size_mb = int(os.getenv("MAX_UPLOAD_SIZE_MB"))
        except ValueError:
            pass

    mock_env = os.getenv("MOCK_GOOGLE_API", "").lower()
    if mock_env in ("true", "1", "yes"):
        config.mock_google_api = True
    elif not config.google.service_account_json and not os.path.isfile(config.google.service_account_json_path):
        config.mock_google_api = True

    if os.getenv("DOWNLOADER_SERVICE_URL"):
        config.downloader.service_url = os.getenv("DOWNLOADER_SERVICE_URL")

    if os.getenv("CONSOLE_EXTRA_COLUMNS"):
        raw_cols = os.getenv("CONSOLE_EXTRA_COLUMNS", "")
        config.console_extra_columns = [c.strip() for c in raw_cols.split(",") if c.strip()]

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
