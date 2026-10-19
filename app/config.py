import os
import re
import json
import yaml
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field

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

import zoneinfo
from datetime import datetime

def parse_event_datetime(dt_str: Optional[str], tz_name: str = "America/New_York") -> Optional[str]:
    """Parses event start time string into ISO 8601 with configurable timezone."""
    if not dt_str or not dt_str.strip():
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
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        tz = zoneinfo.ZoneInfo("America/New_York")

    for fmt in formats:
        try:
            dt = datetime.strptime(val, fmt)
            dt_localized = dt.replace(tzinfo=tz)
            return dt_localized.isoformat()
        except ValueError:
            continue
    return val

class EventConfig(BaseModel):
    id: str = "paattukoottam-2026"
    header_brand_title: str = "EMA Paattukoottam"
    header_brand_subtitle: str = "Musical Night"
    name: str = "✨🎤✨ Paattukoottam ✨🎶✨ Sing & Serenade ✨🎶✨"
    subtitle: str = "Musical Night • September 19, 2026"
    timezone: str = "America/New_York"
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

class ColumnNamesConfig(BaseModel):
    entry_id: str = "Entry ID"
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

class StorageConfig(BaseModel):
    # The event folder is the single place everything lives:
    #   <event_dir>/event.db, signups.xlsx, signups.csv, tracks/, incoming/, backups/, gallery/
    events_dir: str = ""
    event_dir: str = ""
    tracks_dir: str = ""
    # Scratch space for transcoding and the downloader hand-off (safe to delete).
    cache_dir: str = "/data/cache"
    gallery_dir: str = ""
    max_upload_size_mb: int = 100

class DownloaderConfig(BaseModel):
    service_url: str = "http://downloader:8001"
    timeout_seconds: int = 120

class AgeGroupConfig(BaseModel):
    name: str
    requires_guardian: bool = False

class SignupConfig(BaseModel):
    stage_performances_enabled: bool = True
    signup_enabled: bool = True
    food_signup_enabled: bool = True
    track_upload_enabled: bool = True
    allow_duets: bool = True
    performer_edits_enabled: bool = True
    live_display_enabled: bool = True
    dashboard_enabled: bool = True
    console_enabled: bool = True
    payment_enabled: bool = True
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
    keep_snapshots: int = 30
    debounce_seconds: int = 10

class AppConfig(BaseModel):
    event: EventConfig = Field(default_factory=EventConfig)
    column_names: ColumnNamesConfig = Field(default_factory=ColumnNamesConfig)
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
    # Optional second PIN that only opens the sound console (volunteer sound operators). Empty = disabled.
    operator_pin: str = ""

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
    if os.getenv("EVENT_TIMEZONE"):
        config.event.timezone = os.getenv("EVENT_TIMEZONE")
    if os.getenv("EVENT_START_TIME"):
        config.event.start_time = os.getenv("EVENT_START_TIME")
        config.event.start_time_iso = parse_event_datetime(config.event.start_time, tz_name=config.event.timezone)
    elif config.event.start_time and not config.event.start_time_iso:
        config.event.start_time_iso = parse_event_datetime(config.event.start_time, tz_name=config.event.timezone)

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
    if os.getenv("OPERATOR_PIN"):
        config.operator_pin = os.getenv("OPERATOR_PIN")

    if os.getenv("MAX_UPLOAD_SIZE_MB"):
        try:
            config.storage.max_upload_size_mb = int(os.getenv("MAX_UPLOAD_SIZE_MB"))
        except ValueError:
            pass

    if os.getenv("DOWNLOADER_SERVICE_URL"):
        config.downloader.service_url = os.getenv("DOWNLOADER_SERVICE_URL")

    if os.getenv("CONSOLE_EXTRA_COLUMNS"):
        raw_cols = os.getenv("CONSOLE_EXTRA_COLUMNS", "")
        config.console_extra_columns = [c.strip() for c in raw_cols.split(",") if c.strip()]

    if os.getenv("BACKUP_ENABLED"):
        b_val = os.getenv("BACKUP_ENABLED", "").lower()
        config.backup.enabled = b_val in ("true", "1", "yes")

    if os.getenv("BACKUP_DEBOUNCE_SECONDS"):
        try:
            config.backup.debounce_seconds = int(os.getenv("BACKUP_DEBOUNCE_SECONDS"))
        except ValueError:
            pass

    if os.getenv("FOOD_SIGNUP_ENABLED"):
        f_val = os.getenv("FOOD_SIGNUP_ENABLED", "").lower()
        config.signup.food_signup_enabled = f_val in ("true", "1", "yes")

    if os.getenv("SIGNUP_ENABLED"):
        s_val = os.getenv("SIGNUP_ENABLED", "").lower()
        config.signup.signup_enabled = s_val in ("true", "1", "yes")

    if os.getenv("FOOD_SERVING_NOTE"):
        config.signup.food_serving_note = os.getenv("FOOD_SERVING_NOTE")

    is_docker = os.getenv("RUNTIME_ENV") == "docker" or os.path.exists("/.dockerenv")

    # Event folder: EVENT_DIR (explicit) or EVENTS_DIR/<event id>
    safe_event_id = re.sub(r"[^A-Za-z0-9._-]", "_", (config.event.id or "event").strip()) or "event"
    if os.getenv("EVENT_DIR"):
        config.storage.event_dir = os.getenv("EVENT_DIR")
    else:
        events_root = os.getenv("EVENTS_DIR") or ("/events" if is_docker else "./events")
        config.storage.events_dir = events_root
        config.storage.event_dir = os.path.join(events_root, safe_event_id)
    config.storage.tracks_dir = os.getenv("TRACKS_DIR") or os.path.join(config.storage.event_dir, "tracks")
    config.storage.gallery_dir = os.getenv("GALLERY_DIR") or os.path.join(config.storage.event_dir, "gallery")

    if os.getenv("CACHE_DIR"):
        config.storage.cache_dir = os.getenv("CACHE_DIR")
    elif not is_docker and config.storage.cache_dir.startswith("/data"):
        config.storage.cache_dir = "./data/cache"

    def _make(path_attr: str, fallback: str):
        path = getattr(config.storage, path_attr)
        try:
            os.makedirs(path, exist_ok=True)
        except OSError:
            setattr(config.storage, path_attr, fallback)
            os.makedirs(fallback, exist_ok=True)

    _make("event_dir", "./events/" + safe_event_id)
    for sub, attr in (("tracks", "tracks_dir"), ("gallery", "gallery_dir")):
        _make(attr, os.path.join(config.storage.event_dir, sub))
    for sub in ("incoming", "backups"):
        os.makedirs(os.path.join(config.storage.event_dir, sub), exist_ok=True)
    _make("cache_dir", "./data/cache")

    return config


settings = load_config()


def get_setting(key: str, default: Any = None) -> Any:
    """Reads from app_settings DB first, falls back to config/env."""
    try:
        from app.repositories.settings_repo import SettingsRepository
        db_val = SettingsRepository().get_setting(key)
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
        "signup_enabled": settings.signup.signup_enabled,
        "food_signup_enabled": settings.signup.food_signup_enabled,
        "track_upload_enabled": settings.signup.track_upload_enabled,
        "allow_duets": settings.signup.allow_duets,
        "performer_edits_enabled": settings.signup.performer_edits_enabled,
        "live_display_enabled": settings.signup.live_display_enabled,
        "dashboard_enabled": settings.signup.dashboard_enabled,
        "payment_enabled": settings.signup.payment_enabled,
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

