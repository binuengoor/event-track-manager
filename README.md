# Event & Track Manager

A self-hosted manager for **any event with a stage, tracks, a sound console, or a potluck**: talent nights, karaoke and
video nights, concerts, competitions, rehearsals, community dinners. Run it with `docker compose up`. No cloud account,
API keys or Google services needed.

Built for **EMA Paattukoottam** (Exton Malayali Association) and designed to be re-skinned and re-ruled for any event
from the admin page in a couple of minutes.

<p align="center">
  <img src="docs/images/landing.jpg" alt="Landing page with countdown" width="860">
</p>

> [!IMPORTANT]
> **Design philosophy.** Performer-facing self-service (sign-up, edits, dish claims, track upload) is intentionally login-free for
> friends-and-neighbors events: anyone who knows a name can edit that entry. Administrative actions (settings, presets, roster,
> backups) need the **Admin PIN**; running the sound console can use a separate **Operator PIN**. Personal data (phone numbers,
> guardians) is never returned by public pages or APIs. See [Security & privacy](#security--privacy).

Event-day instructions: **[docs/RUNBOOK.md](docs/RUNBOOK.md)** · Design decision: **[docs/adr/0001-local-first-event-folder.md](docs/adr/0001-local-first-event-folder.md)**

---

## Three services

```
 app          the web app (sign-up, console, live, admin). Needs nothing else to run.
 downloader   YouTube/SoundCloud extractor: yt-dlp + ffmpeg + a JS solver. Required only for pasted links;
              file uploads work without it. yt-dlp upgrades itself on start and every 24 h (no rebuild).
 rclone-sync  OPTIONAL cloud mirror (profile "sync"). Without it, everything simply stays in ./events.
```

`docker compose up -d` starts `app` + `downloader`; add `--profile sync` for rclone. For YouTube "confirm you're not a bot" errors,
save a cookies export as `secrets/yt_cookies.txt` (mounted read-only into the downloader). Turn updates off with `YTDLP_AUTO_UPDATE=false`.
Why our own downloader image and not a stock one: YouTube needs ffmpeg plus a JavaScript challenge solver (deno), which no official
yt-dlp image bundles; ours installs upstream yt-dlp and keeps it current.

## One event, one folder

Everything the app stores lives in `./events/<event id>/`. Map one volume and you are done.

```
events/paattukoottam-2026/
  event.db          the database (source of truth, never published or synced live)
  signups.xlsx      generated automatically: Performances, Run Sheet, Potluck, Participants
  signups.csv       same data as CSV (+ potluck.csv)
  tracks/           backing tracks, named 02_PK-004_Maya_Nair_Kannalane.mp3  (tracks/_archive/ = replaced versions)
  incoming/         drop files here (or let rclone deliver them); anything named with an entry id attaches itself
  backups/          timestamped database snapshots (newest 30 kept)
  gallery/          sponsor images for the live screen
```

- **Drop-in tracks:** put `PK-004_anything.mp3` into `tracks/` or `incoming/` and act PK-004 shows as ready within seconds.
- **Reordering** renames the files to their new running-order numbers. Replacing a track archives the old one. Nothing is hard-deleted.
- **A new event** is a new folder (create it from `/admin`; the active one is remembered in `events/.active_event`). Archiving an event is zipping its folder.

## Cloud sync is optional and lives outside the app

The app never talks to Google or any cloud. If you want the folder mirrored (Google Drive, Dropbox, S3, a NAS...), start
the **rclone sidecar**: it uploads the folder (never the live `event.db`; snapshots in `backups/` instead) and pulls a cloud
`incoming/` inbox so organizers can drop tracks into Drive from their phones.

```bash
docker compose --profile sync run --rm --entrypoint rclone rclone-sync config   # one-time: create the remote
# in .env: RCLONE_REMOTE=gdrive:EventTrackManager/paattukoottam-2026
docker compose --profile sync up -d
```

Details and Google-Sheet conversion notes: [rclone/README.md](rclone/README.md).

## Screenshots

All screenshots are the real app with sample (fictional) data. The glow behind every page is the Gemini-style ambient aurora
(a WebGL shader with a CSS fallback), shown moving at the bottom.

| Public | |
|---|---|
| **Sign Up**: performer or potluck-only attendee<br><img src="docs/images/signup.jpg" width="420"> | **Performer Hub**: edit songs, upload tracks, pick a dish<br><img src="docs/images/performer-hub.jpg" width="420"> |
| **Live Program**: Now on Stage, Up Next, Upcoming (updates instantly)<br><img src="docs/images/live.jpg" width="420"> | **Dashboard**: setlist and potluck board<br><img src="docs/images/dashboard-food.jpg" width="420"> |

| Staff | |
|---|---|
| **Sound Console** (Admin or Operator PIN): cue, play, reorder, offline vault<br><img src="docs/images/console.jpg" width="420"> | **Admin**: event settings, rules, food, participants, exports<br><img src="docs/images/admin.jpg" width="420"> |
| **Presets with a change preview**<br><img src="docs/images/admin-presets.jpg" width="420"> | **Setup wizard**<br><img src="docs/images/admin-wizard.jpg" width="420"> |
| **Potluck quick add**: paste a menu, `x3` makes three slots<br><img src="docs/images/admin-food.jpg" width="420"> | **Event readiness**: what to fix before doors open<br><img src="docs/images/admin-readiness.jpg" width="420"> |
| **Spreadsheet viewer** with downloads (Excel, CSV, TSV, JSON, ZIP)<br><img src="docs/images/admin-sheet.jpg" width="420"> | **Payments**: who has paid, singers A to Z<br><img src="docs/images/admin-payments.jpg" width="420"> |
| **All events**: keep every event, clear media to free disk<br><img src="docs/images/admin-events.jpg" width="420"> | |

**Phone layout.** One compact menu, and tables become cards.

| Landing | Menu | Dashboard | Live | Sign Up |
|---|---|---|---|---|
| <img src="docs/images/m-landing.jpg" width="150"> | <img src="docs/images/m-menu.jpg" width="150"> | <img src="docs/images/m-dashboard.jpg" width="150"> | <img src="docs/images/m-live.jpg" width="150"> | <img src="docs/images/m-signup.jpg" width="150"> |

<p align="center"><img src="docs/images/aurora.gif" alt="Aurora background in motion (sped up)" width="300"><br><sub>The aurora in motion (sped up about 4x).</sub></p>

> To regenerate these images see [docs/RUNBOOK.md](docs/RUNBOOK.md#10-refreshing-the-readme-screenshots).

---

## Spreadsheet, payments and past events (all in `/admin`)

- **Spreadsheet tab:** a live, searchable view of the event's data, refreshed every time you open the admin page (which also rewrites `signups.xlsx`/CSVs in the event folder). Tabs follow the event type:
  a stage show gets **Songs**, **Singers** and **Run Sheet** (plus **Potluck** when potluck is on); a potluck-only event gets just **Potluck**.
  **Download** as Excel (all tabs), CSV, TSV, JSON (the current tab) or a ZIP of CSVs. Downloads are generated fresh from the database.
- **Payments tab** (stage events): every singer, **including duet and group partners**, A to Z, with a Paid checkbox, an optional note ("Zelle"), a
  Not paid / Paid filter, a progress bar and one **Save changes** button. Potluck-only guests are not listed. Paid status feeds the Singers sheet.
- **Events:** the bar at the top of `/admin` switches the **active event** (sign-up, console, live and every page follow immediately),
  creates a new one (copying rules, switches and the potluck menu from the current or any past event, never sign-ups, payments or tracks), and
  **Manage** lists every event with its acts, potluck, paid count and disk use. Each event keeps its own folder, database and exports forever.
- **Clear media** (per event, typed confirmation): deletes that event's audio/video to free disk space. Sign-ups, potluck, payments and settings stay;
  acts just show "no track" again. Do this after the event is over.

## Pick an event type (presets)

Open **Admin → Features & Presets** (or run the **setup wizard**, which also asks for the name, date, venue, potluck menu and
rules). Each preset shows exactly what it will change before you apply it. Presets never delete data.

| Preset | Use it for | Sign-up | Tracks | Console + live | Potluck | Rules it sets |
|---|---|---|---|---|---|---|
| **Full event** | Concert + dinner | on | audio + video | on | on | 2 songs, 1 solo |
| **Show, no potluck** | Stage show only | on | audio + video | on | off | 2 songs, 1 solo |
| **Potluck only** | Community dinner | off | off | off | on | none |
| **Acoustic / live band** | Live instruments | on | off | on | on | 2 songs |
| **Karaoke / video night** | Lyrics videos | on | audio + video | on | off | 4 songs |
| **Solo competition** | Judged solos | on | on | on | off | 1 song, solo only, dashboard hidden |
| **Rehearsal / sound check** | Console only | closed | on | console only | off | none |
| **Show-day freeze** | Lock it down | closed | closed | on | closed | none |

Everything is also an individual switch, and the rules are plain language: songs per person, solos, allowed track types
(audio / video / both), performance types, and age groups with guardian requirements.

**Potluck setup in seconds:** paste a menu into *Quick add* (`Appetizers:` starts a group, `Rice x3` makes Rice 1, 2, 3) or start
from a template (Indian, BBQ, Thanksgiving, simple). Existing items and claims are never changed.

## Pages

| Path | Audience | Purpose |
|---|---|---|
| `/` | Public | Landing: event info, countdown (and an "event ended" state) |
| `/signup` | Public | Register as performer (solo/duet/group) and/or claim a potluck dish |
| `/performer` | Public (by name) | Performer Hub: edit songs, upload audio/video or paste a YouTube link, pick a dish |
| `/dashboard` | Public | Read-only setlist and potluck board |
| `/live` | Venue screen | Now on Stage, Up Next, notes, sponsor gallery. Pushed instantly (server-sent events) |
| `/console` | Admin or Operator PIN | Queue, cue, waveform player, notes, reorder, status, offline vault, ZIP |
| `/console/stage-monitor` | Admin or Operator PIN | Video confidence monitor for the stage |
| `/admin` | Admin PIN | Event switcher, setup wizard, presets, readiness, rules, potluck, roster, **spreadsheet + downloads**, **payments**, exports, activity log |
| `/docs` | Public | OpenAPI reference |

## Quickstart

```bash
git clone https://github.com/binuengoor/event-track-manager.git
cd event-track-manager
cp .env.example .env            # set ADMIN_PIN (and optionally OPERATOR_PIN)
mkdir -p events && sudo chown -R 1000:1000 events    # Linux only: the app runs as uid 1000
docker compose up -d
```

Open <http://localhost:8088>. With no data yet, `/admin` opens the setup wizard.

Run from source:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r app/requirements-dev.txt
uvicorn app.main:app --port 8000          # data goes to ./events/<event id>/
```

Build locally: `docker compose -f docker-compose.local.yml up -d --build`. Pre-built multi-arch images publish to GHCR:
`ghcr.io/binuengoor/event-track-manager-app` and `...-downloader`.

## Architecture

```
 Browsers ──► app (FastAPI :8000) ──HTTP──► downloader (:8001  yt-dlp + ffmpeg)
                 │                              │ (hand-off through a scratch volume)
                 ▼
        ./events/<event id>/  ◄──── rclone sidecar (optional) ────► any cloud / NAS
        event.db · signups.xlsx · tracks/ · incoming/ · backups/
```

| Layer | Path | Role |
|---|---|---|
| Routers | `app/routers/` | HTTP only |
| Services | `app/services/` | `event_service` (queue, reconcile), `track_store`, `export_service`, `registration`, `admin`, `presets`, `readiness`, `live_broadcaster`, audio + workflow |
| Repositories | `app/repositories/` | SQLite access and schema migrations |
| Events | `app/events/` | In-process pub/sub (renames, deletes, debounced export) |
| Frontend | `app/static/` | Plain HTML + vanilla JS + Tailwind CDN, no build step |

The database is the source of truth; `signups.xlsx` is a one-way export. Edit data in the app, not in the spreadsheet.

## Configuration

Defaults work out of the box. `.env` / `config.yaml` seed the first boot, after which event details, flags and rules are edited live in `/admin`.

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_PIN` | `2026` | **Change it.** Opens `/admin`, `/console` |
| `OPERATOR_PIN` | off | Optional. Opens the sound console only (for a volunteer). Env only, never editable from the UI |
| `PORT` | `8088` | Host port |
| `EVENT_ID` | `paattukoottam-2026` | First event's folder under `EVENTS_DIR`. After that, switch events in `/admin` |
| `EVENTS_DIR` / `EVENT_DIR` | `/events` (Docker), `./events` | Parent folder of all events. `EVENT_DIR` pins ONE folder and turns event switching off |
| `APP_TITLE`, `APP_SUBTITLE`, `EVENT_START_TIME` (`MM-DD-YYYY HH:MMAM`), `EVENT_TIMEZONE`, `EVENT_VENUE`, `EVENT_TIME_RANGE`, `EVENT_POSTER_URL`, `EVENT_PAYMENT_URL`, `EVENT_GENERAL_NOTES` | see `.env.example` | Seed values |
| `ENTRY_ID_PREFIX` | `PK` | Entry ids (`PK-001`) appear in track file names |
| `MAX_UPLOAD_SIZE_MB` | `100` | Audio allowed at least 200 MB, video up to 500 MB |
| `AUDIO_BITRATE` | `320k` | Upload transcode target |
| `BACKUP_ENABLED`, `BACKUP_DEBOUNCE_SECONDS` | `true`, `10` | Export + snapshot a few seconds after the last change |
| `RCLONE_REMOTE`, `RCLONE_TRASH`, `SYNC_INTERVAL` | off | Optional sidecar, see [rclone/README.md](rclone/README.md) |
| `YTDLP_AUTO_UPDATE`, `YTDLP_UPDATE_HOURS` | `true`, `24` | Downloader keeps yt-dlp current without a rebuild |
| `CACHE_DIR` | `/data/cache` | Disposable scratch for conversion and the downloader hand-off |
| `DOWNLOADER_SERVICE_URL` | `http://downloader:8001` | |

## Key behaviors

- **Sign-up rules:** phone required (10+ digits); juniors need a guardian; songs per person and solos per person are configurable; unregistered duet partners need a phone.
- **Tracks:** MP3/WAV/M4A (transcoded to MP3), MP4 video (720p), or a YouTube/SoundCloud link (20 min max). Which types are accepted is an event rule. A song title must exist first.
- **Console safety:** a warning before anything that would cut live audio; cue state survives reloads; reordering is instant, **Save Order** renames files and refreshes the export; offline vault, per-track download and a numbered ZIP with a run sheet for USB playback.
- **Live screen:** updates the moment the sound operator cues, with a slow poll as a safety net.
- **Event readiness:** a checklist in `/admin` (default PIN, folder writable, disk space, ffmpeg, downloader, missing titles/tracks, unattached files).
- **Audit:** every sign-up, edit, rename, claim, upload and admin action goes to the activity log.

## Security & privacy

- Public pages and APIs never include phone numbers or guardian details; only admin endpoints return them. The exported files do contain them, so share the folder/remote only with organizers.
- Roles: **Admin PIN** (everything) and optional **Operator PIN** (sound console only; sees no phone numbers). Failed guesses are throttled (8 per client and 100 overall per 5 minutes, then HTTP 429). The PIN is never accepted in a URL; sessions use an HMAC cookie, not the PIN.
- `/data` serves poster and gallery images only: never tracks, exports, backups or the database.
- User-supplied text is escaped everywhere it is rendered. Spreadsheet exports neutralize formula injection.
- Use HTTPS in front (Caddy example in the runbook) and a non-default PIN. Do not commit `.env`, `secrets/` or `events/`.

## Upgrading from the Google Sheets/Drive version

On first start the app copies your database from the old `/db` volume (or the audio cache) into the new event folder, and copies cached tracks into
`tracks/`. Old copies stay in place until you delete them. Then: remove `GOOGLE_*` settings and `secrets/credentials.json` (YouTube cookies
`secrets/yt_cookies.txt` are still used by the downloader), map `./events:/events`, and optionally run the rclone sidecar to keep Drive in sync.

## Testing

```bash
pytest tests -q
```

The suite covers the API, privacy and security rules, the event folder (adoption, renames, archive, exports), presets and potluck tooling,
readiness, and the live stream. CI runs it on Python 3.11 and then publishes both images.

## License & community
Maintained for **EMA Paattukoottam** (Exton Malayali Association). Built with FastAPI, Tailwind CSS, WaveSurfer.js, SQLite, rclone and yt-dlp.
