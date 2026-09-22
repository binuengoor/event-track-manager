import os
import io
import logging
from typing import Tuple, Any, Optional

from app.config import settings

logger = logging.getLogger("google-auth")


def init_google_clients() -> Tuple[Optional[Any], Optional[Any], bool]:
    """
    Initializes and returns (sheets_client, drive_client, is_xlsx).
    Returns (None, None, False) if in mock mode or credentials are missing/invalid.
    """
    if settings.mock_google_api:
        logger.info("MOCK MODE active via configuration: skipping Google API connection.")
        return None, None, False

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive"
        ]

        if settings.google.service_account_json:
            import json
            info = json.loads(settings.google.service_account_json)
            creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
        else:
            creds_path = settings.google.service_account_json_path
            if not os.path.isfile(creds_path):
                raise FileNotFoundError(f"Service account file not found at {creds_path}")
            creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)

        sheets = build("sheets", "v4", credentials=creds)
        drive = build("drive", "v3", credentials=creds)

        meta = drive.files().get(
            fileId=settings.google.sheet_id,
            supportsAllDrives=True,
            fields="id, name, mimeType"
        ).execute()
        mime = meta.get("mimeType", "")
        is_xlsx = ("spreadsheetml.sheet" in mime or meta.get("name", "").endswith(".xlsx"))
        logger.info("Connected to target sheet: %s (Type: %s, is_xlsx=%s)", meta.get("name"), mime, is_xlsx)
        return sheets, drive, is_xlsx

    except Exception as e:
        logger.error("Failed to initialize Google clients (%s). Falling back to MOCK MODE.", e)
        return None, None, False
