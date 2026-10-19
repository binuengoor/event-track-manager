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

## Google Sheet users

`signups.xlsx` is a normal Excel file. To get a native Google Sheet instead, add
`--drive-import-formats xlsx` to the `FLAGS` line in `sync.sh`. Caveat: Google re-converts the file on every
upload, so it is a one-way overwrite and can look "changed" to rclone each cycle. Edit data in the app, not the sheet.
