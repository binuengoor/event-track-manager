import logging
from typing import List, Dict, Any, Optional

from app.config import settings

logger = logging.getLogger("google-sync")


def create_or_update_backup_sheet(
    sheets_service: Optional[Any],
    drive_service: Optional[Any],
    folder_id: str,
    title: str,
    performances: List[Dict[str, Any]],
    food_items: List[Dict[str, Any]],
    target_sheet_id: Optional[str] = None,
    mock_mode: bool = False
) -> Dict[str, Any]:
    """Creates or updates a Google Sheet containing performances and food signups from the App DB."""
    total_rows = len(performances) + len(food_items)
    if mock_mode or not sheets_service or not drive_service:
        logger.info("Mock backup: %d performances and %d food items backed up", len(performances), len(food_items))
        return {
            "file_id": "mock_backup_sheet_id",
            "title": title,
            "rows_backed": total_rows,
            "url": "https://docs.google.com/spreadsheets/d/mock_backup_sheet_id/edit"
        }

    try:
        spreadsheet_id = target_sheet_id
        if not spreadsheet_id:
            # 1. Find existing backup file in target Drive folder or create a new one
            q = f"name = '{title}' and '{folder_id}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false"
            res = drive_service.files().list(
                q=q,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                fields="files(id, name)"
            ).execute()
            files = res.get("files", [])

            if files:
                spreadsheet_id = files[0]["id"]
                logger.info("Found existing backup spreadsheet %s (%s)", title, spreadsheet_id)
            else:
                body = {
                    "name": title,
                    "mimeType": "application/vnd.google-apps.spreadsheet",
                    "parents": [folder_id]
                }
                created = drive_service.files().create(
                    body=body,
                    supportsAllDrives=True,
                    fields="id, name"
                ).execute()
                spreadsheet_id = created["id"]
                logger.info("Created new backup spreadsheet %s (%s)", title, spreadsheet_id)

        # 2. Ensure tabs exist
        meta = sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        existing_sheets = [s["properties"]["title"] for s in meta.get("sheets", [])]

        perf_tab = settings.google.sheet_tab_name or "Song Sign-Up"
        if perf_tab not in existing_sheets and "Performances" in existing_sheets:
            perf_tab = "Performances"

        requests = []
        if perf_tab not in existing_sheets:
            requests.append({"addSheet": {"properties": {"title": perf_tab}}})
        if "Food Sign-Ups" not in existing_sheets and "Food Sign-Up" not in existing_sheets:
            requests.append({"addSheet": {"properties": {"title": "Food Sign-Up"}}})

        food_tab = "Food Sign-Up" if "Food Sign-Up" in existing_sheets else ("Food Sign-Ups" if "Food Sign-Ups" in existing_sheets else "Food Sign-Up")

        if requests:
            sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": requests}
            ).execute()

        # 3. Format performance data
        perf_headers = [
            "Entry ID", "Performer Name", "Age Group", "Performance Type",
            "Duet Partner", "Partner Phone", "Song Name", "Movie/Album", "Sequence",
            "Guardian Name", "Guardian Phone", "Contact Info", "Track Status",
            "Duration", "Drive File ID", "Created Via", "Last Updated"
        ]
        perf_rows = [perf_headers]
        for p in performances:
            perf_rows.append([
                p.get("entry_id", ""),
                p.get("performer_name", ""),
                p.get("age_group", ""),
                p.get("performance_type", "Solo"),
                p.get("partner_name", "") or "",
                p.get("partner_phone", "") or "",
                p.get("song_title", "") or "",
                p.get("movie_name", "") or "",
                str(p.get("sequence_order", "") or ""),
                p.get("guardian_name", "") or "",
                p.get("guardian_phone", "") or "",
                p.get("contact_info", "") or "",
                p.get("track_status", "Pending") or "",
                p.get("duration", "") or "",
                p.get("drive_file_id", "") or "",
                p.get("created_via", "sheet") or "",
                p.get("last_updated", "") or ""
            ])

        # 4. Format food data
        food_headers = [
            "Item ID", "Food Group", "Item Name", "Status",
            "Signer Name", "Dish Description", "Claimed At"
        ]
        food_rows = [food_headers]
        for f in food_items:
            food_rows.append([
                f.get("item_id", ""),
                f.get("group_name", ""),
                f.get("name", ""),
                "Taken" if f.get("is_taken") else "Open",
                f.get("signer_name", "") or "",
                f.get("dish_description", "") or "",
                f.get("claimed_at", "") or ""
            ])

        # 5. Clear and write data
        data_payload = [
            {"range": f"'{perf_tab}'!A1:Q", "values": perf_rows},
            {"range": f"'{food_tab}'!A1:G", "values": food_rows}
        ]

        try:
            sheets_service.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=f"'{perf_tab}'!A1:Q1000").execute()
            sheets_service.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=f"'{food_tab}'!A1:G1000").execute()
        except Exception:
            pass

        sheets_service.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "USER_ENTERED", "data": data_payload}
        ).execute()

        logger.info("Successfully backed up %d rows to Sheet %s", total_rows, spreadsheet_id)
        return {
            "file_id": spreadsheet_id,
            "title": title,
            "rows_backed": total_rows,
            "url": f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
        }
    except Exception as e:
        logger.error("Failed to backup to Google Sheet: %s", e)
        raise
