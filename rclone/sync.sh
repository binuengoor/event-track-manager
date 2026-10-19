#!/bin/sh
# Event folder <-> cloud sync sidecar (rclone). Keeps the app free of any cloud credentials.
#
#   Up   : <events>/<EVENT_ID>  ->  $RCLONE_REMOTE      (signups.xlsx/csv, tracks/, backups/, gallery/)
#   Down : $RCLONE_REMOTE/incoming  ->  <events>/<EVENT_ID>/incoming   (files organizers drop in the cloud;
#          the app adopts any file whose name contains an entry id such as PK-004)
#
# The live database (event.db, -wal, -shm) is NEVER synced; consistent snapshots in backups/ are.
# Without RCLONE_TRASH the upload is a non-destructive `copy` (nothing is ever deleted remotely).
# With RCLONE_TRASH set, it is a `sync` and anything removed/renamed locally is moved to that trash path.
set -eu

: "${RCLONE_REMOTE:?Set RCLONE_REMOTE, e.g. gdrive:EventTrackManager/paattukoottam-2026}"
EVENTS_DIR="${EVENTS_DIR:-/events}"
EVENT_ID="${EVENT_ID:-paattukoottam-2026}"
LOCAL="$EVENTS_DIR/$EVENT_ID"
INTERVAL="${SYNC_INTERVAL:-30}"
FLAGS="--exclude event.db --exclude event.db-wal --exclude event.db-shm --exclude .tmp_* --exclude *.part --exclude incoming/** --transfers 4 --retries 3 --low-level-retries 5"

echo "[rclone-sync] $LOCAL <-> $RCLONE_REMOTE every ${INTERVAL}s"
mkdir -p "$LOCAL/incoming"

while true; do
  # Down: cloud inbox -> local incoming (moves, so each file is delivered exactly once)
  rclone move "$RCLONE_REMOTE/incoming" "$LOCAL/incoming" --exclude "*.part" --create-empty-src-dirs=false 2>/dev/null || true

  # Up: event folder -> cloud
  if [ -n "${RCLONE_TRASH:-}" ]; then
    # shellcheck disable=SC2086
    rclone sync "$LOCAL" "$RCLONE_REMOTE" $FLAGS --backup-dir "$RCLONE_TRASH/$(date +%Y%m%d-%H%M%S)" || echo "[rclone-sync] upload failed, will retry"
  else
    # shellcheck disable=SC2086
    rclone copy "$LOCAL" "$RCLONE_REMOTE" $FLAGS || echo "[rclone-sync] upload failed, will retry"
  fi
  sleep "$INTERVAL"
done
