import os
import sqlite3
import logging
from typing import List, Optional, Dict, Any

from app.repositories.base import DatabaseManager
from app.repositories.schema import ensure_database, backfill_participants, get_or_create_participant_conn
from app.repositories.settings_repo import SettingsRepository
from app.repositories.participant_repo import ParticipantRepository
from app.repositories.food_repo import FoodRepository
from app.repositories.performance_repo import PerformanceRepository
from app.repositories.audit_repo import AuditRepository
from app.utils.name_matcher import (
    is_placeholder_song_title,
    split_signer_names,
    names_match,
)

logger = logging.getLogger("db-service")


class DBService:
    """
    Facade service orchestrating specialized domain repositories.
    Provides complete backward compatibility with all existing callers and tests.
    """

    def __init__(self):
        self.db_manager = DatabaseManager()
        self.settings_repo = SettingsRepository(self.db_manager)
        self.participant_repo = ParticipantRepository(self.db_manager)
        self.performance_repo = PerformanceRepository(self.db_manager)
        self.food_repo = FoodRepository(self.db_manager, rename_performer_fn=self.rename_performer)
        self.audit_repo = AuditRepository(self.db_manager)
        self._ensure_db()

    @property
    def db_path(self) -> str:
        return self.db_manager.db_path

    @property
    def _db_path(self) -> str:
        return self.db_manager.db_path

    @_db_path.setter
    def _db_path(self, val: Optional[str]):
        self.db_manager.db_path = val

    def _get_connection(self) -> sqlite3.Connection:
        return self.db_manager.get_connection()

    def _ensure_db(self):
        try:
            with self._get_connection() as conn:
                ensure_database(conn)
        except Exception as ex:
            logger.error(f"Error initializing SQLite database at {self.db_path}: {ex}")

    def _get_or_create_participant_conn(
        self,
        conn: sqlite3.Connection,
        name: str,
        phone: str = "",
        age_group: str = "Senior",
        guardian_name: str = "",
        guardian_phone: str = ""
    ) -> str:
        return get_or_create_participant_conn(conn, name, phone, age_group, guardian_name, guardian_phone)

    def _backfill_participants(self, conn: sqlite3.Connection):
        backfill_participants(conn)

    # =========================================================================
    # APP SETTINGS
    # =========================================================================

    def get_app_setting(self, key: str) -> Optional[str]:
        return self.settings_repo.get_setting(key)

    def set_app_setting(self, key: str, value: Any):
        return self.settings_repo.set_setting(key, value)

    def get_all_app_settings(self) -> Dict[str, str]:
        return self.settings_repo.get_all_settings()

    def seed_app_settings(self, defaults: Dict[str, Any]):
        return self.settings_repo.seed_settings(defaults)

    # =========================================================================
    # FOOD GROUPS & ITEMS
    # =========================================================================

    def get_food_groups(self) -> List[Dict[str, Any]]:
        return self.food_repo.get_food_groups()

    def add_food_group(self, name: str) -> str:
        return self.food_repo.add_food_group(name)

    def update_food_group(self, group_id: str, name: Optional[str] = None, display_order: Optional[int] = None) -> bool:
        return self.food_repo.update_food_group(group_id, name, display_order)

    def delete_food_group(self, group_id: str) -> bool:
        return self.food_repo.delete_food_group(group_id)

    def reorder_food_groups(self, ordered_ids: List[str]):
        return self.food_repo.reorder_food_groups(ordered_ids)

    def get_food_items_by_group(self, group_id: str) -> List[Dict[str, Any]]:
        return self.food_repo.get_food_items_by_group(group_id)

    def get_all_food_items_with_signups(self) -> List[Dict[str, Any]]:
        return self.food_repo.get_all_food_items_with_signups()

    def add_food_item(self, name: str, group_id: str) -> str:
        return self.food_repo.add_food_item(name, group_id)

    def update_food_item(
        self,
        item_id: str,
        name: Optional[str] = None,
        group_id: Optional[str] = None,
        display_order: Optional[int] = None
    ) -> bool:
        return self.food_repo.update_food_item(item_id, name, group_id, display_order)

    def delete_food_item(self, item_id: str, force: bool = False) -> bool:
        return self.food_repo.delete_food_item(item_id, force=force)

    # =========================================================================
    # FOOD SIGNUPS & CLAIMS
    # =========================================================================

    def claim_food_item(self, item_id: str, signer_name: str, dish_description: str = "", signer_phone: str = "") -> str:
        return self.food_repo.claim_food_item(item_id, signer_name, dish_description, signer_phone)

    def update_food_signup(
        self,
        signup_id: str,
        item_id: Optional[str] = None,
        dish_description: Optional[str] = None,
        signer_phone: Optional[str] = None
    ) -> bool:
        return self.food_repo.update_food_signup(signup_id, item_id, dish_description, signer_phone)

    def release_food_signup(self, signup_id: str) -> bool:
        return self.food_repo.release_food_signup(signup_id)

    def get_food_signup_for_signer(self, signer_name: str) -> Optional[Dict[str, Any]]:
        return self.food_repo.get_food_signup_for_signer(signer_name)

    def get_all_food_signups_map(self) -> Dict[str, Dict[str, Any]]:
        return self.food_repo.get_all_food_signups_map()

    def link_participant_to_food_item(
        self,
        performer_name: str,
        new_item_id: Optional[str],
        phone: Optional[str] = None
    ) -> bool:
        return self.food_repo.link_participant_to_food_item(performer_name, new_item_id, phone)

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
        return self.food_repo.update_food_signup_admin(
            item_id=item_id,
            name=name,
            group_id=group_id,
            signer_name=signer_name,
            signer_phone=signer_phone,
            dish_description=dish_description,
            release_claim=release_claim
        )

    def seed_food_catalog(self, seed_items: List[Any]):
        return self.food_repo.seed_food_catalog(seed_items)

    def sync_food_from_sheet(self, sheet_rows: List[List[str]], serving_portion_note: Optional[str] = None):
        return self.food_repo.sync_food_from_sheet(sheet_rows, serving_portion_note)

    # =========================================================================
    # PERFORMANCES
    # =========================================================================

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
        return self.performance_repo.create_performance(
            performer_name=performer_name,
            performance_type=performance_type,
            partner_name=partner_name,
            partner_age_group=partner_age_group,
            contact_info=contact_info,
            partner_phone=partner_phone,
            song_title=song_title,
            movie_name=movie_name,
            age_group=age_group,
            guardian_name=guardian_name,
            guardian_phone=guardian_phone,
            stage_notes=stage_notes,
            track_status=track_status,
            created_via=created_via
        )

    def update_performance_details(self, entry_id: str, **fields) -> bool:
        return self.performance_repo.update_performance_details(entry_id, **fields)

    def delete_performance(self, entry_id: str) -> bool:
        return self.performance_repo.delete_performance(entry_id)

    def rename_performer(self, old_name: str, new_name: str) -> bool:
        return self.performance_repo.rename_performer(old_name, new_name)

    def count_performances_for_performer(self, name: str) -> Dict[str, int]:
        return self.performance_repo.count_performances_for_performer(name)

    def save_performances(self, entries: List[Any]):
        return self.performance_repo.save_performances(entries)

    def get_all_performances(self) -> List[Dict[str, Any]]:
        return self.performance_repo.get_all_performances()

    def get_performance(self, entry_id: str) -> Optional[Dict[str, Any]]:
        return self.performance_repo.get_performance(entry_id)

    def get_performance_by_id(self, entry_id: str) -> Optional[Dict[str, Any]]:
        return self.performance_repo.get_performance(entry_id)

    def update_performance_field(self, entry_id: str, field_name: str, value: Any):
        return self.performance_repo.update_performance_field(entry_id, field_name, value)

    def set_last_sync_time(self, ts: Optional[str] = None):
        return self.performance_repo.set_last_sync_time(ts)

    def get_last_sync_time(self) -> Optional[str]:
        return self.performance_repo.get_last_sync_time()

    def set_dirty_sequence(self, is_dirty: bool = True):
        return self.performance_repo.set_dirty_sequence(is_dirty)

    def is_sequence_dirty(self) -> bool:
        return self.performance_repo.is_sequence_dirty()

    def set_active_entry_id(self, entry_id: Optional[str]):
        return self.performance_repo.set_active_entry_id(entry_id)

    def get_active_entry_id(self) -> Optional[str]:
        return self.performance_repo.get_active_entry_id()

    # =========================================================================
    # BACKUP LOGS & ACTIVITY LOGS
    # =========================================================================

    def log_backup_start(self) -> int:
        return self.audit_repo.log_backup_start()

    def log_backup_success(self, log_id: int, rows_backed: int):
        return self.audit_repo.log_backup_success(log_id, rows_backed)

    def log_backup_error(self, log_id: int, error_msg: str):
        return self.audit_repo.log_backup_error(log_id, error_msg)

    def get_backup_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        return self.audit_repo.get_backup_history(limit)

    def get_last_backup_info(self) -> Optional[Dict[str, Any]]:
        return self.audit_repo.get_last_backup_info()

    def log_activity(
        self,
        action_type: str,
        performer_name: str,
        summary: str,
        entry_id: str = "",
        details: str = "",
        source: str = "system"
    ) -> str:
        return self.audit_repo.log_activity(
            action_type=action_type,
            performer_name=performer_name,
            summary=summary,
            entry_id=entry_id,
            details=details,
            source=source
        )

    def get_activity_logs(
        self,
        days: Optional[int] = 7,
        limit: int = 300,
        search: str = "",
        action_type: str = ""
    ) -> List[Dict[str, Any]]:
        return self.audit_repo.get_activity_logs(
            days=days,
            limit=limit,
            search=search,
            action_type=action_type
        )

    # =========================================================================
    # PARTICIPANTS (CANONICAL ROSTER)
    # =========================================================================

    def get_or_create_participant(
        self,
        name: str,
        phone: str = "",
        age_group: str = "Senior",
        guardian_name: str = "",
        guardian_phone: str = ""
    ) -> str:
        return self.participant_repo.get_or_create_participant(name, phone, age_group, guardian_name, guardian_phone)

    def get_participant(self, identifier: str) -> Optional[Dict[str, Any]]:
        return self.participant_repo.get_participant(identifier)

    def get_all_participants(self) -> List[Dict[str, Any]]:
        return self.participant_repo.get_all_participants(
            all_performances=self.get_all_performances(),
            all_food_items=self.get_all_food_items_with_signups()
        )

    def update_participant(self, participant_id: str, **fields) -> bool:
        return self.participant_repo.update_participant(participant_id, **fields)

    def reset_database(self):
        with self._get_connection() as conn:
            conn.execute("DROP TABLE IF EXISTS performances")
            conn.execute("DROP TABLE IF EXISTS participants")
            conn.execute("DROP TABLE IF EXISTS sync_meta")
            conn.execute("DROP TABLE IF EXISTS app_settings")
            conn.execute("DROP TABLE IF EXISTS food_signups")
            conn.execute("DROP TABLE IF EXISTS food_items")
            conn.execute("DROP TABLE IF EXISTS food_groups")
            conn.execute("DROP TABLE IF EXISTS backup_log")
            conn.execute("DROP TABLE IF EXISTS activity_logs")
            conn.commit()
        self._ensure_db()


db_service = DBService()
