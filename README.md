# Event & Track Manager

Self-hosted event system for community stage nights (built for **EMA Paattukoottam**, adaptable to any talent show, concert or potluck). It handles performer signup, potluck food signup, backing-track upload, a sound-operator console, and a public live schedule.

> [!IMPORTANT]
> **Design philosophy.** Performer-facing self-service (signup, edits, dish claims, track upload) is intentionally login-free for friends-and-neighbors events. Anyone who knows a name can edit that entry. Administrative actions (sequencing, cueing, settings, presets, backups, deletes) require the **Admin PIN**. Contributions must preserve this low-friction model, but must not expose personal data (phone numbers) publicly. See [Security & privacy](#security--privacy).

Operator instructions for event day: **[docs/RUNBOOK.md](docs/RUNBOOK.md)**.

---

## Pages

| Path | Audience | Purpose |
|---|---|---|
| `/` | Public | Landing page: event info, poster, countdown, links |
| `/signup` | Public | Register as performer (solo/duet/group) and/or claim a potluck dish |
| `/performer` | Public (by name) | Performer Hub: edit song/partner/notes, add a performance, upload audio/video track or YouTube URL, pick/change/release a dish. `/tracks`, `/upload`, `/intake` redirect here |
| `/dashboard` | Public | Read-only setlist board and potluck board (becomes "Food Board" for potluck-only events) |
| `/live` | Public / venue screen | Countdown, Now on Stage, Up Next, stage notes, sponsor gallery. Polls every 5 s |
| `/console` | Admin PIN | Sound console: queue, cue/uncue, waveform player, notes, drag-reorder, status, offline vault, ZIP export |
| `/console/stage-monitor` | Admin PIN | Stage confidence monitor for video backing tracks (`/stage-monitor` redirects) |
| `/admin` | Admin PIN | Event details, feature flags, presets, sign-up rules, food groups/items, participants roster, activity log, backups |
| `/docs` | Public | Auto-generated OpenAPI (Swagger) reference of every endpoint |

## Architecture

```
 Browsers ──► app (FastAPI :8000)  ──HTTP──► downloader (:8001: yt-dlp + ffmpeg + deno)
                │   │                              │
                │   └── SQLite (WAL) ◄── source of truth
                │         + audio cache  ◄── shared volume ──┘
                └── Google Sheets (export/backup)  +  Google Drive (Active/ & Archive/ tracks)
```

**Source of truth is the app's SQLite database.** Google Sheets is a *one-way export* (App → Sheet) used for backup and for organizers who like spreadsheets. Edits made directly in the Sheet are not read back. Drive's `Active/` folder is the ground truth for which backing tracks exist; the app reconciles against it every ~15 s.

Layers (`app/`):

| Layer | Path | Role |
|---|---|---|
| Routers | `routers/` | HTTP only: `pages, auth, event, signup, food, performer, dashboard, admin, stage, audio` |
| Services | `services/` | Business rules: registration, admin/presets, audio + workflow, stage/live status, backup, Google facade |
| Repositories | `repositories/` | SQLite access and schema/migrations: performances, participants, food, settings, audit |
| Events | `events/` | In-process pub/sub (`data.mutated`, `performer.renamed`, `performance.deleted`, …) for cascades and debounced backup |
| Config | `config.py`, `config.yaml`, `.env` | Defaults; seeded into the `app_settings` table on first boot, then editable live in `/admin` |
| Frontend | `static/` | Plain HTML + vanilla JS + Tailwind CDN. No build step |
| Downloader | `downloader/` | Separate container so yt-dlp can be updated without touching the stage app |

### Data model (SQLite, `event_data.db`)
`performances`, `participants` (canonical roster), `food_groups`, `food_items`, `food_signups` (one person per item, enforced `UNIQUE`), `app_settings`, `sync_meta` (active cue, dirty-sequence flag, last sync), `backup_log`, `activity_logs`. Schema migrates in place on startup.

### Configuration precedence
1. `app_settings` table (edited in `/admin`) wins at runtime.
2. Otherwise environment / `.env` → `config.yaml` → code defaults.

Infrastructure values (Google IDs, credentials, `ADMIN_PIN`, `PORT`, `CACHE_DIR`, `DOWNLOADER_SERVICE_URL`, `MOCK_GOOGLE_API`) require a restart; event/business rules apply instantly.

### Feature flags & presets
Flags: `stage_performances_enabled, signup_enabled, food_signup_enabled, track_upload_enabled, allow_duets, performer_edits_enabled, live_display_enabled, dashboard_enabled, console_enabled, payment_enabled`.
Presets (one click in `/admin`): `musical_night`, `acoustic` (no uploads), `competition` (solo only, no food, dashboard off), `potluck` (food only), `freeze` (lock signups/edits/food).

## Quickstart (local preview, no Google needed)

```bash
git clone https://github.com/binuengoor/event-track-manager.git
cd event-track-manager
cp .env.example .env          # set ADMIN_PIN to something other than 2026
MOCK_GOOGLE_API=true docker compose up -d
```

Open <http://localhost:8088>. With `MOCK_GOOGLE_API=true` (or no credentials file) Drive/Sheets calls are simulated.

Run from source without Docker:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r app/requirements-dev.txt
MOCK_GOOGLE_API=true uvicorn app.main:app --port 8000
```

Build images locally: `docker compose -f docker-compose.local.yml up -d --build`. Dev override with mock mode and live source mounts: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`.

Pre-built multi-arch images (amd64/arm64) publish to GHCR on every push to `main`: `ghcr.io/binuengoor/event-track-manager-app` and `...-downloader`.

## Google Workspace setup (production)

1. In Google Cloud Console create a project, enable **Google Sheets API** and **Google Drive API**.
2. Create a **Service Account**, add a JSON key, save as `secrets/credentials.json`.
3. Share the Google Sheet with the service-account email as **Editor**.
4. In a Shared Drive create `Active` and `Archive` folders; add the service account as Content Manager/Contributor.
5. Optional: create a backup folder for the `<event_id>_backup` sheet.
6. Put the full URLs in `.env`:

```env
GOOGLE_SHEET_URL="https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit"
GOOGLE_DRIVE_ACTIVE_FOLDER="https://drive.google.com/drive/folders/<ID>"
GOOGLE_DRIVE_ARCHIVE_FOLDER="https://drive.google.com/drive/folders/<ID>"
BACKUP_DRIVE_FOLDER="https://drive.google.com/drive/folders/<ID>"
```

Optional YouTube cookies (avoids bot checks): save as `secrets/yt_cookies.txt`.

Sheet columns are matched by header name (row 1), so reordering columns is safe. Override names with `COL_*` variables.

## Environment reference

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_PIN` | `2026` | **Change it.** Protects console and admin |
| `PORT` | `8088` | Host port mapped to the app |
| `MOCK_GOOGLE_API` | auto | `true` forces mock; auto-on if no credentials |
| `APP_TITLE`, `APP_SUBTITLE`, `EVENT_ID`, `EVENT_START_TIME` (`MM-DD-YYYY HH:MMAM`), `EVENT_TIMEZONE`, `EVENT_VENUE`, `EVENT_TIME_RANGE`, `EVENT_POSTER_URL`, `EVENT_PAYMENT_URL`, `EVENT_GENERAL_NOTES` | see `.env.example` | Seeded to `/admin` on first boot |
| `ENTRY_ID_PREFIX` | `PK` | Entry IDs like `PK-001` |
| `GOOGLE_SHEET_URL`, `SHEET_TAB_NAME`, `GOOGLE_DRIVE_ACTIVE_FOLDER`, `GOOGLE_DRIVE_ARCHIVE_FOLDER`, `BACKUP_DRIVE_FOLDER` | | URLs or raw IDs |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` / `GOOGLE_SERVICE_ACCOUNT_JSON` | `./secrets/credentials.json` | File path or raw JSON |
| `MAX_UPLOAD_SIZE_MB` | `100` | Audio uploads are allowed at least 200 MB; video up to 500 MB |
| `AUDIO_BITRATE` | `320k` | Upload transcode target |
| `BACKUP_ENABLED`, `BACKUP_DEBOUNCE_SECONDS` | `true`, `10` | Backup runs 10 s after the last change |
| `FOOD_SIGNUP_ENABLED`, `SIGNUP_ENABLED`, `FOOD_SERVING_NOTE` | | Seed defaults |
| `LIVE_ORDER_BY` | `readiness,sequence` | Also `age_group`, `performance_type` |
| `CONSOLE_EXTRA_COLUMNS` | `Age Group` | Sheet columns shown as tags |
| `CACHE_DIR`, `GALLERY_DIR`, `DATA_DIR` | `/data/...` | Cache/DB and sponsor gallery paths |
| `DOWNLOADER_SERVICE_URL` | `http://downloader:8001` | |

## Key behaviors

- **Signup rules:** phone required (10+ digits); juniors require guardian name+phone; max performances and max solos per person are configurable; duet partners not yet registered need a phone.
- **Tracks:** upload MP3/WAV/M4A (transcoded to MP3) or MP4 video (720p), or paste a YouTube/SoundCloud URL (20 min max). Song title must exist first. Files go to Drive `Active/`; replaced files move to `Archive/`.
- **Stage eligibility:** acts are cued as "ready" if Acoustic/Live, Group, or a track exists.
- **Console safety:** warning modal before anything that would cut live audio; cue state survives reload; reordering is local and instant, then **Sync to Sheet** pushes order to the Sheet and renames Drive files.
- **Offline resilience:** per-track cache in the browser (IndexedDB + service worker), bulk ZIP with run sheet, single-track download.
- **Audit:** every signup/edit/rename/claim/upload/admin action is written to the activity log (`/admin` → Activity Log).

## Security & privacy

- Public pages and APIs must **never** include phone numbers or guardian details; only the admin roster/participants endpoints return them.
- Admin endpoints require the PIN via `X-Admin-PIN` header or the `admin_pin` cookie set by `/api/auth/login`. Failed logins are rate-limited per client.
- Run behind HTTPS (Caddy example in the runbook) and use a non-default PIN.
- Do not commit `.env`, `secrets/`, or `data/`.

## Testing

```bash
MOCK_GOOGLE_API=true pytest tests -q
```

CI (`.github/workflows/docker-publish.yml`) runs the suite on Python 3.11, then builds and publishes both images. The suite runs in mock mode only; the real Google clients are verified manually (see runbook pre-event checklist).

## Troubleshooting

See the runbook's troubleshooting table (downloader blocked by YouTube, Sheet not updating, backup failing, stale audio, forgotten PIN).

## License & community
Maintained for **EMA Paattukoottam** (Exton Malayali Association). Built with FastAPI, Tailwind CSS, WaveSurfer.js, SQLite and yt-dlp.
