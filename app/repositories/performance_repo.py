import re
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from app.config import settings
from app.repositories.base import BaseRepository
from app.repositories.schema import get_or_create_participant_conn
from app.utils.name_matcher import (
    is_placeholder_song_title,
    split_signer_names,
    names_match,
)

logger = logging.getLogger("performance-repo")


class PerformanceRepository(BaseRepository):
    """Repository for managing performance acts, sequencing, status transitions, and sync metadata."""

    def create_performance(
        self,
        performer_name: str,
        performance_type: str = "Solo",
        partner_name: Optional[str] = None,
        partner_age_group: Optional[str] = None,
        contact_info: Optional[str] = None,
        partner_phone: Optional[str] = None,
        song_title: str = "",
        movie_name: Optional[str] = None,
        age_group: Optional[str] = None,
        guardian_name: Optional[str] = None,
        guardian_phone: Optional[str] = None,
        stage_notes: Optional[str] = "",
        track_status: str = "Pending",
        created_via: str = "signup"
    ) -> str:
        prefix = getattr(settings, "entry_id_prefix", "PK") or "PK"
        now_iso = datetime.now(timezone.utc).isoformat()
        extra_tags = [age_group] if age_group else []
        if partner_age_group:
            extra_tags.append(f"Partner:{partner_age_group}")

        with self.get_connection() as conn:
            if partner_name and not partner_age_group:
                p_row = conn.execute(
                    "SELECT age_group FROM performances WHERE LOWER(TRIM(performer_name)) = ? AND age_group IS NOT NULL AND age_group != '' LIMIT 1",
                    (partner_name.strip().lower(),)
                ).fetchone()
                if p_row and p_row["age_group"]:
                    partner_age_group = p_row["age_group"]
                    if f"Partner:{partner_age_group}" not in extra_tags:
                        extra_tags.append(f"Partner:{partner_age_group}")

            rows = conn.execute("SELECT entry_id FROM performances WHERE entry_id LIKE ?", (f"{prefix}-%",)).fetchall()
            max_num = 0
            for r in rows:
                m = re.match(rf"{prefix}-(\d+)", r["entry_id"])
                if m:
                    max_num = max(max_num, int(m.group(1)))
            next_num = max_num + 1
            entry_id = f"{prefix}-{next_num:03d}"

            seq_row = conn.execute("SELECT COALESCE(MAX(sequence_order), 0) + 1 AS next_seq FROM performances").fetchone()
            sequence_order = seq_row["next_seq"] if seq_row else 1

            is_missing = 1 if is_placeholder_song_title(song_title) else 0

            participant_id = get_or_create_participant_conn(
                conn,
                name=performer_name.strip(),
                phone=contact_info.strip() if contact_info else "",
                age_group=age_group.strip() if age_group else "Senior",
                guardian_name=guardian_name.strip() if guardian_name else "",
                guardian_phone=guardian_phone.strip() if guardian_phone else ""
            )
            if partner_name:
                p_age = partner_age_group.strip() if partner_age_group else "Senior"
                is_junior = "junior" in p_age.lower()
                get_or_create_participant_conn(
                    conn,
                    name=partner_name.strip(),
                    phone=partner_phone.strip() if partner_phone else "",
                    age_group=p_age,
                    guardian_name=guardian_name.strip() if is_junior else "",
                    guardian_phone=guardian_phone.strip() if is_junior else ""
                )

            conn.execute("""
            INSERT INTO performances (
                entry_id, performer_name, performance_type, partner_name, partner_age_group, contact_info,
                partner_phone, song_title, movie_name, sequence_order, performance_status, track_status,
                duration, drive_file_id, drive_file_name, last_updated, row_index,
                is_song_name_missing, extra_tags_json, stage_notes, age_group,
                guardian_name, guardian_phone, created_via, participant_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                entry_id,
                performer_name.strip(),
                performance_type.strip(),
                partner_name.strip() if partner_name else None,
                partner_age_group.strip() if partner_age_group else "",
                contact_info.strip() if contact_info else None,
                partner_phone.strip() if partner_phone else "",
                song_title.strip(),
                movie_name.strip() if movie_name else None,
                sequence_order,
                "Upcoming",
                track_status or "Pending",
                None,
                None,
                None,
                now_iso,
                0,
                is_missing,
                json.dumps(extra_tags),
                stage_notes or "",
                age_group or "",
                guardian_name.strip() if guardian_name else "",
                guardian_phone.strip() if guardian_phone else "",
                created_via,
                participant_id
            ))
            conn.commit()

        return entry_id

    def update_performance_details(self, entry_id: str, **fields) -> bool:
        allowed_fields = {
            "performer_name", "song_title", "movie_name", "partner_name", "partner_age_group", "partner_phone", "performance_type",
            "age_group", "guardian_name", "guardian_phone", "contact_info",
            "stage_notes", "track_status", "performance_status", "sequence_order", "media_type"
        }
        updates = []
        params = []
        for k, v in fields.items():
            if k in allowed_fields and v is not None:
                updates.append(f"{k} = ?")
                params.append(v.strip() if isinstance(v, str) else v)

        if not updates:
            return False

        if "song_title" in fields:
            song_val = fields["song_title"]
            is_missing = 1 if is_placeholder_song_title(song_val) else 0
            updates.append("is_song_name_missing = ?")
            params.append(is_missing)

        now_iso = datetime.now(timezone.utc).isoformat()
        updates.append("last_updated = ?")
        params.append(now_iso)

        params.append(entry_id)
        with self.get_connection() as conn:
            cursor = conn.execute(f"UPDATE performances SET {', '.join(updates)} WHERE entry_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0

    def delete_performance(self, entry_id: str) -> bool:
        with self.get_connection() as conn:
            cursor = conn.execute("DELETE FROM performances WHERE entry_id = ?", (entry_id,))
            conn.commit()
            deleted = cursor.rowcount > 0

        if deleted:
            try:
                from app.events.bus import event_bus
                event_bus.publish("performance.deleted", entry_id=entry_id)
            except Exception:
                pass

        return deleted

    def rename_performer(self, old_name: str, new_name: str) -> bool:
        clean_old = old_name.strip()
        clean_new = new_name.strip()
        if not clean_new or len(clean_new) < 2:
            raise ValueError("New name must be at least 2 characters long.")
        if clean_old.lower() == clean_new.lower():
            return True

        with self.get_connection() as conn:
            existing = conn.execute("""
                SELECT 1 FROM performances 
                WHERE (LOWER(TRIM(performer_name)) = ? OR LOWER(TRIM(partner_name)) = ?)
                  AND LOWER(TRIM(performer_name)) != ?
                LIMIT 1
            """, (clean_new.lower(), clean_new.lower(), clean_old.lower())).fetchone()
            if existing:
                raise ValueError(f"A participant named '{clean_new}' is already registered.")

            now_iso = datetime.now(timezone.utc).isoformat()

            conn.execute("""
                UPDATE participants 
                SET name = ?, updated_at = datetime('now')
                WHERE LOWER(TRIM(name)) = ?
            """, (clean_new, clean_old.lower()))

            conn.execute("""
                UPDATE performances 
                SET performer_name = ?, last_updated = ?
                WHERE LOWER(TRIM(performer_name)) = ?
            """, (clean_new, now_iso, clean_old.lower()))

            conn.execute("""
                UPDATE performances 
                SET partner_name = ?, last_updated = ?
                WHERE LOWER(TRIM(partner_name)) = ?
            """, (clean_new, now_iso, clean_old.lower()))

            conn.commit()

        # Publish domain event for cross-cutting cascades (e.g. food signups)
        try:
            from app.events.bus import event_bus
            event_bus.publish("performer.renamed", old_name=clean_old, new_name=clean_new)
        except Exception:
            pass

        return True

    def count_performances_for_performer(self, name: str) -> Dict[str, int]:
        clean_name = name.strip().lower()
        with self.get_connection() as conn:
            rows = conn.execute("""
            SELECT performance_type, partner_name FROM performances 
            WHERE LOWER(TRIM(performer_name)) = ? OR LOWER(TRIM(partner_name)) = ?
            """, (clean_name, clean_name)).fetchall()

            counts = {"total": 0, "solo": 0, "duet": 0, "group": 0}
            for r in rows:
                counts["total"] += 1
                ptype = (r["performance_type"] or "").lower()
                if "solo" in ptype:
                    counts["solo"] += 1
                elif "duet" in ptype:
                    counts["duet"] += 1
                elif "group" in ptype:
                    counts["group"] += 1
            return counts

    def save_performances(self, entries: List[Any]):
        try:
            with self.get_connection() as conn:
                for p in entries:
                    extra_tags = getattr(p, "extra_tags", []) or []
                    stage_notes = getattr(p, "stage_notes", "") or ""
                    age_group = getattr(p, "age_group", "") or ""
                    guardian_name = getattr(p, "guardian_name", "") or ""
                    guardian_phone = getattr(p, "guardian_phone", "") or ""
                    partner_phone = getattr(p, "partner_phone", "") or ""
                    created_via = getattr(p, "created_via", "sheet") or "sheet"

                    conn.execute("""
                    INSERT INTO performances (
                        entry_id, performer_name, performance_type, partner_name, contact_info,
                        song_title, movie_name, sequence_order, performance_status, track_status,
                        duration, drive_file_id, drive_file_name, last_updated, row_index,
                        is_song_name_missing, extra_tags_json, stage_notes, age_group,
                        guardian_name, guardian_phone, partner_phone, created_via
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(entry_id) DO UPDATE SET
                        performer_name=excluded.performer_name,
                        performance_type=excluded.performance_type,
                        partner_name=excluded.partner_name,
                        contact_info=excluded.contact_info,
                        song_title=excluded.song_title,
                        movie_name=excluded.movie_name,
                        sequence_order=excluded.sequence_order,
                        performance_status=excluded.performance_status,
                        track_status=excluded.track_status,
                        duration=excluded.duration,
                        drive_file_id=excluded.drive_file_id,
                        drive_file_name=excluded.drive_file_name,
                        last_updated=excluded.last_updated,
                        row_index=excluded.row_index,
                        is_song_name_missing=excluded.is_song_name_missing,
                        extra_tags_json=excluded.extra_tags_json,
                        stage_notes=COALESCE(NULLIF(excluded.stage_notes, ''), performances.stage_notes, ''),
                        age_group=COALESCE(NULLIF(excluded.age_group, ''), performances.age_group, ''),
                        guardian_name=COALESCE(NULLIF(excluded.guardian_name, ''), performances.guardian_name, ''),
                        guardian_phone=COALESCE(NULLIF(excluded.guardian_phone, ''), performances.guardian_phone, ''),
                        partner_phone=COALESCE(NULLIF(excluded.partner_phone, ''), performances.partner_phone, '')
                    """, (
                        p.entry_id,
                        p.performer_name,
                        p.performance_type,
                        getattr(p, "partner_name", None),
                        getattr(p, "contact_info", None),
                        p.song_title,
                        getattr(p, "movie_name", None),
                        p.sequence_order,
                        p.performance_status,
                        p.track_status,
                        p.duration,
                        p.drive_file_id,
                        getattr(p, "drive_file_name", None),
                        p.last_updated,
                        p.row_index,
                        1 if (getattr(p, "is_song_name_missing", False) or is_placeholder_song_title(getattr(p, "song_title", ""))) else 0,
                        json.dumps(extra_tags),
                        stage_notes,
                        age_group,
                        guardian_name,
                        guardian_phone,
                        partner_phone,
                        created_via
                    ))

                conn.commit()
            self.set_last_sync_time()
        except Exception as ex:
            logger.error(f"Error saving performances to SQLite: {ex}")
            raise

    def get_all_performances(self) -> List[Dict[str, Any]]:
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("""
                SELECT * FROM performances 
                ORDER BY 
                    CASE WHEN sequence_order IS NULL OR sequence_order <= 0 THEN 9999 ELSE sequence_order END ASC,
                    row_index ASC
                """)
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    item = dict(r)
                    item["is_song_name_missing"] = bool(item["is_song_name_missing"]) or is_placeholder_song_title(item.get("song_title", ""))
                    try:
                        item["extra_tags"] = json.loads(item["extra_tags_json"]) if item["extra_tags_json"] else []
                    except Exception:
                        item["extra_tags"] = []
                    item.pop("extra_tags_json", None)
                    results.append(item)
                return results
        except Exception as ex:
            logger.error(f"Error fetching performances from SQLite: {ex}")
            return []

    def get_performance(self, entry_id: str) -> Optional[Dict[str, Any]]:
        try:
            with self.get_connection() as conn:
                row = conn.execute("SELECT * FROM performances WHERE entry_id = ?", (entry_id,)).fetchone()
                if not row:
                    return None
                item = dict(row)
                item["is_song_name_missing"] = bool(item.get("is_song_name_missing", 0)) or is_placeholder_song_title(item.get("song_title", ""))
                try:
                    item["extra_tags"] = json.loads(item["extra_tags_json"]) if item.get("extra_tags_json") else []
                except Exception:
                    item["extra_tags"] = []
                item.pop("extra_tags_json", None)
                return item
        except Exception as ex:
            logger.error(f"Error fetching performance {entry_id} from SQLite: {ex}")
            return None

    def update_performance_field(self, entry_id: str, field_name: str, value: Any):
        allowed_fields = {
            "performance_status", "track_status", "sequence_order", "duration",
            "drive_file_id", "drive_file_name", "last_updated", "song_title",
            "stage_notes", "age_group", "guardian_name", "guardian_phone", "media_type"
        }
        if field_name not in allowed_fields:
            raise ValueError(f"Field {field_name} not allowed for direct update")
        with self.get_connection() as conn:
            conn.execute(f"UPDATE performances SET {field_name} = ? WHERE entry_id = ?", (value, entry_id))
            conn.commit()

    def set_last_sync_time(self, ts: Optional[str] = None):
        if not ts:
            ts = datetime.now(timezone.utc).isoformat()
        with self.get_connection() as conn:
            conn.execute("""
            INSERT INTO sync_meta (key, value) VALUES ('last_synced_at', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """, (ts,))
            conn.commit()

    def get_last_sync_time(self) -> Optional[str]:
        try:
            with self.get_connection() as conn:
                row = conn.execute("SELECT value FROM sync_meta WHERE key='last_synced_at'").fetchone()
                return row["value"] if row else None
        except Exception:
            return None

    def set_dirty_sequence(self, is_dirty: bool = True):
        with self.get_connection() as conn:
            conn.execute("""
            INSERT INTO sync_meta (key, value) VALUES ('sequence_dirty', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """, ("1" if is_dirty else "0",))
            conn.commit()

    def is_sequence_dirty(self) -> bool:
        try:
            with self.get_connection() as conn:
                row = conn.execute("SELECT value FROM sync_meta WHERE key='sequence_dirty'").fetchone()
                return bool(row and row["value"] == "1")
        except Exception:
            return False

    def set_active_entry_id(self, entry_id: Optional[str]):
        with self.get_connection() as conn:
            if entry_id:
                conn.execute("""
                INSERT INTO sync_meta (key, value) VALUES ('active_entry_id', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
                """, (entry_id,))
            else:
                conn.execute("DELETE FROM sync_meta WHERE key='active_entry_id'")
            conn.commit()

    def get_active_entry_id(self) -> Optional[str]:
        try:
            with self.get_connection() as conn:
                row = conn.execute("SELECT value FROM sync_meta WHERE key='active_entry_id'").fetchone()
                return row["value"] if row else None
        except Exception:
            return None
