# ADR 0001: Local-first event folder, no cloud API in the app

- Status: accepted and implemented
- Context owner: BP
- Supersedes: the Google Sheets + Drive integration (docs/archive/IMPLEMENTATION_PLAN_v5.md)

## Context
The app used Google Sheets as a sign-up mirror and Google Drive as the home of backing tracks. That meant a Google
Cloud project, a service account, API enablement and sharing, hard-coded sheet/folder ids, network calls on the stage
path (a Drive download could freeze every page), a "mock mode" for development, and a hard requirement that anyone
who just wants to run it on a home network create cloud credentials.

The goal is a customizable event manager for any event with tracks (audio or video), a console, or just a potluck,
that runs with `docker compose up` and nothing else.

## Decision
1. **One event folder is the only storage contract.** `<events>/<event id>/` holds `event.db` (SQLite, source of
   truth), `signups.xlsx` + `signups.csv` + `potluck.csv` (generated), `tracks/`, `incoming/`, `backups/`, `gallery/`.
2. **No cloud code in the app.** Removed the Google clients, the google libraries and mock mode.
3. **Cloud sync is a sidecar.** An optional `rclone` container (compose profile `sync`) mirrors the folder to any
   remote and pulls a remote `incoming/` inbox into the local one. The app never sees credentials.
4. **Tracks are matched to acts by entry id in the file name** (`02_PK-004_Maya_Nair_Kannalane.mp3`). Dropping a file
   into `tracks/` or `incoming/` attaches it; reordering renames files; replacing a track archives the old one to
   `tracks/_archive/`. Nothing is hard-deleted.
5. **SQLite stays the source of truth.** The xlsx is a one-way export, written atomically (temp file + rename) and
   debounced, so a sync tool never uploads a half-written file. Excel locks and concurrent edits cannot corrupt data.
6. **The live database is never synced.** `event.db*` is excluded from rclone; consistent snapshots in `backups/`
   (SQLite backup API, newest 30 kept) are synced instead.

## Consequences
- Good: zero-setup install, offline-capable, instant track attach, no blocking network IO on the stage path, one
  folder to back up, archive, move or clone, and the cloud provider is a deployment choice.
- Good: removes a class of failures (expired tokens, API quotas, folder sharing mistakes).
- Cost: organizers who edited the Google Sheet directly lose that (it was already one-way); they now edit in the app.
- Cost: the DB columns `drive_file_id` / `drive_file_name` keep their old names and now hold the track file name
  (kept to avoid a wide UI/API rename; a later cleanup can rename them).
- Migration: on first start the DB is copied from the old `/db` volume or the audio cache into the event folder,
  and tracks cached as `<entry>.mp3` are copied into `tracks/` (old copies are left in place).

## Alternatives considered
- Make `signups.xlsx` the source of truth: rejected (locking, partial writes, no transactions).
- Keep Google as an optional plugin: rejected (still needs credentials/testing surface; rclone covers it).
- Two-way `rclone bisync` for the whole folder: rejected as default (can delete data on mistakes). Up is
  copy-or-sync with an optional trash path; down is an explicit inbox.
