"""Writes the event's signup workbook/CSVs and database snapshots into the event folder, and renders downloads.

signups.xlsx / signups.csv / singers.csv / potluck.csv are regenerated from SQLite (the source of truth) and
written atomically (temp file + rename), so a sync tool such as rclone never uploads a half-written file.
The tables themselves come from ``datasets`` so the file, the admin viewer and the downloads always agree.
"""
import io
import os
import csv
import glob
import json
import sqlite3
import logging
import tempfile
import threading
import zipfile
from datetime import datetime
from typing import Dict, Any, List, Tuple

from app.config import settings, get_setting

logger = logging.getLogger("export-service")

SNAPSHOT_MIN_INTERVAL_SECONDS = 300

# file names written to the event folder (kept stable for people who point tools at them)
CSV_FILE_FOR = {"songs": "signups.csv", "singers": "singers.csv", "potluck": "potluck.csv"}

DOWNLOAD_FORMATS = {
    "xlsx": ("Excel workbook (all tabs)", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "csv": ("CSV (this tab)", "text/csv; charset=utf-8"),
    "tsv": ("TSV (this tab)", "text/tab-separated-values; charset=utf-8"),
    "json": ("JSON (this tab)", "application/json"),
    "zip": ("ZIP of CSVs (all tabs)", "application/zip"),
}


def _cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    # Neutralize spreadsheet formula injection from user-supplied text (phones like "+1 610 555 0123" stay intact).
    starts_formula = text[:1] in ("=", "@") or (text[:1] in ("+", "-") and any(c.isalpha() for c in text))
    return "'" + text if starts_formula else text


def _safe_filename(text: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in (text or "event")) or "event"


class ExportService:
    def __init__(self):
        self._lock = threading.Lock()
        self._last_snapshot = 0.0

    @property
    def event_dir(self) -> str:
        os.makedirs(settings.storage.event_dir, exist_ok=True)
        return settings.storage.event_dir

    @property
    def backups_dir(self) -> str:
        path = os.path.join(self.event_dir, "backups")
        os.makedirs(path, exist_ok=True)
        return path

    # ------------------------------------------------------------------ writers
    def _atomic_write(self, final_path: str, writer):
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(final_path), prefix=".tmp_", suffix=os.path.splitext(final_path)[1])
        os.close(fd)
        try:
            writer(tmp)
            os.replace(tmp, final_path)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    @staticmethod
    def _grid(table: Dict[str, Any]) -> List[List[Any]]:
        return [[_cell(row.get(col)) for col in table["columns"]] for row in table["rows"]]

    def _write_xlsx(self, path: str, tables: List[Dict[str, Any]]):
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        wb = Workbook()
        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill("solid", fgColor="C2410C")
        for idx, table in enumerate(tables):
            ws = wb.active if idx == 0 else wb.create_sheet()
            ws.title = table["title"][:31]
            ws.append(table["columns"])
            grid = self._grid(table)
            for row in grid:
                ws.append(row)
            for cell in ws[1]:
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = Alignment(vertical="center")
            ws.freeze_panes = "A2"
            for col_idx, header in enumerate(table["columns"], start=1):
                longest = max([len(str(header))] + [len(str(r[col_idx - 1])) for r in grid])
                ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = min(max(longest + 2, 10), 48)
        if not tables:
            wb.active.title = "Empty"
        wb.save(path)

    def _csv_text(self, table: Dict[str, Any], delimiter: str = ",") -> str:
        buf = io.StringIO(newline="")
        w = csv.writer(buf, delimiter=delimiter)
        w.writerow(table["columns"])
        w.writerows(self._grid(table))
        return buf.getvalue()

    def _write_csv(self, path: str, table: Dict[str, Any]):
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            f.write(self._csv_text(table))

    # ------------------------------------------------------------------ snapshots
    def snapshot_database(self) -> str:
        from app.services.db_service import db_service
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        dest = os.path.join(self.backups_dir, f"event_{stamp}.db")
        src = db_service._get_connection()
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
        keep = max(int(getattr(settings.backup, "keep_snapshots", 30)), 1)
        for old in sorted(glob.glob(os.path.join(self.backups_dir, "event_*.db")))[:-keep]:
            try:
                os.remove(old)
            except OSError:
                pass
        self._last_snapshot = datetime.now().timestamp()
        return dest

    # ------------------------------------------------------------------ public: event folder export
    def export_now(self, snapshot: bool = True, force_snapshot: bool = False) -> Dict[str, Any]:
        from app.services.datasets import build_datasets
        with self._lock:
            tables = build_datasets()
            base = self.event_dir
            self._atomic_write(os.path.join(base, "signups.xlsx"), lambda p: self._write_xlsx(p, tables))
            files = ["signups.xlsx"]
            for table in tables:
                name = CSV_FILE_FOR.get(table["id"])
                if name:
                    self._atomic_write(os.path.join(base, name), lambda p, t=table: self._write_csv(p, t))
                    files.append(name)
            snap = None
            now = datetime.now().timestamp()
            if snapshot and (force_snapshot or now - self._last_snapshot >= SNAPSHOT_MIN_INTERVAL_SECONDS):
                snap = self.snapshot_database()
            by_id = {t["id"]: t for t in tables}
            return {
                "rows_backed": sum(t["count"] for t in tables if t["id"] in ("songs", "potluck")),
                "performances": by_id["songs"]["count"] if "songs" in by_id else 0,
                "potluck_items": by_id["potluck"]["count"] if "potluck" in by_id else 0,
                "files": files,
                "snapshot": os.path.basename(snap) if snap else None,
                "event_dir": base,
            }

    # ------------------------------------------------------------------ public: downloads (always fresh from the database)
    def render_download(self, fmt: str, sheet: str = "") -> Tuple[bytes, str, str]:
        """Returns (content, media_type, filename) for one of DOWNLOAD_FORMATS."""
        from app.services.datasets import build_datasets
        fmt = (fmt or "xlsx").lower()
        if fmt not in DOWNLOAD_FORMATS:
            raise ValueError(f"Unknown format '{fmt}'. Choose one of: {', '.join(DOWNLOAD_FORMATS)}.")
        tables = build_datasets()
        if not tables:
            raise ValueError("This event has no data tables yet.")
        event = _safe_filename(str(get_setting("event_id", settings.event.id)))
        stamp = datetime.now().strftime("%Y%m%d")
        media = DOWNLOAD_FORMATS[fmt][1]

        if fmt == "xlsx":
            fd, tmp = tempfile.mkstemp(suffix=".xlsx")
            os.close(fd)
            try:
                self._write_xlsx(tmp, tables)
                with open(tmp, "rb") as f:
                    data = f.read()
            finally:
                os.remove(tmp)
            return data, media, f"{event}_{stamp}.xlsx"

        if fmt == "zip":
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for t in tables:
                    zf.writestr(f"{event}_{t['id']}.csv", ("﻿" + self._csv_text(t)).encode("utf-8"))
            return buf.getvalue(), media, f"{event}_{stamp}_csv.zip"

        table = next((t for t in tables if t["id"] == sheet), tables[0])
        if sheet and table["id"] != sheet:
            raise ValueError(f"Unknown tab '{sheet}'.")
        name = f"{event}_{table['id']}_{stamp}.{fmt}"
        if fmt == "csv":
            return ("﻿" + self._csv_text(table)).encode("utf-8"), media, name
        if fmt == "tsv":
            return ("﻿" + self._csv_text(table, "\t")).encode("utf-8"), media, name
        payload = {"event": event, "tab": table["id"], "title": table["title"], "count": table["count"], "rows": table["rows"]}
        return json.dumps(payload, ensure_ascii=False, indent=2, default=str).encode("utf-8"), media, name


export_service = ExportService()
