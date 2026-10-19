import re
import sqlite3
import logging
from typing import List, Optional, Dict, Any

from app.repositories.base import BaseRepository
from app.repositories.schema import get_or_create_participant_conn
from app.utils.name_matcher import names_match

logger = logging.getLogger("participant-repo")


class ParticipantRepository(BaseRepository):
    """Repository for managing canonical participant records."""

    def get_or_create_participant(
        self,
        name: str,
        phone: str = "",
        age_group: str = "Senior",
        guardian_name: str = "",
        guardian_phone: str = ""
    ) -> str:
        with self.get_connection() as conn:
            part_id = get_or_create_participant_conn(
                conn,
                name=name,
                phone=phone,
                age_group=age_group,
                guardian_name=guardian_name,
                guardian_phone=guardian_phone
            )
            conn.commit()
            return part_id

    def get_participant(self, identifier: str) -> Optional[Dict[str, Any]]:
        """Retrieves a participant record by participant_id or exact name."""
        clean = identifier.strip()
        if not clean:
            return None
        with self.get_connection() as conn:
            row = conn.execute("""
                SELECT * FROM participants 
                WHERE participant_id = ? OR LOWER(TRIM(name)) = LOWER(TRIM(?))
                LIMIT 1
            """, (clean, clean)).fetchone()
            return dict(row) if row else None

    def get_all_participants(
        self,
        all_performances: Optional[List[Dict[str, Any]]] = None,
        all_food_items: Optional[List[Dict[str, Any]]] = None
    ) -> List[Dict[str, Any]]:
        """Returns all participants with attached performances and food signup details."""
        with self.get_connection() as conn:
            participants = [dict(r) for r in conn.execute("SELECT * FROM participants ORDER BY name COLLATE NOCASE ASC").fetchall()]

            perfs = all_performances if all_performances is not None else []
            food_items = all_food_items if all_food_items is not None else []

            for pt in participants:
                pt_name_lower = pt["name"].strip().lower()
                pt_perfs = []
                for p in perfs:
                    p1 = (p.get("performer_name") or "").strip().lower()
                    p2 = (p.get("partner_name") or "").strip().lower()
                    if p1 == pt_name_lower:
                        pt_perfs.append({**p, "role": "primary"})
                    elif p2 and (pt_name_lower in p2 or any(token.strip().lower() == pt_name_lower for token in re.split(r'[&,]|(?:\band\b)', p2))):
                        pt_perfs.append({**p, "role": "partner"})

                pt["performances"] = pt_perfs
                pt["total_performances"] = len(pt_perfs)

                # Food signup lookup
                food = None
                for fi in food_items:
                    s_name = (fi.get("signer_name") or "").strip()
                    if s_name and (s_name.lower() == pt_name_lower or names_match(pt["name"], s_name)):
                        food = fi
                        break
                pt["food_signup"] = food

            return participants

    def get_singers(self) -> List[Dict[str, Any]]:
        """Everyone who sings in the show (performers AND duet/group partners), alphabetical, with payment status.

        Potluck-only attendees are excluded. Participant rows are created on demand so every singer has an id.
        """
        from app.utils.name_matcher import split_signer_names
        with self.get_connection() as conn:
            perfs = [dict(r) for r in conn.execute("""
                SELECT entry_id, sequence_order, performer_name, partner_name, partner_age_group, partner_phone,
                       song_title, performance_type, age_group, contact_info, guardian_name, guardian_phone
                FROM performances ORDER BY COALESCE(sequence_order, 9999), row_index""").fetchall()]

            people: Dict[str, Dict[str, Any]] = {}

            def add(name, role, perf, phone, age, guardian, guardian_phone):
                name = (name or "").strip()
                if not name:
                    return
                key = name.lower()
                person = people.setdefault(key, {"name": name, "phone": "", "age_group": "", "guardian_name": "",
                                                 "guardian_phone": "", "songs": [], "entry_ids": []})
                person["phone"] = person["phone"] or (phone or "")
                person["age_group"] = person["age_group"] or (age or "")
                person["guardian_name"] = person["guardian_name"] or (guardian or "")
                person["guardian_phone"] = person["guardian_phone"] or (guardian_phone or "")
                title = (perf.get("song_title") or "").strip()
                person["songs"].append(title + (f" ({role})" if role == "partner" else "") if title else "(no title yet)")
                person["entry_ids"].append(perf["entry_id"])

            for p in perfs:
                add(p["performer_name"], "primary", p, p["contact_info"], p["age_group"], p["guardian_name"], p["guardian_phone"])
                for partner in split_signer_names(p.get("partner_name")):
                    junior = "junior" in (p.get("partner_age_group") or "").lower()
                    add(partner, "partner", p, p.get("partner_phone"), p.get("partner_age_group") or p.get("age_group"),
                        p["guardian_name"] if junior else "", p["guardian_phone"] if junior else "")

            result = []
            for key in sorted(people, key=lambda k: k):
                person = people[key]
                part_id = get_or_create_participant_conn(
                    conn, name=person["name"], phone=person["phone"], age_group=person["age_group"] or "Senior",
                    guardian_name=person["guardian_name"], guardian_phone=person["guardian_phone"])
                row = conn.execute("SELECT paid, paid_at, payment_note FROM participants WHERE participant_id = ?", (part_id,)).fetchone()
                result.append({
                    "participant_id": part_id, "name": person["name"], "age_group": person["age_group"],
                    "phone": person["phone"], "guardian_name": person["guardian_name"], "guardian_phone": person["guardian_phone"],
                    "songs": person["songs"], "act_count": len(person["entry_ids"]),
                    "paid": bool(row["paid"]) if row else False, "paid_at": (row["paid_at"] if row else "") or "",
                    "payment_note": (row["payment_note"] if row else "") or "",
                })
            conn.commit()
            return result

    def set_paid(self, updates: List[Dict[str, Any]]) -> int:
        """Saves paid checkboxes. Each update: {participant_id, paid, note?}. Returns rows changed."""
        changed = 0
        with self.get_connection() as conn:
            for u in updates:
                pid = str(u.get("participant_id") or "").strip()
                if not pid:
                    continue
                paid = 1 if u.get("paid") else 0
                note = (u.get("note") or "").strip()[:200] if u.get("note") is not None else None
                cur = conn.execute("SELECT paid FROM participants WHERE participant_id = ?", (pid,)).fetchone()
                if cur is None:
                    continue
                sets = ["paid = ?", "paid_at = CASE WHEN ? = 1 AND paid = 0 THEN datetime('now') WHEN ? = 0 THEN '' ELSE paid_at END", "updated_at = datetime('now')"]
                params = [paid, paid, paid]
                if note is not None:
                    sets.append("payment_note = ?")
                    params.append(note)
                params.append(pid)
                conn.execute(f"UPDATE participants SET {', '.join(sets)} WHERE participant_id = ?", params)
                changed += 1 if bool(cur["paid"]) != bool(paid) or note is not None else 0
            conn.commit()
        return changed

    def update_participant(self, participant_id: str, **fields) -> bool:
        """Updates participant details."""
        allowed_fields = {"name", "phone", "age_group", "guardian_name", "guardian_phone"}
        updates = []
        params = []
        for k, v in fields.items():
            if k in allowed_fields and v is not None:
                updates.append(f"{k} = ?")
                params.append(str(v).strip())

        if not updates:
            return False

        updates.append("updated_at = datetime('now')")
        params.append(participant_id)

        with self.get_connection() as conn:
            cursor = conn.execute(f"UPDATE participants SET {', '.join(updates)} WHERE participant_id = ?", params)
            conn.commit()
            return cursor.rowcount > 0
