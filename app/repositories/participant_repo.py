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
