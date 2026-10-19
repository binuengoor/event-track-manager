"""Event data as spreadsheet-style tables, shaped by the kind of event.

* stage events  -> Songs, Singers (performers + duet partners, with Paid), Run Sheet
* potluck on    -> Potluck (every slot: open or taken, who, phone, dish)
* potluck only  -> just Potluck

The same tables feed the in-admin viewer, the downloads (xlsx / csv / tsv / json / zip) and the signups.xlsx
file in the event folder, so what the admin sees is exactly what is exported.
"""
from typing import Any, Dict, List

from app.config import get_setting
from app.services.db_service import db_service

SONG_COLUMNS = [
    ("Entry ID", "entry_id"), ("Sequence", "sequence_order"), ("Performer", "performer_name"),
    ("Age Group", "age_group"), ("Performance Type", "performance_type"), ("Duet Partner", "partner_name"),
    ("Contact Phone", "contact_info"), ("Guardian", "guardian_name"), ("Guardian Phone", "guardian_phone"),
    ("Partner Phone", "partner_phone"), ("Song", "song_title"), ("Movie/Album", "movie_name"),
    ("Performance Status", "performance_status"), ("Track Status", "track_status"), ("Track File", "drive_file_name"),
    ("Media", "media_type"), ("Duration", "duration"), ("Stage Notes", "stage_notes"),
    ("Signed Up Via", "created_via"), ("Last Updated", "last_updated"),
]
SINGER_COLUMNS = [
    ("Name", "name"), ("Age Group", "age_group"), ("Phone", "phone"), ("Guardian", "guardian_name"),
    ("Guardian Phone", "guardian_phone"), ("Acts", "act_count"), ("Songs", "_songs"), ("Paid", "_paid"),
    ("Paid On", "paid_at"), ("Payment Note", "payment_note"),
]
RUN_SHEET_COLUMNS = [
    ("Seq", "sequence_order"), ("Performer(s)", "_who"), ("Song", "song_title"), ("Type", "performance_type"),
    ("Track", "track_status"), ("Notes", "stage_notes"),
]
POTLUCK_COLUMNS = [
    ("Group", "group_name"), ("Item", "name"), ("Status", "_status"), ("Signed Up By", "signer_name"),
    ("Phone", "signer_phone"), ("Dish", "dish_description"),
]


def event_kind() -> Dict[str, bool]:
    return {
        "stage": bool(get_setting("stage_performances_enabled", True)),
        "potluck": bool(get_setting("food_signup_enabled", True)),
    }


def _table(table_id: str, title: str, columns, records: List[Dict[str, Any]], note: str = "") -> Dict[str, Any]:
    rows = [{label: ("" if r.get(key) is None else r.get(key)) for label, key in columns} for r in records]
    return {"id": table_id, "title": title, "columns": [label for label, _ in columns], "rows": rows,
            "count": len(rows), "note": note}


def build_datasets() -> List[Dict[str, Any]]:
    kind = event_kind()
    tables: List[Dict[str, Any]] = []

    perfs = db_service.get_all_performances()
    food = db_service.get_all_food_items_with_signups()
    has_claims = any(f.get("is_taken") for f in food)

    if kind["stage"]:
        tables.append(_table("songs", "Songs", SONG_COLUMNS, perfs, "Every registered act."))
        singers = db_service.get_singers()
        for s in singers:
            s["_songs"] = "; ".join(s["songs"])
            s["_paid"] = "Yes" if s["paid"] else "No"
        tables.append(_table("singers", "Singers", SINGER_COLUMNS, singers,
                             "Everyone who sings, including duet and group partners. Potluck-only guests are not listed."))
        run = []
        for p in sorted(perfs, key=lambda x: x.get("sequence_order") or 9999):
            who = p.get("performer_name") or ""
            if p.get("partner_name"):
                who += f" & {p['partner_name']}"
            run.append({**p, "_who": who})
        tables.append(_table("run_sheet", "Run Sheet", RUN_SHEET_COLUMNS, run, "The running order."))

    if kind["potluck"] or has_claims or not kind["stage"]:
        for f in food:
            f["_status"] = "Taken" if f.get("is_taken") else "Open"
        tables.append(_table("potluck", "Potluck", POTLUCK_COLUMNS, food, "Every dish slot, open or taken."))

    return tables


def get_dataset(table_id: str) -> Dict[str, Any]:
    for t in build_datasets():
        if t["id"] == table_id:
            return t
    raise KeyError(table_id)
