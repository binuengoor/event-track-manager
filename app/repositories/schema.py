import re
import uuid
import sqlite3
import logging

logger = logging.getLogger("db-schema")


def get_or_create_participant_conn(
    conn: sqlite3.Connection,
    name: str,
    phone: str = "",
    age_group: str = "Senior",
    guardian_name: str = "",
    guardian_phone: str = ""
) -> str:
    clean_name = name.strip()
    if not clean_name:
        return ""

    row = conn.execute(
        "SELECT participant_id, phone, age_group, guardian_name, guardian_phone FROM participants WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
        (clean_name,)
    ).fetchone()

    if row:
        part_id = row["participant_id"]
        updates = []
        params = []
        if phone and not row["phone"]:
            updates.append("phone = ?")
            params.append(phone)
        if age_group and age_group != "Senior" and row["age_group"] == "Senior":
            updates.append("age_group = ?")
            params.append(age_group)
        if guardian_name and not row["guardian_name"]:
            updates.append("guardian_name = ?")
            params.append(guardian_name)
        if guardian_phone and not row["guardian_phone"]:
            updates.append("guardian_phone = ?")
            params.append(guardian_phone)

        if updates:
            updates.append("updated_at = datetime('now')")
            params.append(part_id)
            conn.execute(f"UPDATE participants SET {', '.join(updates)} WHERE participant_id = ?", params)

        return part_id

    # Insert new participant
    part_id = f"pt_{uuid.uuid4().hex[:8]}"
    conn.execute("""
    INSERT INTO participants (participant_id, name, phone, age_group, guardian_name, guardian_phone, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    """, (part_id, clean_name, phone or "", age_group or "Senior", guardian_name or "", guardian_phone or ""))
    return part_id


def backfill_participants(conn: sqlite3.Connection):
    """Idempotently backfills participants table from existing performances and food signups."""
    try:
        # 1. Primary performers from performances
        rows = conn.execute("""
            SELECT entry_id, performer_name, contact_info, age_group, guardian_name, guardian_phone, participant_id
            FROM performances
        """).fetchall()

        for r in rows:
            name = (r["performer_name"] or "").strip()
            if not name:
                continue
            part_id = r["participant_id"] if "participant_id" in r.keys() and r["participant_id"] else None
            if not part_id:
                part_id = get_or_create_participant_conn(
                    conn,
                    name=name,
                    phone=(r["contact_info"] or "").strip(),
                    age_group=(r["age_group"] or "Senior").strip(),
                    guardian_name=(r["guardian_name"] or "").strip(),
                    guardian_phone=(r["guardian_phone"] or "").strip()
                )
                conn.execute("UPDATE performances SET participant_id = ? WHERE entry_id = ?", (part_id, r["entry_id"]))

        # 2. Partners from performances
        partner_rows = conn.execute("""
            SELECT partner_name, partner_phone, partner_age_group, guardian_name, guardian_phone
            FROM performances
            WHERE partner_name IS NOT NULL AND partner_name != ''
        """).fetchall()

        for r in partner_rows:
            raw_partner = (r["partner_name"] or "").strip()
            if not raw_partner:
                continue
            tokens = re.split(r'\s*(?:&|,|\band\b)\s*', raw_partner, flags=re.IGNORECASE)
            for token in tokens:
                p_name = token.strip()
                if p_name and len(p_name) >= 2:
                    p_age = (r["partner_age_group"] or "Senior").strip()
                    is_junior = "junior" in p_age.lower()
                    get_or_create_participant_conn(
                        conn,
                        name=p_name,
                        phone=(r["partner_phone"] or "").strip(),
                        age_group=p_age,
                        guardian_name=(r["guardian_name"] or "").strip() if is_junior else "",
                        guardian_phone=(r["guardian_phone"] or "").strip() if is_junior else ""
                    )

        # 3. Signers from food_signups
        food_rows = conn.execute("SELECT signup_id, signer_name, signer_phone, participant_id FROM food_signups").fetchall()
        for fr in food_rows:
            s_name = (fr["signer_name"] or "").strip()
            part_id = fr["participant_id"] if "participant_id" in fr.keys() and fr["participant_id"] else None
            if s_name and not part_id:
                p_id = get_or_create_participant_conn(
                    conn,
                    name=s_name,
                    phone=(fr["signer_phone"] or "").strip()
                )
                conn.execute("UPDATE food_signups SET participant_id = ? WHERE signup_id = ?", (p_id, fr["signup_id"]))
    except Exception as ex:
        logger.warning("Error backfilling participants: %s", ex)


def ensure_database(conn: sqlite3.Connection):
    """Creates all database tables, columns, indexes and backfills canonical participants."""
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
        partner_age_group TEXT DEFAULT '',
        partner_phone TEXT DEFAULT '',
        created_via TEXT DEFAULT 'sheet',
        media_type TEXT DEFAULT 'audio'
    )
    """)

    # Migrations for existing databases
    for col_name, col_def in [
        ("stage_notes", "TEXT DEFAULT ''"),
        ("age_group", "TEXT DEFAULT ''"),
        ("guardian_name", "TEXT DEFAULT ''"),
        ("guardian_phone", "TEXT DEFAULT ''"),
        ("partner_age_group", "TEXT DEFAULT ''"),
        ("partner_phone", "TEXT DEFAULT ''"),
        ("created_via", "TEXT DEFAULT 'sheet'"),
        ("participant_id", "TEXT DEFAULT ''"),
        ("media_type", "TEXT DEFAULT 'audio'"),
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
        signer_phone     TEXT DEFAULT '',
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now'))
    )
    """)

    # Migrations for existing food_signups table
    for col_name, col_def in [
        ("signer_phone", "TEXT DEFAULT ''"),
        ("participant_id", "TEXT DEFAULT ''"),
    ]:
        try:
            conn.execute(f"ALTER TABLE food_signups ADD COLUMN {col_name} {col_def}")
        except Exception:
            pass

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

    # 8. Activity logs / Audit trail
    conn.execute("""
    CREATE TABLE IF NOT EXISTS activity_logs (
        log_id         TEXT PRIMARY KEY,
        timestamp      TEXT NOT NULL,
        action_type    TEXT NOT NULL,
        performer_name TEXT NOT NULL,
        entry_id       TEXT DEFAULT '',
        summary        TEXT NOT NULL,
        details        TEXT DEFAULT '',
        source         TEXT DEFAULT 'system'
    )
    """)
    conn.execute("""
    CREATE INDEX IF NOT EXISTS idx_activity_logs_ts ON activity_logs (timestamp DESC)
    """)
    conn.execute("""
    CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs (action_type)
    """)
    conn.execute("""
    CREATE INDEX IF NOT EXISTS idx_activity_logs_name ON activity_logs (performer_name)
    """)

    # 9. Participants table (canonical participant registry)
    conn.execute("""
    CREATE TABLE IF NOT EXISTS participants (
        participant_id TEXT PRIMARY KEY,
        name           TEXT NOT NULL UNIQUE,
        phone          TEXT DEFAULT '',
        age_group      TEXT DEFAULT 'Senior',
        guardian_name  TEXT DEFAULT '',
        guardian_phone TEXT DEFAULT '',
        created_at     TEXT DEFAULT (datetime('now')),
        updated_at     TEXT DEFAULT (datetime('now'))
    )
    """)
    conn.execute("""
    CREATE INDEX IF NOT EXISTS idx_participants_name ON participants (name)
    """)

    # Idempotent backfill
    backfill_participants(conn)
    conn.commit()
