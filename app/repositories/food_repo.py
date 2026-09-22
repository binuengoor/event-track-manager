import re
import uuid
import sqlite3
import logging
from typing import List, Optional, Dict, Any, Callable

from app.repositories.base import BaseRepository
from app.repositories.schema import get_or_create_participant_conn
from app.utils.name_matcher import names_match, split_signer_names

logger = logging.getLogger("food-repo")


class FoodRepository(BaseRepository):
    """Repository for managing food groups, items, and signups/claims."""

    def __init__(self, db_manager, rename_performer_fn: Optional[Callable[[str, str], bool]] = None):
        super().__init__(db_manager)
        self.rename_performer_fn = rename_performer_fn

    # =========================================================================
    # FOOD GROUPS
    # =========================================================================

    def get_food_groups(self) -> List[Dict[str, Any]]:
        try:
            with self.get_connection() as conn:
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
        with self.get_connection() as conn:
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
        with self.get_connection() as conn:
            cursor = conn.execute(f"UPDATE food_groups SET {', '.join(updates)} WHERE group_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0

    def delete_food_group(self, group_id: str) -> bool:
        with self.get_connection() as conn:
            count_row = conn.execute("SELECT COUNT(*) AS cnt FROM food_items WHERE group_id = ?", (group_id,)).fetchone()
            item_count = count_row["cnt"] if count_row else 0
            if item_count > 0:
                raise ValueError(f"This group has {item_count} items. Move or delete the items first.")

            cursor = conn.execute("DELETE FROM food_groups WHERE group_id = ?", (group_id,))
            conn.commit()
            return cursor.rowcount > 0

    def reorder_food_groups(self, ordered_ids: List[str]):
        with self.get_connection() as conn:
            for idx, gid in enumerate(ordered_ids):
                conn.execute("UPDATE food_groups SET display_order = ? WHERE group_id = ?", (idx, gid))
            conn.commit()

    # =========================================================================
    # FOOD ITEMS
    # =========================================================================

    def get_food_items_by_group(self, group_id: str) -> List[Dict[str, Any]]:
        try:
            with self.get_connection() as conn:
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
                    s.signer_phone,
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
            with self.get_connection() as conn:
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
                    s.signer_phone,
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
        with self.get_connection() as conn:
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
        with self.get_connection() as conn:
            cursor = conn.execute(f"UPDATE food_items SET {', '.join(updates)} WHERE item_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0

    def delete_food_item(self, item_id: str, force: bool = False) -> bool:
        with self.get_connection() as conn:
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
    # FOOD SIGNUPS & CLAIMS
    # =========================================================================

    def claim_food_item(self, item_id: str, signer_name: str, dish_description: str = "", signer_phone: str = "") -> str:
        clean_signer = signer_name.strip()
        clean_desc = dish_description.strip()
        clean_phone = signer_phone.strip()
        signup_id = f"fs_{uuid.uuid4().hex[:8]}"

        with self.get_connection() as conn:
            item = conn.execute("SELECT item_id, name FROM food_items WHERE item_id = ?", (item_id,)).fetchone()
            if not item:
                raise ValueError(f"Food item {item_id} does not exist.")

            existing = conn.execute("SELECT signup_id, signer_name FROM food_signups WHERE item_id = ?", (item_id,)).fetchone()
            if existing:
                raise ValueError(f"This food item has already been claimed by {existing['signer_name']}.")

            participant_id = get_or_create_participant_conn(
                conn,
                name=clean_signer,
                phone=clean_phone
            )

            try:
                conn.execute("""
                INSERT INTO food_signups (signup_id, item_id, signer_name, dish_description, signer_phone, participant_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                """, (signup_id, item_id, clean_signer, clean_desc, clean_phone, participant_id))
                conn.commit()
            except sqlite3.IntegrityError:
                raise ValueError("This food item has already been claimed by someone else.")

        return signup_id

    def update_food_signup(
        self,
        signup_id: str,
        item_id: Optional[str] = None,
        dish_description: Optional[str] = None,
        signer_phone: Optional[str] = None
    ) -> bool:
        with self.get_connection() as conn:
            cur = conn.execute("SELECT * FROM food_signups WHERE signup_id = ?", (signup_id,)).fetchone()
            if not cur:
                raise ValueError(f"Sign-up {signup_id} not found.")

            updates = ["updated_at = datetime('now')"]
            params = []

            if item_id is not None and item_id != cur["item_id"]:
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

            if signer_phone is not None:
                updates.append("signer_phone = ?")
                params.append(signer_phone.strip())

            params.append(signup_id)
            cursor = conn.execute(f"UPDATE food_signups SET {', '.join(updates)} WHERE signup_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0

    def release_food_signup(self, signup_id: str) -> bool:
        with self.get_connection() as conn:
            cursor = conn.execute("DELETE FROM food_signups WHERE signup_id = ?", (signup_id,))
            conn.commit()
            return cursor.rowcount > 0

    def get_food_signup_for_signer(self, signer_name: str) -> Optional[Dict[str, Any]]:
        clean_target = (signer_name or "").strip()
        if not clean_target:
            return None
        try:
            with self.get_connection() as conn:
                rows = conn.execute("""
                SELECT 
                    s.signup_id,
                    s.item_id,
                    s.signer_name,
                    s.dish_description,
                    s.signer_phone,
                    s.created_at,
                    s.updated_at,
                    i.name AS item_name,
                    g.group_id,
                    g.name AS group_name
                FROM food_signups s
                JOIN food_items i ON s.item_id = i.item_id
                JOIN food_groups g ON i.group_id = g.group_id
                """).fetchall()

                # Tier 1: Exact match
                for r in rows:
                    raw_signer = (r["signer_name"] or "").strip()
                    if raw_signer.lower() == clean_target.lower():
                        return dict(r)

                # Tier 2: Token exact match
                for r in rows:
                    raw_signer = (r["signer_name"] or "").strip()
                    for t in split_signer_names(raw_signer):
                        if t.strip().lower() == clean_target.lower():
                            return dict(r)

                # Tier 3: Intelligent names_match
                for r in rows:
                    raw_signer = (r["signer_name"] or "").strip()
                    if names_match(clean_target, raw_signer):
                        return dict(r)

                return None
        except Exception as ex:
            logger.error(f"Error fetching food signup for signer {signer_name}: {ex}")
            return None

    def get_all_food_signups_map(self) -> Dict[str, Dict[str, Any]]:
        """Returns a mapping of normalized signer_name/aliases -> food signup dict."""
        try:
            with self.get_connection() as conn:
                rows = conn.execute("""
                SELECT 
                    s.signup_id,
                    s.item_id,
                    s.signer_name,
                    s.dish_description,
                    s.signer_phone,
                    s.created_at,
                    i.name AS item_name,
                    g.group_id,
                    g.name AS group_name
                FROM food_signups s
                JOIN food_items i ON s.item_id = i.item_id
                LEFT JOIN food_groups g ON i.group_id = g.group_id
                """).fetchall()
                result = {}
                for r in rows:
                    d = dict(r)
                    raw_signer = (d.get("signer_name") or "").strip()
                    if not raw_signer:
                        continue
                    result[raw_signer.lower()] = d

                    sub_signers = split_signer_names(raw_signer)
                    for sub in sub_signers:
                        sub_clean = sub.strip().lower()
                        if sub_clean and sub_clean not in result:
                            result[sub_clean] = d

                        m = re.match(r"^(.*?)\s*\((.*?)\)$", sub_clean)
                        if m:
                            part1 = m.group(1).strip().lower()
                            part2 = m.group(2).strip().lower()
                            if part1 and part1 not in result:
                                result[part1] = d
                            if part2 and part2 not in result:
                                result[part2] = d
                            p1_first = part1.split()[0]
                            if len(p1_first) >= 3 and p1_first not in result:
                                result[p1_first] = d
                            p2_first = part2.split()[0]
                            if len(p2_first) >= 3 and p2_first not in result:
                                result[p2_first] = d
                        else:
                            tokens = sub_clean.split()
                            if len(tokens) >= 1 and len(tokens[0]) >= 3:
                                if tokens[0] not in result:
                                    result[tokens[0]] = d

                return result
        except Exception as ex:
            logger.error(f"Error fetching all food signups map: {ex}")
            return {}

    def link_participant_to_food_item(
        self,
        performer_name: str,
        new_item_id: Optional[str],
        phone: Optional[str] = None
    ) -> bool:
        clean_name = performer_name.strip()
        if not clean_name:
            return False

        clean_new_item = new_item_id.strip() if new_item_id and new_item_id.strip().lower() not in ("none", "") else None

        with self.get_connection() as conn:
            current_signups = conn.execute("""
                SELECT signup_id, item_id, signer_name, signer_phone, dish_description
                FROM food_signups
            """).fetchall()

            old_signup_id = None
            old_item_id = None
            for s in current_signups:
                s_name = s["signer_name"] or ""
                if names_match(clean_name, s_name):
                    old_signup_id = s["signup_id"]
                    old_item_id = s["item_id"]
                    break

            if clean_new_item and old_item_id == clean_new_item:
                return True

            if old_signup_id and old_item_id != clean_new_item:
                old_row = conn.execute("SELECT * FROM food_signups WHERE signup_id = ?", (old_signup_id,)).fetchone()
                if old_row:
                    signers = split_signer_names(old_row["signer_name"])
                    remaining = [sn for sn in signers if not names_match(clean_name, sn)]
                    if not remaining:
                        conn.execute("DELETE FROM food_signups WHERE signup_id = ?", (old_signup_id,))
                    else:
                        conn.execute("""
                            UPDATE food_signups 
                            SET signer_name = ?, updated_at = datetime('now')
                            WHERE signup_id = ?
                        """, (" & ".join(remaining), old_signup_id))

            if clean_new_item:
                target_row = conn.execute("SELECT * FROM food_signups WHERE item_id = ?", (clean_new_item,)).fetchone()
                if target_row:
                    existing_signers = split_signer_names(target_row["signer_name"])
                    if not any(names_match(clean_name, sn) for sn in existing_signers):
                        combined = existing_signers + [clean_name]
                        conn.execute("""
                            UPDATE food_signups 
                            SET signer_name = ?, updated_at = datetime('now')
                            WHERE item_id = ?
                        """, (" & ".join(combined), clean_new_item))
                else:
                    signup_id = f"fs_{uuid.uuid4().hex[:8]}"
                    conn.execute("""
                        INSERT INTO food_signups (signup_id, item_id, signer_name, dish_description, signer_phone, created_at, updated_at)
                        VALUES (?, ?, ?, '', ?, datetime('now'), datetime('now'))
                    """, (signup_id, clean_new_item, clean_name, (phone or "").strip()))

            conn.commit()
            return True

    def update_food_signup_admin(
        self,
        item_id: str,
        name: Optional[str] = None,
        group_id: Optional[str] = None,
        signer_name: Optional[str] = None,
        signer_phone: Optional[str] = None,
        dish_description: Optional[str] = None,
        release_claim: bool = False
    ) -> bool:
        with self.get_connection() as conn:
            if name or group_id:
                updates = []
                params = []
                if name:
                    updates.append("name = ?")
                    params.append(name.strip())
                if group_id:
                    updates.append("group_id = ?")
                    params.append(group_id.strip())
                params.append(item_id)
                conn.execute(f"UPDATE food_items SET {', '.join(updates)} WHERE item_id = ?", params)

            if release_claim:
                conn.execute("DELETE FROM food_signups WHERE item_id = ?", (item_id,))
                conn.commit()
                return True

            renamed_pair = None
            cur_signup = conn.execute("SELECT * FROM food_signups WHERE item_id = ?", (item_id,)).fetchone()
            if cur_signup:
                old_signer = cur_signup["signer_name"]
                new_signer = signer_name.strip() if signer_name is not None else None

                if new_signer and new_signer.lower() != old_signer.lower():
                    conn.execute("""
                        UPDATE food_signups 
                        SET signer_name = ?, updated_at = datetime('now')
                        WHERE item_id = ?
                    """, (new_signer, item_id))
                    renamed_pair = (old_signer, new_signer)

                updates = ["updated_at = datetime('now')"]
                params = []
                if dish_description is not None:
                    updates.append("dish_description = ?")
                    params.append(dish_description.strip())
                if signer_phone is not None:
                    updates.append("signer_phone = ?")
                    params.append(signer_phone.strip())

                if len(updates) > 1:
                    params.append(item_id)
                    conn.execute(f"UPDATE food_signups SET {', '.join(updates)} WHERE item_id = ?", params)
            elif signer_name and signer_name.strip():
                signup_id = f"fs_{uuid.uuid4().hex[:8]}"
                conn.execute("""
                    INSERT INTO food_signups (signup_id, item_id, signer_name, dish_description, signer_phone, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                """, (signup_id, item_id, signer_name.strip(), (dish_description or "").strip(), (signer_phone or "").strip()))

            conn.commit()

        if renamed_pair:
            try:
                from app.events.bus import event_bus
                event_bus.publish("food_signer.renamed", old_signer=renamed_pair[0], new_signer=renamed_pair[1])
            except Exception:
                pass

        return True

    def seed_food_catalog(self, seed_items: List[Any]):
        try:
            with self.get_connection() as conn:
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
            with self.get_connection() as conn:
                if serving_portion_note and serving_portion_note.strip():
                    from app.repositories.settings_repo import SettingsRepository
                    SettingsRepository(self.db).set_setting("food_serving_note", serving_portion_note.strip())

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

                    if signer_name:
                        s_row = conn.execute("SELECT * FROM food_signups WHERE item_id = ?", (i_id,)).fetchone()
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

    def rename_signer(self, old_name: str, new_name: str) -> bool:
        """Updates food signup signer names when a participant or performer is renamed."""
        clean_old = old_name.strip()
        clean_new = new_name.strip()
        if not clean_old or not clean_new:
            return False

        with self.get_connection() as conn:
            for fs in conn.execute("SELECT signup_id, signer_name FROM food_signups").fetchall():
                s_name = fs["signer_name"] or ""
                if not s_name:
                    continue
                if clean_old.lower() == s_name.strip().lower():
                    conn.execute("UPDATE food_signups SET signer_name = ?, updated_at = datetime('now') WHERE signup_id = ?", (clean_new, fs["signup_id"]))
                elif names_match(clean_old, s_name):
                    tokens = split_signer_names(s_name)
                    updated_tokens = []
                    changed = False
                    for t in tokens:
                        if names_match(clean_old, t):
                            m = re.match(r"^(.*?)\s*\((.*?)\)$", t)
                            if m:
                                p1 = m.group(1).strip()
                                p2 = m.group(2).strip()
                                if names_match(clean_old, p1):
                                    updated_tokens.append(f"{clean_new} ({p2})")
                                    changed = True
                                elif names_match(clean_old, p2):
                                    updated_tokens.append(f"{p1} ({clean_new})")
                                    changed = True
                                else:
                                    updated_tokens.append(clean_new)
                                    changed = True
                            else:
                                updated_tokens.append(clean_new)
                                changed = True
                        else:
                            updated_tokens.append(t)
                    if changed:
                        conn.execute("UPDATE food_signups SET signer_name = ?, updated_at = datetime('now') WHERE signup_id = ?", (" & ".join(updated_tokens), fs["signup_id"]))
            conn.commit()
        return True
