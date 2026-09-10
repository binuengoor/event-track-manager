import sqlite3
import os
import re
import json
import logging
import uuid
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from app.config import settings

logger = logging.getLogger("db-service")


class DBService:
    def __init__(self):
        self._db_path = None
        self._ensure_db()

    @property
    def db_path(self) -> str:
        if not self._db_path:
            cache_dir = settings.storage.cache_dir
            os.makedirs(cache_dir, exist_ok=True)
            self._db_path = os.path.join(cache_dir, "event_data.db")
        return self._db_path

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=15.0)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_db(self):
        try:
            with self._get_connection() as conn:
                # 1. Performances table
                conn.execute("""
                CREATE TABLE IF NOT EXISTS performances (
                    entry_id TEXT PRIMARY KEY,
                    performer_name TEXT NOT NULL,
                    performance_type TEXT DEFAULT 'Solo',
                    partner_name TEXT,
                    contact_info TEXT,
                    song_title TEXT DEFAULT '',
                    movie_name TEXT,
                    sequence_order INTEGER,
                    performance_status TEXT DEFAULT 'Upcoming',
                    track_status TEXT DEFAULT 'Pending',
                    duration TEXT,
                    drive_file_id TEXT,
                    drive_file_name TEXT,
                    last_updated TEXT,
                    row_index INTEGER DEFAULT 0,
                    is_song_name_missing INTEGER DEFAULT 0,
                    extra_tags_json TEXT DEFAULT '[]',
                    stage_notes TEXT DEFAULT '',
                    age_group TEXT DEFAULT '',
                    guardian_name TEXT DEFAULT '',
                    guardian_phone TEXT DEFAULT '',
                    created_via TEXT DEFAULT 'sheet'
                )
                """)

                # Migrations for existing databases
                for col_name, col_def in [
                    ("stage_notes", "TEXT DEFAULT ''"),
                    ("age_group", "TEXT DEFAULT ''"),
                    ("guardian_name", "TEXT DEFAULT ''"),
                    ("guardian_phone", "TEXT DEFAULT ''"),
                    ("created_via", "TEXT DEFAULT 'sheet'"),
                ]:
                    try:
                        conn.execute(f"ALTER TABLE performances ADD COLUMN {col_name} {col_def}")
                    except Exception:
                        pass

                conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_perf_sequence ON performances (sequence_order)
                """)

                # 2. Sync metadata
                conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
                """)

                # 3. Runtime application settings
                conn.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key        TEXT PRIMARY KEY,
                    value      TEXT,
                    updated_at TEXT DEFAULT (datetime('now'))
                )
                """)

                # 4. Food groups
                conn.execute("""
                CREATE TABLE IF NOT EXISTS food_groups (
                    group_id      TEXT PRIMARY KEY,
                    name          TEXT NOT NULL UNIQUE,
                    display_order INTEGER DEFAULT 0,
                    created_at    TEXT DEFAULT (datetime('now'))
                )
                """)

                # 5. Food items (1 slot per item)
                conn.execute("""
                CREATE TABLE IF NOT EXISTS food_items (
                    item_id       TEXT PRIMARY KEY,
                    name          TEXT NOT NULL UNIQUE,
                    group_id      TEXT REFERENCES food_groups(group_id),
                    display_order INTEGER DEFAULT 0,
                    created_at    TEXT DEFAULT (datetime('now'))
                )
                """)

                # 6. Food sign-ups (1 person per item, enforced by UNIQUE)
                conn.execute("""
                CREATE TABLE IF NOT EXISTS food_signups (
                    signup_id        TEXT PRIMARY KEY,
                    item_id          TEXT NOT NULL UNIQUE REFERENCES food_items(item_id),
                    signer_name      TEXT NOT NULL,
                    dish_description TEXT DEFAULT '',
                    created_at       TEXT DEFAULT (datetime('now')),
                    updated_at       TEXT DEFAULT (datetime('now'))
                )
                """)

                # 7. Backup log
                conn.execute("""
                CREATE TABLE IF NOT EXISTS backup_log (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    triggered_at TEXT DEFAULT (datetime('now')),
                    completed_at TEXT,
                    status       TEXT DEFAULT 'pending',
                    rows_backed  INTEGER DEFAULT 0,
                    error_msg    TEXT
                )
                """)

                conn.commit()
        except Exception as ex:
            logger.error(f"Error initializing SQLite database at {self.db_path}: {ex}")

    # =========================================================================
    # APP SETTINGS
    # =========================================================================

    def get_app_setting(self, key: str) -> Optional[str]:
        try:
            with self._get_connection() as conn:
                row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
                return row["value"] if row else None
        except Exception as ex:
            logger.error(f"Error reading app setting {key}: {ex}")
            return None

    def set_app_setting(self, key: str, value: Any):
        val_str = value if isinstance(value, str) else json.dumps(value)
        with self._get_connection() as conn:
            conn.execute("""
            INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
            """, (key, val_str))
            conn.commit()

    def get_all_app_settings(self) -> Dict[str, str]:
        try:
            with self._get_connection() as conn:
                rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
                return {r["key"]: r["value"] for r in rows}
        except Exception as ex:
            logger.error(f"Error fetching all app settings: {ex}")
            return {}

    def seed_app_settings(self, defaults: Dict[str, Any]):
        """Seeds app_settings table with defaults if keys do not already exist."""
        try:
            with self._get_connection() as conn:
                for k, v in defaults.items():
                    val_str = v if isinstance(v, str) else json.dumps(v)
                    conn.execute("""
                    INSERT OR IGNORE INTO app_settings (key, value, updated_at)
                    VALUES (?, ?, datetime('now'))
                    """, (k, val_str))
                conn.commit()
        except Exception as ex:
            logger.error(f"Error seeding app settings: {ex}")

    # =========================================================================
    # FOOD GROUPS
    # =========================================================================

    def get_food_groups(self) -> List[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                cursor = conn.execute("""
                SELECT 
                    g.group_id, 
                    g.name, 
                    g.display_order,
                    g.created_at,
                    COUNT(i.item_id) AS item_count,
                    COUNT(s.signup_id) AS taken_count,
                    (COUNT(i.item_id) - COUNT(s.signup_id)) AS open_count
                FROM food_groups g
                LEFT JOIN food_items i ON g.group_id = i.group_id
                LEFT JOIN food_signups s ON i.item_id = s.item_id
                GROUP BY g.group_id
                ORDER BY g.display_order ASC, g.name ASC
                """)
                return [dict(r) for r in cursor.fetchall()]
        except Exception as ex:
            logger.error(f"Error fetching food groups: {ex}")
            return []

    def add_food_group(self, name: str) -> str:
        group_id = f"fg_{uuid.uuid4().hex[:8]}"
        clean_name = name.strip()
        with self._get_connection() as conn:
            row = conn.execute("SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM food_groups").fetchone()
            next_order = row["next_order"] if row else 0
            conn.execute("""
            INSERT INTO food_groups (group_id, name, display_order)
            VALUES (?, ?, ?)
            """, (group_id, clean_name, next_order))
            conn.commit()
        return group_id

    def update_food_group(self, group_id: str, name: Optional[str] = None, display_order: Optional[int] = None) -> bool:
        updates = []
        params = []
        if name is not None:
            updates.append("name = ?")
            params.append(name.strip())
        if display_order is not None:
            updates.append("display_order = ?")
            params.append(display_order)
        if not updates:
            return False

        params.append(group_id)
        with self._get_connection() as conn:
            cursor = conn.execute(f"UPDATE food_groups SET {', '.join(updates)} WHERE group_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0

    def delete_food_group(self, group_id: str) -> bool:
        with self._get_connection() as conn:
            count_row = conn.execute("SELECT COUNT(*) AS cnt FROM food_items WHERE group_id = ?", (group_id,)).fetchone()
            item_count = count_row["cnt"] if count_row else 0
            if item_count > 0:
                raise ValueError(f"This group has {item_count} items. Move or delete the items first.")

            cursor = conn.execute("DELETE FROM food_groups WHERE group_id = ?", (group_id,))
            conn.commit()
            return cursor.rowcount > 0

    def reorder_food_groups(self, ordered_ids: List[str]):
        with self._get_connection() as conn:
            for idx, gid in enumerate(ordered_ids):
                conn.execute("UPDATE food_groups SET display_order = ? WHERE group_id = ?", (idx, gid))
            conn.commit()

    # =========================================================================
    # FOOD ITEMS
    # =========================================================================

    def get_food_items_by_group(self, group_id: str) -> List[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                cursor = conn.execute("""
                SELECT 
                    i.item_id,
                    i.name,
                    i.group_id,
                    i.display_order,
                    g.name AS group_name,
                    CASE WHEN s.signup_id IS NOT NULL THEN 1 ELSE 0 END AS is_taken,
                    s.signup_id,
                    s.signer_name,
                    s.dish_description,
                    s.updated_at AS claimed_at
                FROM food_items i
                JOIN food_groups g ON i.group_id = g.group_id
                LEFT JOIN food_signups s ON i.item_id = s.item_id
                WHERE i.group_id = ?
                ORDER BY i.display_order ASC, i.name ASC
                """, (group_id,))
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    item = dict(r)
                    item["is_taken"] = bool(item["is_taken"])
                    results.append(item)
                return results
        except Exception as ex:
            logger.error(f"Error fetching food items for group {group_id}: {ex}")
            return []

    def get_all_food_items_with_signups(self) -> List[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                cursor = conn.execute("""
                SELECT 
                    i.item_id,
                    i.name,
                    i.group_id,
                    i.display_order,
                    g.name AS group_name,
                    g.display_order AS group_display_order,
                    CASE WHEN s.signup_id IS NOT NULL THEN 1 ELSE 0 END AS is_taken,
                    s.signup_id,
                    s.signer_name,
                    s.dish_description,
                    s.updated_at AS claimed_at
                FROM food_items i
                JOIN food_groups g ON i.group_id = g.group_id
                LEFT JOIN food_signups s ON i.item_id = s.item_id
                ORDER BY g.display_order ASC, g.name ASC, i.display_order ASC, i.name ASC
                """)
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    item = dict(r)
                    item["is_taken"] = bool(item["is_taken"])
                    results.append(item)
                return results
        except Exception as ex:
            logger.error(f"Error fetching all food items with signups: {ex}")
            return []

    def add_food_item(self, name: str, group_id: str) -> str:
        item_id = f"fi_{uuid.uuid4().hex[:8]}"
        clean_name = name.strip()
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM food_items WHERE group_id = ?",
                (group_id,)
            ).fetchone()
            next_order = row["next_order"] if row else 0
            conn.execute("""
            INSERT INTO food_items (item_id, name, group_id, display_order)
            VALUES (?, ?, ?, ?)
            """, (item_id, clean_name, group_id, next_order))
            conn.commit()
        return item_id

    def update_food_item(
        self,
        item_id: str,
        name: Optional[str] = None,
        group_id: Optional[str] = None,
        display_order: Optional[int] = None
    ) -> bool:
        updates = []
        params = []
        if name is not None:
            updates.append("name = ?")
            params.append(name.strip())
        if group_id is not None:
            updates.append("group_id = ?")
            params.append(group_id)
        if display_order is not None:
            updates.append("display_order = ?")
            params.append(display_order)
        if not updates:
            return False

        params.append(item_id)
        with self._get_connection() as conn:
            cursor = conn.execute(f"UPDATE food_items SET {', '.join(updates)} WHERE item_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0

    def delete_food_item(self, item_id: str, force: bool = False) -> bool:
        with self._get_connection() as conn:
            signup = conn.execute(
                "SELECT signer_name FROM food_signups WHERE item_id = ?",
                (item_id,)
            ).fetchone()

            if signup and not force:
                raise ValueError(
                    f"Item is currently claimed by {signup['signer_name']}. Pass force=true to delete anyway."
                )

            if signup and force:
                conn.execute("DELETE FROM food_signups WHERE item_id = ?", (item_id,))

            cursor = conn.execute("DELETE FROM food_items WHERE item_id = ?", (item_id,))
            conn.commit()
            return cursor.rowcount > 0

    # =========================================================================
    # FOOD SIGNUPS
    # =========================================================================

    def claim_food_item(self, item_id: str, signer_name: str, dish_description: str = "") -> str:
        clean_signer = signer_name.strip()
        clean_desc = dish_description.strip()
        signup_id = f"fs_{uuid.uuid4().hex[:8]}"

        with self._get_connection() as conn:
            # Check item exists
            item = conn.execute("SELECT item_id, name FROM food_items WHERE item_id = ?", (item_id,)).fetchone()
            if not item:
                raise ValueError(f"Food item {item_id} does not exist.")

            # Optimistic lock check
            existing = conn.execute("SELECT signup_id, signer_name FROM food_signups WHERE item_id = ?", (item_id,)).fetchone()
            if existing:
                raise ValueError(f"This food item has already been claimed by {existing['signer_name']}.")

            try:
                conn.execute("""
                INSERT INTO food_signups (signup_id, item_id, signer_name, dish_description, created_at, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
                """, (signup_id, item_id, clean_signer, clean_desc))
                conn.commit()
            except sqlite3.IntegrityError:
                raise ValueError("This food item has already been claimed by someone else.")

        return signup_id

    def update_food_signup(
        self,
        signup_id: str,
        item_id: Optional[str] = None,
        dish_description: Optional[str] = None
    ) -> bool:
        with self._get_connection() as conn:
            cur = conn.execute("SELECT * FROM food_signups WHERE signup_id = ?", (signup_id,)).fetchone()
            if not cur:
                raise ValueError(f"Sign-up {signup_id} not found.")

            updates = ["updated_at = datetime('now')"]
            params = []

            if item_id is not None and item_id != cur["item_id"]:
                # Check target item is available
                taken = conn.execute(
                    "SELECT signup_id, signer_name FROM food_signups WHERE item_id = ? AND signup_id != ?",
                    (item_id, signup_id)
                ).fetchone()
                if taken:
                    raise ValueError(f"Target food item is already claimed by {taken['signer_name']}.")
                updates.append("item_id = ?")
                params.append(item_id)

            if dish_description is not None:
                updates.append("dish_description = ?")
                params.append(dish_description.strip())

            params.append(signup_id)
            cursor = conn.execute(f"UPDATE food_signups SET {', '.join(updates)} WHERE signup_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0

    def release_food_signup(self, signup_id: str) -> bool:
        with self._get_connection() as conn:
            cursor = conn.execute("DELETE FROM food_signups WHERE signup_id = ?", (signup_id,))
            conn.commit()
            return cursor.rowcount > 0

    def get_food_signup_for_signer(self, signer_name: str) -> Optional[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                row = conn.execute("""
                SELECT 
                    s.signup_id,
                    s.item_id,
                    s.signer_name,
                    s.dish_description,
                    s.created_at,
                    s.updated_at,
                    i.name AS item_name,
                    g.group_id,
                    g.name AS group_name
                FROM food_signups s
                JOIN food_items i ON s.item_id = i.item_id
                JOIN food_groups g ON i.group_id = g.group_id
                WHERE LOWER(TRIM(s.signer_name)) = LOWER(TRIM(?))
                LIMIT 1
                """, (signer_name,)).fetchone()
                return dict(row) if row else None
        except Exception as ex:
            logger.error(f"Error fetching food signup for signer {signer_name}: {ex}")
            return None

    def seed_food_catalog(self, seed_items: List[Any]):
        """Seeds food groups and items from configuration if tables are empty."""
        try:
            with self._get_connection() as conn:
                existing_groups = conn.execute("SELECT COUNT(*) AS cnt FROM food_groups").fetchone()["cnt"]
                if existing_groups > 0:
                    return

                logger.info("Seeding initial food catalog with %d items...", len(seed_items))
                group_map = {}
                group_order = 0
                item_order = {}

                for it in seed_items:
                    g_name = getattr(it, "group", None) or (it.get("group") if isinstance(it, dict) else "General")
                    i_name = getattr(it, "name", None) or (it.get("name") if isinstance(it, dict) else "")
                    if not g_name or not i_name:
                        continue

                    if g_name not in group_map:
                        g_id = f"fg_{uuid.uuid4().hex[:8]}"
                        conn.execute(
                            "INSERT INTO food_groups (group_id, name, display_order) VALUES (?, ?, ?)",
                            (g_id, g_name, group_order)
                        )
                        group_map[g_name] = g_id
                        item_order[g_name] = 0
                        group_order += 1

                    g_id = group_map[g_name]
                    it_id = f"fi_{uuid.uuid4().hex[:8]}"
                    conn.execute(
                        "INSERT INTO food_items (item_id, name, group_id, display_order) VALUES (?, ?, ?, ?)",
                        (it_id, i_name, g_id, item_order[g_name])
                    )
                    item_order[g_name] += 1

                conn.commit()
                logger.info("Food catalog seeded successfully.")
        except Exception as ex:
            logger.error(f"Error seeding food catalog: {ex}")

    def sync_food_from_sheet(self, sheet_rows: List[List[str]], serving_portion_note: Optional[str] = None):
        """
        Synchronizes food catalog and signups from Google Sheet 'Food Sign-Up' tab into SQLite.
        sheet_rows: list of rows [Food Item Type, Name of Singer/Parent/Family, Food Description]
        """
        if not sheet_rows:
            return

        def categorize_item(item_name: str) -> str:
            lower = item_name.lower()
            if "appetizer" in lower:
                return "Appetizers"
            if "rice" in lower or "pulav" in lower or "pulao" in lower or "biriyani" in lower or "biryani" in lower:
                return "Rice & Main"
            if "curry" in lower:
                return "Curries"
            if "chappati" in lower or "roti" in lower or "naan" in lower or "bread" in lower:
                return "Breads & Sides"
            if "dessert" in lower or "sweet" in lower:
                return "Desserts"
            return "Main Dishes"

        group_priority = {
            "Appetizers": 1,
            "Rice & Main": 2,
            "Curries": 3,
            "Breads & Sides": 4,
            "Desserts": 5,
            "Main Dishes": 6
        }

        try:
            with self._get_connection() as conn:
                if serving_portion_note and serving_portion_note.strip():
                    conn.execute("""
                    INSERT OR REPLACE INTO app_settings (key, value, updated_at)
                    VALUES ('food_serving_note', ?, datetime('now'))
                    """, (serving_portion_note.strip(),))

                for row_idx, r in enumerate(sheet_rows):
                    if not r:
                        continue
                    item_name = str(r[0]).strip() if len(r) > 0 else ""
                    if not item_name or item_name.lower().startswith("food item") or item_name.lower().startswith("serving portion"):
                        continue

                    signer_name = str(r[1]).strip() if len(r) > 1 and r[1] is not None else ""
                    dish_desc = str(r[2]).strip() if len(r) > 2 and r[2] is not None else ""

                    group_name = categorize_item(item_name)
                    g_row = conn.execute("SELECT group_id FROM food_groups WHERE name = ?", (group_name,)).fetchone()
                    if not g_row:
                        g_id = f"fg_{uuid.uuid4().hex[:8]}"
                        d_order = group_priority.get(group_name, 10)
                        conn.execute(
                            "INSERT INTO food_groups (group_id, name, display_order) VALUES (?, ?, ?)",
                            (g_id, group_name, d_order)
                        )
                    else:
                        g_id = g_row["group_id"]

                    i_row = conn.execute("SELECT item_id FROM food_items WHERE name = ?", (item_name,)).fetchone()
                    if not i_row:
                        i_id = f"fi_{uuid.uuid4().hex[:8]}"
                        conn.execute(
                            "INSERT INTO food_items (item_id, name, group_id, display_order) VALUES (?, ?, ?, ?)",
                            (i_id, item_name, g_id, row_idx)
                        )
                    else:
                        i_id = i_row["item_id"]
                        conn.execute("UPDATE food_items SET display_order = ? WHERE item_id = ?", (row_idx, i_id))

                    # If signer is present in the sheet, update or insert food_signup
                    if signer_name:
                        s_row = conn.execute("SELECT signup_id FROM food_signups WHERE item_id = ?", (i_id,)).fetchone()
                        if s_row:
                            conn.execute("""
                            UPDATE food_signups 
                            SET signer_name = ?, dish_description = ?, updated_at = datetime('now')
                            WHERE item_id = ?
                            """, (signer_name, dish_desc, i_id))
                        else:
                            s_id = f"fs_{uuid.uuid4().hex[:8]}"
                            conn.execute("""
                            INSERT INTO food_signups (signup_id, item_id, signer_name, dish_description, created_at, updated_at)
                            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
                            """, (s_id, i_id, signer_name, dish_desc))

                conn.commit()
                logger.info("Successfully synced food catalog and signups from sheet.")
        except Exception as ex:
            logger.error(f"Error syncing food from sheet: {ex}")
            raise

    # =========================================================================
    # PERFORMANCES
    # =========================================================================

    def create_performance(
        self,
        performer_name: str,
        performance_type: str = "Solo",
        partner_name: Optional[str] = None,
        contact_info: Optional[str] = None,
        song_title: str = "",
        movie_name: Optional[str] = None,
        age_group: Optional[str] = None,
        guardian_name: Optional[str] = None,
        guardian_phone: Optional[str] = None,
        stage_notes: Optional[str] = "",
        track_status: str = "Pending",
        created_via: str = "signup"
    ) -> str:
        """Generates next PK-XXX entry_id and inserts a new performance record."""
        prefix = getattr(settings, "entry_id_prefix", "PK") or "PK"
        now_iso = datetime.now(timezone.utc).isoformat()
        extra_tags = [age_group] if age_group else []

        with self._get_connection() as conn:
            # Determine next entry_id number
            rows = conn.execute("SELECT entry_id FROM performances WHERE entry_id LIKE ?", (f"{prefix}-%",)).fetchall()
            max_num = 0
            for r in rows:
                m = re.match(rf"{prefix}-(\d+)", r["entry_id"])
                if m:
                    max_num = max(max_num, int(m.group(1)))
            next_num = max_num + 1
            entry_id = f"{prefix}-{next_num:03d}"

            # Calculate next sequence order
            seq_row = conn.execute("SELECT COALESCE(MAX(sequence_order), 0) + 1 AS next_seq FROM performances").fetchone()
            sequence_order = seq_row["next_seq"] if seq_row else 1

            is_missing = 1 if not song_title or not song_title.strip() else 0

            conn.execute("""
            INSERT INTO performances (
                entry_id, performer_name, performance_type, partner_name, contact_info,
                song_title, movie_name, sequence_order, performance_status, track_status,
                duration, drive_file_id, drive_file_name, last_updated, row_index,
                is_song_name_missing, extra_tags_json, stage_notes, age_group,
                guardian_name, guardian_phone, created_via
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                entry_id,
                performer_name.strip(),
                performance_type.strip(),
                partner_name.strip() if partner_name else None,
                contact_info.strip() if contact_info else None,
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
                created_via
            ))
            conn.commit()

        return entry_id

    def update_performance_details(self, entry_id: str, **fields) -> bool:
        """Updates specific performance details (e.g. song, movie, partner, age, guardian, track_status)."""
        allowed_fields = {
            "song_title", "movie_name", "partner_name", "performance_type",
            "age_group", "guardian_name", "guardian_phone", "contact_info",
            "stage_notes", "track_status"
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
            is_missing = 1 if not song_val or not str(song_val).strip() else 0
            updates.append("is_song_name_missing = ?")
            params.append(is_missing)

        now_iso = datetime.now(timezone.utc).isoformat()
        updates.append("last_updated = ?")
        params.append(now_iso)

        params.append(entry_id)
        with self._get_connection() as conn:
            cursor = conn.execute(f"UPDATE performances SET {', '.join(updates)} WHERE entry_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0

    def count_performances_for_performer(self, name: str) -> Dict[str, int]:
        """Counts how many performances this participant is enrolled in (Solo, Duet, Group, Total)."""
        clean_name = name.strip().lower()
        with self._get_connection() as conn:
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
        """Atomically saves or updates all performance entries."""
        try:
            with self._get_connection() as conn:
                for p in entries:
                    extra_tags = getattr(p, "extra_tags", []) or []
                    stage_notes = getattr(p, "stage_notes", "") or ""
                    age_group = getattr(p, "age_group", "") or ""
                    guardian_name = getattr(p, "guardian_name", "") or ""
                    guardian_phone = getattr(p, "guardian_phone", "") or ""
                    created_via = getattr(p, "created_via", "sheet") or "sheet"

                    conn.execute("""
                    INSERT INTO performances (
                        entry_id, performer_name, performance_type, partner_name, contact_info,
                        song_title, movie_name, sequence_order, performance_status, track_status,
                        duration, drive_file_id, drive_file_name, last_updated, row_index,
                        is_song_name_missing, extra_tags_json, stage_notes, age_group,
                        guardian_name, guardian_phone, created_via
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        guardian_phone=COALESCE(NULLIF(excluded.guardian_phone, ''), performances.guardian_phone, '')
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
                        1 if getattr(p, "is_song_name_missing", False) else 0,
                        json.dumps(extra_tags),
                        stage_notes,
                        age_group,
                        guardian_name,
                        guardian_phone,
                        created_via
                    ))

                # Delete entries no longer in sheet, preserving web signups
                incoming_ids = [p.entry_id for p in entries]
                if incoming_ids:
                    placeholders = ",".join("?" for _ in incoming_ids)
                    conn.execute(
                        f"DELETE FROM performances WHERE entry_id NOT IN ({placeholders}) AND created_via != 'signup'",
                        incoming_ids
                    )

                conn.commit()
            self.set_last_sync_time()
        except Exception as ex:
            logger.error(f"Error saving performances to SQLite: {ex}")
            raise

    def get_all_performances(self) -> List[Dict[str, Any]]:
        """Returns all performance dictionaries ordered by sequence_order."""
        try:
            with self._get_connection() as conn:
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
                    item["is_song_name_missing"] = bool(item["is_song_name_missing"])
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

    def update_performance_field(self, entry_id: str, field_name: str, value: Any):
        """Updates a specific field of a performance in SQLite."""
        allowed_fields = {
            "performance_status", "track_status", "sequence_order", "duration",
            "drive_file_id", "drive_file_name", "last_updated", "song_title",
            "stage_notes", "age_group", "guardian_name", "guardian_phone"
        }
        if field_name not in allowed_fields:
            raise ValueError(f"Field {field_name} not allowed for direct update")
        with self._get_connection() as conn:
            conn.execute(f"UPDATE performances SET {field_name} = ? WHERE entry_id = ?", (value, entry_id))
            conn.commit()

    def set_last_sync_time(self, ts: Optional[str] = None):
        if not ts:
            ts = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            conn.execute("""
            INSERT INTO sync_meta (key, value) VALUES ('last_synced_at', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """, (ts,))
            conn.commit()

    def get_last_sync_time(self) -> Optional[str]:
        try:
            with self._get_connection() as conn:
                row = conn.execute("SELECT value FROM sync_meta WHERE key='last_synced_at'").fetchone()
                return row["value"] if row else None
        except Exception:
            return None

    def set_dirty_sequence(self, is_dirty: bool = True):
        with self._get_connection() as conn:
            conn.execute("""
            INSERT INTO sync_meta (key, value) VALUES ('sequence_dirty', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """, ("1" if is_dirty else "0",))
            conn.commit()

    def is_sequence_dirty(self) -> bool:
        try:
            with self._get_connection() as conn:
                row = conn.execute("SELECT value FROM sync_meta WHERE key='sequence_dirty'").fetchone()
                return bool(row and row["value"] == "1")
        except Exception:
            return False

    def set_active_entry_id(self, entry_id: Optional[str]):
        with self._get_connection() as conn:
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
            with self._get_connection() as conn:
                row = conn.execute("SELECT value FROM sync_meta WHERE key='active_entry_id'").fetchone()
                return row["value"] if row else None
        except Exception:
            return None

    # =========================================================================
    # BACKUP LOG
    # =========================================================================

    def log_backup_start(self) -> int:
        with self._get_connection() as conn:
            cursor = conn.execute("""
            INSERT INTO backup_log (triggered_at, status) VALUES (datetime('now'), 'pending')
            """)
            conn.commit()
            return cursor.lastrowid

    def log_backup_success(self, log_id: int, rows_backed: int):
        with self._get_connection() as conn:
            conn.execute("""
            UPDATE backup_log 
            SET completed_at = datetime('now'), status = 'success', rows_backed = ?
            WHERE id = ?
            """, (rows_backed, log_id))
            conn.commit()

    def log_backup_error(self, log_id: int, error_msg: str):
        with self._get_connection() as conn:
            conn.execute("""
            UPDATE backup_log 
            SET completed_at = datetime('now'), status = 'failed', error_msg = ?
            WHERE id = ?
            """, (error_msg, log_id))
            conn.commit()

    def get_backup_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                cursor = conn.execute("""
                SELECT * FROM backup_log ORDER BY id DESC LIMIT ?
                """, (limit,))
                return [dict(r) for r in cursor.fetchall()]
        except Exception as ex:
            logger.error(f"Error fetching backup history: {ex}")
            return []

    def get_last_backup_info(self) -> Optional[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                row = conn.execute("""
                SELECT * FROM backup_log ORDER BY id DESC LIMIT 1
                """).fetchone()
                return dict(row) if row else None
        except Exception as ex:
            logger.error(f"Error fetching last backup info: {ex}")
            return None

    def reset_database(self):
        """Drops and re-creates tables cleanly on user request."""
        with self._get_connection() as conn:
            conn.execute("DROP TABLE IF EXISTS performances")
            conn.execute("DROP TABLE IF EXISTS sync_meta")
            conn.execute("DROP TABLE IF EXISTS app_settings")
            conn.execute("DROP TABLE IF EXISTS food_signups")
            conn.execute("DROP TABLE IF EXISTS food_items")
            conn.execute("DROP TABLE IF EXISTS food_groups")
            conn.execute("DROP TABLE IF EXISTS backup_log")
            conn.commit()
        self._ensure_db()


db_service = DBService()

