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
    """Parses flexible date-time strings (e.g. 09-19-2026 05:00PM) to ISO format with EDT offset."""
    if not dt_str:
        return None
    val = dt_str.strip()
    if "T" in val and ("+" in val or "-" in val[10:] or val.endswith("Z")):
        return val
    formats = [
        "%m-%d-%Y %I:%M%p",    # 09-19-2026 05:00PM
        "%m-%d-%Y %I:%M %p",   # 09-19-2026 05:00 PM
        "%m/%d/%Y %I:%M%p",    # 09/19/2026 05:00PM
        "%m/%d/%Y %I:%M %p",   # 09/19/2026 05:00 PM
        "%Y-%m-%d %H:%M:%S",   # 2026-09-19 17:00:00
        "%Y-%m-%d %H:%M",      # 2026-09-19 17:00
        "%Y-%m-%dT%H:%M:%S",   # 2026-09-19T17:00:00
        "%Y-%m-%dT%H:%M",      # 2026-09-19T17:00
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(val, fmt)
            # Default to EDT (-04:00) since event is in Exton, PA (EDT in September)
            return dt.strftime("%Y-%m-%dT%H:%M:%S-04:00")
        except ValueError:
            continue
    return val

class EventConfig(BaseModel):
    id: str = "paattukoottam-2026"
    header_brand_title: str = "EMA Paattukoottam"
    header_brand_subtitle: str = "Musical Night"
    name: str = "✨🎤✨ Paattukoottam ✨🎶✨ Sing & Serenade ✨🎶✨"
    subtitle: str = "Musical Night • September 19, 2026"
    start_time: Optional[str] = "09-19-2026 05:00PM"
    start_time_iso: Optional[str] = "2026-09-19T17:00:00-04:00"
    poster_url: Optional[str] = "/data/paattukoottam_animated.gif"
    venue: Optional[str] = "1 Scouting Wy, Exton, PA 19341, USA"
    time_range: Optional[str] = "5:00 PM - 9:00 PM EDT"
    general_notes: Optional[str] = ""
    hero_tag_primary: Optional[str] = "Musical Evening"
    hero_tag_status: Optional[str] = "Stage Ready"
    payment_url: Optional[str] = None
    signup_sheet_url: Optional[str] = None

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
    performer_name: str = "Performer Name"
    age_group: str = "Age Group"
    performance_type: str = "Performance Type"
    partner_name: str = "Duet Partner"
    contact_info: str = "Contact Name and Phone"
    song_title: str = "Song Name"
    sequence_order: str = "Sequence"
    performance_status: str = "Performance Status"
    track_status: str = "Track Status"
    duration: str = "Duration"
    movie_name: str = "Movie/Album Name"
    drive_file_id: str = "Drive File ID"
    last_updated: str = "Last Updated"

class ColumnsConfig(BaseModel):
    entry_id: int = -1
    performer_name: int = 0
    age_group: int = 1
    performance_type: int = 2
    partner_name: int = 3
    contact_info: int = 4
    song_title: int = 5
    sequence_order: int = 6
    performance_status: int = 7
    track_status: int = 8
    duration: int = 9
    movie_name: int = -1
    drive_file_id: int = 10
    last_updated: int = 11

class StorageConfig(BaseModel):
    cache_dir: str = "/data/cache"
    gallery_dir: str = "/data/gallery"
    max_upload_size_mb: int = 200

class DownloaderConfig(BaseModel):
    service_url: str = "http://downloader:8001"
    timeout_seconds: int = 120

class AgeGroupConfig(BaseModel):
    name: str
    requires_guardian: bool = False

class SignupConfig(BaseModel):
    food_signup_enabled: bool = True
    food_serving_note: str = "Half-Tray or Above (15+ servings)"
    age_groups: List[AgeGroupConfig] = Field(default_factory=lambda: [
        AgeGroupConfig(name="Junior", requires_guardian=True),
        AgeGroupConfig(name="Senior", requires_guardian=False),
    ])
    performance_types: List[str] = Field(default_factory=lambda: ["Solo", "Duet", "Group"])
    max_performances_per_participant: int = 2
    max_solo_per_participant: int = 1

class FoodItemSeed(BaseModel):
    name: str
    group: str

class BackupConfig(BaseModel):
    enabled: bool = True
    drive_folder_id: str = ""
    debounce_seconds: int = 10

class AppConfig(BaseModel):
    event: EventConfig = Field(default_factory=EventConfig)
    google: GoogleConfig = Field(default_factory=GoogleConfig)
    column_names: ColumnNamesConfig = Field(default_factory=ColumnNamesConfig)
    columns: ColumnsConfig = Field(default_factory=ColumnsConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    downloader: DownloaderConfig = Field(default_factory=DownloaderConfig)
    signup: SignupConfig = Field(default_factory=SignupConfig)
    food_items_seed: List[FoodItemSeed] = Field(default_factory=list)
    backup: BackupConfig = Field(default_factory=BackupConfig)
    console_extra_columns: List[str] = Field(default_factory=lambda: ["Age Group"])
    live_order_by: str = "readiness,sequence"
    audio_bitrate: str = "320k"
    entry_id_prefix: str = "PK"

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
    if os.getenv("HEADER_BRAND_TITLE"):
        config.event.header_brand_title = os.getenv("HEADER_BRAND_TITLE")
    if os.getenv("HEADER_BRAND_SUBTITLE"):
        config.event.header_brand_subtitle = os.getenv("HEADER_BRAND_SUBTITLE")
    if os.getenv("APP_TITLE"):
        config.event.name = os.getenv("APP_TITLE")
    if os.getenv("APP_SUBTITLE"):
        config.event.subtitle = os.getenv("APP_SUBTITLE")
    if os.getenv("EVENT_ID"):
        config.event.id = os.getenv("EVENT_ID")
    if os.getenv("EVENT_START_TIME"):
        config.event.start_time = os.getenv("EVENT_START_TIME")
        config.event.start_time_iso = parse_event_datetime(config.event.start_time)
    elif config.event.start_time and not config.event.start_time_iso:
        config.event.start_time_iso = parse_event_datetime(config.event.start_time)

    if os.getenv("EVENT_POSTER_URL"):
        config.event.poster_url = os.getenv("EVENT_POSTER_URL")
    elif os.getenv("POSTER_URL"):
        config.event.poster_url = os.getenv("POSTER_URL")

    if os.getenv("EVENT_VENUE"):
        config.event.venue = os.getenv("EVENT_VENUE")

    if os.getenv("EVENT_TIME_RANGE"):
        config.event.time_range = os.getenv("EVENT_TIME_RANGE")

    if os.getenv("EVENT_GENERAL_NOTES"):
        config.event.general_notes = os.getenv("EVENT_GENERAL_NOTES")

    if os.getenv("EVENT_PAYMENT_URL"):
        config.event.payment_url = os.getenv("EVENT_PAYMENT_URL")
    elif os.getenv("PAYMENT_URL"):
        config.event.payment_url = os.getenv("PAYMENT_URL")

    if os.getenv("EVENT_SIGNUP_SHEET_URL"):
        config.event.signup_sheet_url = os.getenv("EVENT_SIGNUP_SHEET_URL")
    elif os.getenv("SIGNUP_SHEET_URL"):
        config.event.signup_sheet_url = os.getenv("SIGNUP_SHEET_URL")

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
        "COL_AGE_GROUP": "age_group",
        "COL_PARTNER_NAME": "partner_name",
        "COL_PERFORMANCE_TYPE": "performance_type",
        "COL_CONTACT_INFO": "contact_info",
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

    if os.getenv("LIVE_ORDER_BY"):
        config.live_order_by = os.getenv("LIVE_ORDER_BY")

    if os.getenv("AUDIO_BITRATE"):
        config.audio_bitrate = os.getenv("AUDIO_BITRATE")

    prefix_env = os.getenv("ENTRY_ID_PREFIX") or os.getenv("EVENT_PREFIX")
    if prefix_env:
        config.entry_id_prefix = prefix_env.strip().upper()

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

    if os.getenv("BACKUP_ENABLED"):
        b_val = os.getenv("BACKUP_ENABLED", "").lower()
        config.backup.enabled = b_val in ("true", "1", "yes")

    backup_folder_env = os.getenv("BACKUP_DRIVE_FOLDER") or os.getenv("BACKUP_FOLDER_ID")
    if backup_folder_env:
        extracted = extract_google_id(backup_folder_env)
        if extracted:
            config.backup.drive_folder_id = extracted

    if os.getenv("BACKUP_DEBOUNCE_SECONDS"):
        try:
            config.backup.debounce_seconds = int(os.getenv("BACKUP_DEBOUNCE_SECONDS"))
        except ValueError:
            pass

    if os.getenv("FOOD_SIGNUP_ENABLED"):
        f_val = os.getenv("FOOD_SIGNUP_ENABLED", "").lower()
        config.signup.food_signup_enabled = f_val in ("true", "1", "yes")

    if os.getenv("FOOD_SERVING_NOTE"):
        config.signup.food_serving_note = os.getenv("FOOD_SERVING_NOTE")

    if os.getenv("CACHE_DIR"):
        config.storage.cache_dir = os.getenv("CACHE_DIR")
    elif not os.path.exists("/.dockerenv") and config.storage.cache_dir.startswith("/data"):
        config.storage.cache_dir = "./data/cache"

    if os.getenv("GALLERY_DIR"):
        config.storage.gallery_dir = os.getenv("GALLERY_DIR")
    elif not os.path.exists("/.dockerenv") and config.storage.gallery_dir.startswith("/data"):
        config.storage.gallery_dir = "./data/gallery"

    try:
        os.makedirs(config.storage.cache_dir, exist_ok=True)
    except OSError:
        config.storage.cache_dir = "./data/cache"
        os.makedirs(config.storage.cache_dir, exist_ok=True)

    try:
        os.makedirs(config.storage.gallery_dir, exist_ok=True)
    except OSError:
        config.storage.gallery_dir = "./data/gallery"
        os.makedirs(config.storage.gallery_dir, exist_ok=True)

    return config


settings = load_config()


def get_setting(key: str, default: Any = None) -> Any:
    """Reads from app_settings DB first, falls back to config/env."""
    try:
        from app.services.db_service import db_service
        db_val = db_service.get_app_setting(key)
        if db_val is not None:
            if db_val.lower() == "false":
                return False
            if db_val.lower() == "true":
                return True
            try:
                return json.loads(db_val)
            except Exception:
                return db_val
    except Exception:
        pass

    # Direct attribute checks
    if hasattr(settings, key):
        return getattr(settings, key)
    if hasattr(settings.event, key):
        return getattr(settings.event, key)
    if hasattr(settings.signup, key):
        return getattr(settings.signup, key)
    if hasattr(settings.backup, key):
        return getattr(settings.backup, key)

    # Key alias matching (e.g. event_name -> settings.event.name)
    key_aliases = {
        "event_name": settings.event.name,
        "event_subtitle": settings.event.subtitle,
        "event_date_time": settings.event.start_time,
        "event_start_time": settings.event.start_time,
        "event_venue": settings.event.venue,
        "event_time_range": settings.event.time_range,
        "general_notes": settings.event.general_notes,
        "hero_tag_primary": settings.event.hero_tag_primary,
        "hero_tag_status": settings.event.hero_tag_status,
        "event_poster_url": settings.event.poster_url,
        "payment_url": settings.event.payment_url,
        "signup_sheet_url": settings.event.signup_sheet_url,
        "food_signup_enabled": settings.signup.food_signup_enabled,
        "food_serving_note": settings.signup.food_serving_note,
        "max_performances_per_participant": settings.signup.max_performances_per_participant,
        "max_solo_per_participant": settings.signup.max_solo_per_participant,
        "performance_types": settings.signup.performance_types,
        "age_groups": settings.signup.age_groups,
        "entry_id_prefix": settings.entry_id_prefix,
        "console_extra_columns": settings.console_extra_columns,
        "live_order_by": settings.live_order_by,
    }
    if key in key_aliases:
        return key_aliases[key]

    return default

