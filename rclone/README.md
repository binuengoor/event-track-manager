# rclone sync sidecar (optional)

The app never talks to Google (or any cloud). It only reads and writes the **event folder**
(`./events/<EVENT_ID>/`). This optional container mirrors that folder to any rclone remote
(Google Drive, Dropbox, OneDrive, S3, SFTP, a NAS...).

## 1. Create the remote once

```bash
docker compose --profile sync run --rm --entrypoint rclone rclone-sync config
```

Pick your provider and follow the prompts. The config is stored in `./rclone/rclone.conf`
(ignored by git). For Google Drive use a Shared Drive and your own OAuth client or a service account.

## 2. Tell the sidecar where to sync

In `.env`:

```env
RCLONE_REMOTE=gdrive:EventTrackManager/paattukoottam-2026
# optional: make uploads a true mirror; deleted/renamed files go here instead of vanishing
# RCLONE_TRASH=gdrive:EventTrackManager/_trash/paattukoottam-2026
SYNC_INTERVAL=30
```

> **One event at a time.** The sidecar mirrors `events/$EVENT_ID` only. It does not read `events/.active_event`, so creating or switching
> events in `/admin` does not move the sync. When you start a new event, set the new `EVENT_ID` and a new `RCLONE_REMOTE`
> (for example `gdrive:EventTrackManager/summer-talent-night-2027`) and run `docker compose --profile sync up -d` again.
> Past events stay on the remote untouched. Failures of the cloud-to-local `incoming/` pull are silent (`2>/dev/null || true`
> in `sync.sh`), so test it by dropping a file in the remote `incoming/` and watching it arrive.

## 3. Start it

```bash
docker compose --profile sync up -d
```

## What gets synced

| Direction | What |
|---|---|
| Up | `signups.xlsx`, `signups.csv`, `potluck.csv`, `tracks/`, `backups/` (database snapshots), `gallery/` |
| Never | `event.db` and its `-wal`/`-shm` files (use the snapshots in `backups/`) |
| Down | `<remote>/incoming/` -> local `incoming/`. Drop a file there named like `PK-004_anything.mp3` and the app attaches it to that act |

## Clear media and the cloud copy

**Clear media** in `/admin` deletes an event's audio/video from local disk only. With the default `copy` mode the remote keeps its copies,
so you can free the server and keep Drive as the archive. If `RCLONE_TRASH` is set (`sync` mode), the next upload moves the deleted
files into the trash path instead; still recoverable, but no longer in the main folder.

## Google Sheet users

`signups.xlsx` is a normal Excel file. To get a native Google Sheet instead, add
`--drive-import-formats xlsx` to the `FLAGS` line in `sync.sh`. Caveat: Google re-converts the file on every
upload, so it is a one-way overwrite and can look "changed" to rclone each cycle. Edit data in the app, not the sheet.
