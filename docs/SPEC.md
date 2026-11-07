# Event & Track Manager: Specification

Status: draft 1, 2026-11-07. Written against commit `aa07405` (code unchanged since `2fc83ae`).
Owner: BP. Audience: the owner (non-coder), any developer or AI agent who will change the app.

## How to read this document

| Tag | Meaning |
|---|---|
| **[C]** | **Current behaviour.** Read in the code at the commit above. |
| **[V]** | Current behaviour that was also **run** (live app or `TestClient`) while writing this spec. |
| **[T]** | **Target / proposed.** A decision or plan, not yet built. |

Rules used throughout: everything tagged [C] or [V] describes what the code does today, including its flaws. Everything
tagged [T] is a recommendation until the owner accepts it. Cloud sync (rclone) is **out of scope**: the owner runs it
outside the app, and this spec only records what the app does and does not provide for it.

Contents: 1 Purpose and users · 2 Domain model · 3 Functional spec · 4 Non-functional · 5 Known gaps · 6 Target architecture
and design plan · 7 Open questions · Appendices (sources, verification log, external plan review).

---

## 1. Purpose, users and the three areas

### 1.1 Purpose [C]

A self-hosted web app for any event with a stage, backing tracks, a sound console or a potluck (talent night, karaoke, concert,
competition, rehearsal, community dinner). One Docker Compose stack, no cloud account. Built for EMA Paattukoottam; meant to be
re-skinned and re-ruled for other events from the admin page.

### 1.2 People and roles [C]

| Role | Who | How they get in | What they can do |
|---|---|---|---|
| Guest (public) | Performers, families, potluck attendees | Nothing. No login. | Sign up, edit own entries (by name or entry id), claim a dish, upload a track, view setlist, potluck board and live screen |
| Operator | Volunteer sound operator | `OPERATOR_PIN` (env only) | Everything in the console: cue, play, status, notes, reorder, Save Order, downloads, ZIP. Sees no phone numbers. |
| Admin | Organizer | `ADMIN_PIN` | Everything, including settings, presets, roster, payments, exports, events, clear media |

Design philosophy [C]: performer-facing self-service is intentionally login-free for friends-and-neighbours events. Anyone who
knows a name (or an entry id such as `PK-004`) can change that entry. Privacy is protected by never returning phone numbers or
guardian details from public endpoints.

### 1.3 The three areas

| Area | Pages today [C] | Primary device and network assumption today [C] | Target assumption [T] |
|---|---|---|---|
| **1. Public / guest** | `/` landing, `/signup`, `/performer` (Performer Hub), `/dashboard`, `/live` (venue screen) | Phones for guests; a large screen for `/live`. Assumes **internet in the browser** (CDN scripts). | Phone first, works on a LAN with no internet, one-handed, 44 px targets |
| **2. Console / operator** | `/console` (sound console), `/console/stage-monitor` (video confidence monitor) | One laptop (Chromium-class browser: IndexedDB, BroadcastChannel, service worker), flaky venue Wi-Fi. Stage monitor is a second window **in the same browser** on an HDMI display. | Laptop or tablet, dark, dense, offline-tolerant, no accidental clicks |
| **3. Admin** | `/admin` (10 tabs, event bar, setup wizard, readiness strip) | Desktop browser; phone works but is cramped | Desktop first, responsive; 5 grouped destinations |

Note [C]: `/live` is public but is used as a venue display; it is listed with the public pages because it needs no PIN.
The stage monitor is not networked: it receives cue/play/seek messages from the console through `BroadcastChannel`
(`stage_monitor_channel`), which only works between windows of the same browser profile on the same machine [C].

---

## 2. Domain model

### 2.1 Storage layout [V]

```
events/                              the one mapped volume (EVENTS_DIR; /events in Docker)
  .active_event                      text file: id of the active event (written atomically on switch)
  <event-id>/                        one folder per event; the folder IS the event
    event.db (+ -wal, -shm)          SQLite, WAL mode: the source of truth for everything except media
    signups.xlsx signups.csv singers.csv potluck.csv     generated exports (atomic temp+rename, mode 0600)
    tracks/                          backing tracks; tracks/_archive/ holds replaced or deleted versions
    incoming/                        drop-in inbox; files whose name carries a known entry id are adopted
    backups/                         event_<timestamp>.db snapshots (SQLite backup API); newest 30 kept
    gallery/                         sponsor images for the live screen (served as /data/gallery/<file>)
    <poster file>                    optional poster image placed in the event folder root (served as /data/<file>)
cache dir (CACHE_DIR, /data/cache)   disposable scratch shared by app and downloader (not per event)
```

- **No central database [C].** Nothing in any database links events together. `.active_event` is the only global state.
- `EVENT_DIR` (or `TRACKS_DIR`) pins one folder and turns event switching off [C].
- The app refuses to start if the event folder is not writable; it does not fall back silently [C].

### 2.2 Event lifecycle [C][V]

| Action | Behaviour |
|---|---|
| First start | `EVENT_ID` (default `paattukoottam-2026`) becomes the first folder. Schema created, settings seeded from env/`config.yaml`, 30-item potluck menu seeded from `config.yaml` once (`sync_meta.food_seeded`). |
| Create event (`POST /api/admin/events`) | New folder + database. `copy_from`: `current`, `none`, or another event id. Copies **settings that are not event-specific** and the potluck **menu** (groups and items), never sign-ups, payments or tracks. Resets name/date/venue/poster/notes, `setup_completed=false`. Id is a slug of the name (`-2`, `-3` on clash). Activates it unless `activate=false`. |
| Activate (`POST .../activate`) | Writes `.active_event`, re-points settings/paths, resets per-event runtime state (reconcile timer, export throttle, live digest, connections), re-runs bootstrap (schema, default settings, reconcile, export). No restart. Logs an activity row. |
| List (`GET /api/admin/events`) | Scans the events folder; per event: name, start time, acts, participants, potluck taken/total, paid, media bytes/files, last activity, active flag. |
| Clear media (`POST .../clear-media`) | Admin types the event id to confirm. Deletes audio/video in `tracks/` (including `_archive/`) and `incoming/`, nulls track fields in that event's database (`Acoustic` stays). Keeps every other record. |
| Archive | Zip the folder (manual). |

Entry ids repeat across events (`PK-001` in each). That is safe because tracks are only looked up in the active event's folder [C].
Single worker only: the active event lives in one process [C].

### 2.3 Database tables (per event) [C]

SQLite, WAL, `busy_timeout=5000`, `foreign_keys=ON`. Created and "migrated" by `ensure_database()` (create-if-missing plus
try/except `ALTER TABLE ADD COLUMN`; there is no schema version number).

**`performances`** (one row per act; the entry id is the primary key)

| Column | Notes |
|---|---|
| `entry_id` PK | `<prefix>-NNN`, prefix from setting `entry_id_prefix` (default `PK`). Next number = highest existing + 1 (so deleting the highest id lets it be reused) [V]. |
| `performer_name`, `performance_type` | Type default `Solo`; allowed values come from setting `performance_types` (not enforced on public edit [V]). |
| `partner_name`, `partner_age_group`, `partner_phone` | Duet/group partner(s); `partner_name` can hold several names ("A & B", "A, B"). |
| `contact_info` | The performer's phone. **Private.** |
| `age_group`, `guardian_name`, `guardian_phone` | Guardian fields are **private**. `extra_tags_json` stores `[age_group, "Partner:<age>"]`. |
| `song_title`, `movie_name`, `is_song_name_missing` | Placeholder titles ("TBD", "test", "song 2", ...) count as missing. |
| `sequence_order`, `row_index` | Running order (new act = max + 1); `row_index` is a legacy tie-break, always 0 for new rows. |
| `performance_status` | `Upcoming`, `On Stage`, `Performed`, `On Hold` (input aliases: Done, Skipped, Live, Reset, Uploaded are normalized). |
| `track_status` | `Pending`, `Uploaded`, `Acoustic` (set by reconcile or the performer). |
| `duration`, `media_type` | `mm:ss` from the file; `audio` or `video`. |
| `drive_file_name`, `drive_file_id` | **Legacy names.** File name in `tracks/`, and a content version `v<size>-<mtime>` that survives renumbering. |
| `stage_notes` | Shown on the live screen (public). |
| `created_via` | `signup_portal`, `performer_hub`, legacy default `'sheet'`. |
| `participant_id`, `last_updated` | Link to `participants`; ISO timestamp. |

**`participants`** (canonical people; unique by name, case-insensitive match): `participant_id` (`pt_xxxxxxxx`), `name` UNIQUE, `phone`,
`age_group` (default `Senior`), `guardian_name`, `guardian_phone`, `created_at`, `updated_at`, `paid`, `paid_at`, `payment_note`.
Created on demand when an act or dish is created; two different people with the same name are the same participant.

**`food_groups`** (`group_id`, `name` UNIQUE, `display_order`) and **`food_items`** (`item_id`, `name` UNIQUE across all groups,
`group_id`, `display_order`): the potluck menu. **`food_signups`**: `signup_id`, `item_id` UNIQUE (one person per slot), `signer_name`,
`dish_description`, `signer_phone` (private), `participant_id`, timestamps. A person may hold several slots.

**`app_settings`** (`key`, `value` JSON/text, `updated_at`): runtime settings, per event. **`sync_meta`** (`key`, `value`): internal
state: `food_seeded`, `last_synced_at`, `sequence_dirty`, `active_entry_id` (the cued act). **`backup_log`**: export history
(`status` is `pending`, `success` or `failed`). **`activity_logs`**: audit trail (`log_id`, `timestamp`, `action_type`,
`performer_name`, `entry_id`, `summary`, `details` JSON, `source`). Details can contain phone numbers (food-only sign-ups store the
phone; sign-ups store the whole request) and are admin-only.

### 2.4 How files tie to acts [C][V]

1. The link is the **entry id token in the file name**: `02_PK-004_Maya_Nair_Kannalane.mp3` belongs to `PK-004`. Tokens are split on `_`
   and matched with `[A-Za-z0-9]+-\d+`. Newest file (by mtime) wins if several match.
2. **Reconcile** (`reconcile_tracks`, at most every 3 s, triggered by reads of the performance list; forced at start, on event
   switch, on `/api/sync`): adopt eligible files from `incoming/` into `tracks/` (skips `.part`, empty, or files modified in the
   last 3 s); for each act with a file set `track_status` to `Uploaded` (or keep `Acoustic`), `drive_file_name`, `drive_file_id`
   (version), `media_type`, duration; for an act whose file is gone and that was `Uploaded` reset to `Pending`.
   **The folder wins for tracks.** Verified: a file dropped in `incoming/` was attached within about 4 s.
3. **Save Order** renames files to `NN_<id>_<Performer>_<Song>.<ext>` (`NN` = sequence) and rewrites the exports. Dragging rows in
   the console only changes `sequence_order` (and sets `sequence_dirty`).
4. **Replace** archives the previous file to `tracks/_archive/<name>_archived_<timestamp>.<ext>`. Deleting an act archives its track.
   Nothing is hard-deleted except by Clear media.
5. A file name without a known entry id stays in `incoming/` forever (readiness warns).

### 2.5 Settings model [C]

Reads go to the event's `app_settings` first, then the config/env default (`get_setting`). `.env` / `config.yaml` only seed the
first boot of each new event. Validation (`AdminService._validate_settings`) rejects unknown keys and wrong types.

| Group | Keys |
|---|---|
| Feature switches (bool) | `stage_performances_enabled`, `signup_enabled`, `food_signup_enabled`, `track_upload_enabled`, `allow_duets`, `performer_edits_enabled`, `live_display_enabled`, `dashboard_enabled`, `console_enabled`, `payment_enabled`, plus `backup_enabled`, `setup_completed` |
| Rules | `max_performances_per_participant` (1-20), `max_solo_per_participant` (0-20), `performance_types` (list), `age_groups` (list of `{name, requires_guardian}`), `allowed_media` (`audio`, `video` or both) |
| Event text | `header_brand_title` (35), `header_brand_subtitle` (45), `event_name` (60), `event_subtitle` (80), `event_date_time` / `event_start_time` (`MM-DD-YYYY HH:MMAM`), `event_venue`, `event_time_range`, `general_notes` (markdown), `hero_tag_primary`, `hero_tag_status`, `event_poster_url`, `payment_url`, `signup_sheet_url` (an external link, not an integration) |
| Other | `food_serving_note`, `entry_id_prefix`, `live_order_by` (default `readiness,sequence`), `console_extra_columns`, `event_id`, `venue`, `time_range`, `active_preset` |
| Env only | `ADMIN_PIN`, `OPERATOR_PIN`, `PORT`, `EVENTS_DIR`/`EVENT_DIR`/`TRACKS_DIR`/`GALLERY_DIR`/`DATA_DIR`, `CACHE_DIR`, `MAX_UPLOAD_SIZE_MB`, `AUDIO_BITRATE`, `DOWNLOADER_SERVICE_URL`, `BACKUP_*`, `YTDLP_*`, `CONFIG_PATH`, `RUNTIME_ENV` |

`.env` is read by a small built-in loader that does not override real environment variables [C].

### 2.6 Privacy classification [C][V]

Private keys (`app/privacy.py`): `contact_info`, `guardian_name`, `guardian_phone`, `partner_phone`, `signer_phone`, `phone`.
`strip_private` removes them from public responses. Verified with a junior duet sign-up (performer, guardian and partner phones) and a cued act: `/api/performances`, `/api/stage-queue`,
`/api/live-status`, `/api/dashboard/performances`, `/api/dashboard/food`, `/api/performer/profile` (as performer and as partner), `/api/signup/config`,
`/api/event-info` and `/api/track-info/{id}` contained none of the three phone numbers (response text searched).
`/api/performances` and `/api/stage-queue` keep the **keys** with blank or null values because the response model refills them [V].

---

## 3. Functional specification

### 3.1 Authentication and roles [C]

| Mechanism | Detail |
|---|---|
| Login | `POST /api/auth/login {pin}` -> sets cookie `admin_session` or `operator_session` (`HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS or `x-forwarded-proto: https`, 24 h `max_age`). Value = HMAC-SHA256 of a fixed string keyed with the PIN. |
| Per-request | Role is the PIN in header `X-Admin-PIN`, or a valid cookie. `admin` > `operator` > none. If `OPERATOR_PIN` equals `ADMIN_PIN` it is ignored. |
| Failures | 401 unknown, 403 operator on an admin-only route, 429 after 8 failures per client or 100 overall within 300 s. Client key = first `X-Forwarded-For` value, else socket address. |
| Console client | Stores the **raw PIN in `localStorage`** (`paattukoottam_pin`) and sends it as `X-Admin-PIN` on every request (this is what lets it reload offline). The admin page relies on the cookie only. |

### 3.2 Pages

Common to all pages [C]: dark theme only (`color-scheme: dark`, black background), Tailwind + Lucide from CDNs, shared `nav.js`
header, shared `utils.js`, optional WebGL "aurora" background with CSS fallback (respects reduced motion), meta tag
`view-transition` (no `@view-transition` CSS rule exists, so transitions are probably inactive: not verified in a browser).
Server serves each HTML with `no-store` and appends a cache-busting `?v=<timestamp>` to the page's main JS file.

| Path | Audience | Purpose and behaviour [C] | Gated by |
|---|---|---|---|
| `/` | Public | Event name, subtitle, poster, venue, time, countdown, "event ended" state, markdown general notes, links to sign-up, payment (if enabled) and external sheet link. Data from `/api/event-info`. | none |
| `/signup` | Public | Two registration types: performer (solo/duet/group, one or more songs, age group, guardian, optional dish, "acoustic/no track" flag) or food-only attendee. Loads `/api/signup/config` (rules, age groups, menu, registered names, existing songs). Shows a success card with entry ids and the payment link. | `signup_enabled` (stage), `food_signup_enabled` (food); closed message if both off |
| `/performer` (also `/tracks`, `/upload`, `/intake`) | Public, identified by name | Performer Hub: pick your name from the registered list, see your acts, edit song/movie/partner/notes/type, add another act (within limits), rename yourself, upload a file or paste a YouTube/SoundCloud link per act (audio or video as allowed), see track readiness, claim/change/release a potluck dish, browse everyone else's songs. Relabelled "Attendee Hub" when stage is off. | `performer_edits_enabled`, `track_upload_enabled`, `food_signup_enabled`, `allow_duets`, `stage_performances_enabled` |
| `/dashboard` | Public | Read-only setlist (sequence, performer, song, type, status, has-track) and potluck board (groups, taken/open, serving note). Relabelled "Food Board" when stage is off. | `dashboard_enabled` (setlist returns `[]` when off); `food_signup_enabled` for the board |
| `/live` | Public (venue display) | Countdown before start; then Now on Stage, Up Next (max 2 ready acts), upcoming, performed, on hold, stage notes, sponsor gallery (70/30 split). Updates on server push with a slow poll as safety net. Shows an "inactive" card when off. | `live_display_enabled` |
| `/console` | Admin or Operator PIN | See 3.5. | `console_enabled` (actions return 403 when off; page shows "Sound Console Inactive") |
| `/console/stage-monitor` | Same browser as the console | Full-screen, muted video confidence monitor driven by `BroadcastChannel`. Shows standby card, performer, song, type, time, sync status. Forces `muted` and `volume=0`. | none (no server call) |
| `/admin` | Admin PIN | See 3.7. | none |
| `/docs`, `/openapi.json` | Public | FastAPI OpenAPI reference. | none |
| `/sw.js` | Browser | Service worker, served from the root with `Service-Worker-Allowed: /`. Registered **only by the console**. | none |
| `/static/*` | Public | JS/CSS (`no-cache`, revalidated). | none |
| `/data/<file>` | Public | Image files (`.png .jpg .jpeg .gif .webp .svg .ico`) from the **active event folder** only; never `tracks`, `incoming`, `backups`, `cache`, `db`, `secrets`; no `..`. | none |

Navigation today [C]: `nav.js` renders one header on every page: public pills (Home, Sign Up, Performer Hub, Dashboard, Live
Program) plus staff pills (Console, Admin), on a phone one menu button opening a grid sheet. `adaptNavigationForEventConfig`
(in `utils.js`, called by landing, console, dashboard, performer hub and sign-up) relabels Performer Hub to Attendee Hub and
Dashboard to Food Board for potluck-only events and dims (does not hide) the Console and Live links when those features are off.
Staff links are visible to everyone. `live`, `admin` and `stage-monitor` do not call the adapter.

### 3.3 Sign-up and edit rules [C][V]

| Rule | Behaviour |
|---|---|
| Open/closed | Both `signup_enabled` and `food_signup_enabled` off -> "sign-ups are closed". Stage off -> only food-only registration works. |
| Phone | At least 10 digits (formatting ignored). Required for the performer, or for a guardian when the age group `requires_guardian` (then the performer's own phone defaults to the guardian's). Unregistered duet partners need a phone. |
| Guardian | Age groups come from `age_groups`; a group with `requires_guardian` demands guardian name and phone. Default groups: Junior (guardian required), Senior. |
| Limits | `max_performances_per_participant` and `max_solo_per_participant` count acts where the person is performer **or partner**. Exceeding returns 400. |
| Duets | `allow_duets` off -> solo only, no partner names. Duet needs a partner name; partner is matched by name to registered performers. |
| Food | Needs the item id; one person per slot (409 if taken). In performer sign-up a failed dish claim is logged and ignored, the sign-up still succeeds. |
| Entry ids | Allocated on creation; shown to the performer. |
| Placeholder titles | Count as "song title missing"; uploads are refused until a real title exists. |
| Public edit | `PUT /api/signup/performance/{entry_id}` needs only the entry id. Blank phone/guardian fields mean "unchanged". It does **not** re-check limits, duet rules or the allowed `performance_type` list, and accepts any `track_status` string [V]. Locked when `performer_edits_enabled` is off. |
| Rename | `PUT /api/performer/rename` renames across participants, acts (performer and partner) and dish claims; refused if the new name already exists on another performer. |
| Identity | Name strings. `/api/performer/profile?name=` matches exactly (case-insensitive) on performer or partner name; guardian dish claims count for juniors. Name matching helpers (`names_match`) tolerate first-name-only and parenthetical aliases for potluck display. |

### 3.4 Track upload and YouTube flow [C]

```
Browser --multipart--> POST /api/upload (public) --1 MB chunks--> CACHE_DIR/<id>.incoming_<pid>
   limit: video 500 MB; audio max(MAX_UPLOAD_SIZE_MB, 200) MB; refused (413) as soon as exceeded
   -> checks: track_upload_enabled, allowed_media, act exists, real song title
   -> file: ffmpeg to MP3 (AUDIO_BITRATE, default 320k) or MP4 720p H.264 (audio stream copied, AAC fallback)
            if conversion fails the original is kept
   -> link: app calls downloader  POST /api/extract {url, entry_id, media_type}  (HTTP, 120 s timeout)
            downloader (yt-dlp + ffmpeg + deno) writes CACHE_DIR/<id>.mp3|mp4 (shared volume hand-off)
   -> verify with mutagen: playable, duration > 0 (else discard, 400)
   -> track_store.save: archive previous, copy to tracks/<canonical name>.part then rename
   -> update act: Uploaded, version, file name, duration, media type; activity log; trigger export; prune scratch
```

Downloader limits [C]: hosts allowed are YouTube (incl. `m.`, `music.`, `youtu.be`) and SoundCloud only; URL scheme http(s); playlists and
radio params stripped; live streams refused; duration over 20 min refused; at most 2 concurrent extractions (a third waits 60 s then
503); optional cookies file (`secrets/yt_cookies.txt`) for bot checks; video up to 720p. `start.sh` upgrades yt-dlp at start and every
`YTDLP_UPDATE_HOURS` (24) and restarts the API if the version changed; a failed upgrade keeps the previous version.
Error mapping: downloader errors -> 422 with a friendly message; bot detection message asks for a file upload.

Streaming and download [C]: `GET /api/stream/{id}` (public, HTTP range supported, `audio/mpeg` unless the file ends in `.mp4`),
`GET /api/track-info/{id}` (public), `GET /api/download-track/{id}` (operator), ZIPs (operator).

### 3.5 Sound console (`/console`) [C]

| Feature | Behaviour |
|---|---|
| Sign-in | PIN modal; admin or operator PIN. Raw PIN kept in `localStorage`. |
| Queue | List of acts in running order with search/filter, status pills, track readiness, type pills, optional extra columns (`console_extra_columns`), cached copy in `localStorage` for offline reload. Refreshes every 45 s when online and the order is not dirty. |
| Cue | Click an act or press `Down` (next ready act): loads it into the player **without autoplay**; the cued id is stored server-side (`active_entry_id`) and in `localStorage`, so a reload restores it. Uncue returns the act to `Upcoming`. |
| Player | WaveSurfer waveform (audio) or video preview; play/pause (`Space`), seek +-5 s (`Left`/`Right`), mute (`M`), mark performed or restore (`Enter`), download current track. |
| Safety | A disruption modal appears before any action that would stop live audio (skip, mark done, cue another, uncue). |
| Status | Upcoming / On Stage / Performed / On Hold via `PATCH /api/status/{id}`; stage notes via `PATCH /api/performance-notes/{id}` (shown live). |
| Reorder | Drag rows; `POST /api/reorder-queue` stores the order (dirty badge). **Save Order** (`POST /api/push-sequence`) renames files and rewrites exports. |
| Offline vault | Browser IndexedDB: "Cache All Offline", per-track cache, clear cache, vault status. Version key = `drive_file_id`, so renumbering does not invalidate it. |
| Offline actions | Status/notes/cue changes made while offline are queued in `localStorage` and replayed on reconnect; a network indicator is shown. |
| USB fallback | "Offline ZIP": numbered tracks plus `00_Show_Run_Sheet.txt` (`/api/export-zip` and two aliases). |
| Stage monitor | Pop-out window kept in sync over `BroadcastChannel` (CUE, PLAY, PAUSE, SEEK, UNCUE, SYNC). |
| Service worker | Pre-caches `/console`, `admin.html`, `style.css`, `admin.js` and the three CDN scripts at install; network-first for later GETs with cache fallback; offline navigations fall back to `/console`. Never intercepts `/api/`. |

### 3.6 Live screen and push [C]

`GET /api/live-stream` (SSE) emits `retry: 3000`, the current version number, then a new number only when the redacted live state
changes; keep-alive comment every 15 s. One shared background task checks once per second while any client is connected. On a
message `/live` fetches `GET /api/live-status` (ETag, 304 when unchanged, `max-age=1`). `/live` also polls (20 s default, adaptive) as a
safety net. Live state: `now_performing` (the cued act), `up_next` (up to 2 acts that are **eligible**), `upcoming` (sorted by
`live_order_by`: `readiness`, `age_group`, `sequence`, `performance_type`), `performed`, `on_hold`, counts, `is_dirty`, gallery images.
Eligible = has a track (`Uploaded` or a stored file id), or is Acoustic/live/no-track, or is a Group act that is not karaoke [C].

### 3.7 Admin (`/admin`) [C]

Top: **event bar** (switch active event, create event, Manage list with disk use and Clear media), **readiness strip**
(refreshes every 60 s), **setup wizard** (auto-opens when the event has no sign-ups or claims and `setup_completed` is false;
steps: type, basics, potluck menu (only for presets with food), rules (not for potluck-only), review/done; session-dismissible).

| Tab | Content |
|---|---|
| Event Details | Branding, name, subtitle, date/time, venue, time range, poster, notes (markdown), payment URL, external sheet URL |
| Sign-Up Rules | Songs per person, solos, performance types, allowed track types, age groups with guardian flag |
| Features & Presets | All switches individually, plus 8 presets with a change preview |
| Food & Potluck | Groups and items (add, rename, move, reorder, delete with force), claims (edit, release), serving note, on/off, quick add (paste a menu, `Group:` headers, `Item x3`), 4 templates (indian, bbq, thanksgiving, simple) |
| Participants | Every act with food, edit fields, delete (archives the track), link a dish |
| Spreadsheet | Live tables (Songs, Singers, Run Sheet, Potluck as the event type allows), search, downloads (xlsx all tabs, csv/tsv/json current tab, zip of csv) |
| Payments | Singers A-Z (performers and partners; not potluck-only guests) with Paid checkbox and note, filter, progress bar, one Save |
| Stats | Participant and act counts (juniors, seniors, solo/duet/group, dishes) |
| Backup & Sync | Export now, last export, history, backup on/off. (UI copy still says "Automated Cloud Backup & One-Way Sync" although the app has no cloud code.) |
| Activity | Audit log with days, search and action filters |

### 3.8 Presets [C]

Applying a preset writes its flags and rules to the active event, sets `active_preset`, logs the change list and never deletes data.
The admin UI shows a diff (old -> new) before applying. Flag order: stage performances (SP), sign-up (SU), potluck (FO), track upload
(UP), duets (DU), performer edits (ED), live screen (LV), dashboard (DB), console (CO), payment (PA).

| Preset (id) | SP | SU | FO | UP | DU | ED | LV | DB | CO | PA | Rules set |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Full event (`musical_night`) | on | on | on | on | on | on | on | on | on | on | 2 songs, 1 solo, Solo/Duet/Group, audio+video |
| Show, no potluck (`show_no_potluck`) | on | on | off | on | on | on | on | on | on | on | same as Full |
| Potluck only (`potluck`) | off | off | on | off | off | off | off | on | off | off | none |
| Acoustic / live band (`acoustic`) | on | on | on | off | on | on | on | on | on | on | 2 songs, 2 solo |
| Karaoke / video night (`karaoke_video`) | on | on | off | on | on | on | on | on | on | off | 4 songs, 4 solo, audio+video |
| Solo competition (`competition`) | on | on | off | on | off | on | on | off | on | on | 1 song, 1 solo, types [Solo], audio+video |
| Rehearsal / sound check (`rehearsal`) | on | off | off | on | on | on | off | off | on | off | none |
| Show-day freeze (`freeze`) | unchanged | off | off | off | unchanged | off | unchanged | unchanged | on | unchanged | none |

### 3.9 Readiness checks [C][V]

| Check id | Rule |
|---|---|
| `pin` | WARN while `ADMIN_PIN` is `2026`; OK otherwise (notes if no `OPERATOR_PIN`) |
| `storage` | write probe in the event folder; ERROR if it fails |
| `disk` | ERROR under 1 GB free, WARN under 5 GB |
| `ffmpeg` | ERROR if not installed |
| `downloader` | WARN if the downloader is unreachable; shows the yt-dlp version and cookie status |
| `songs`, `tracks` | WARN listing acts without a title or without a track (skipped when stage is off or uploads are off) |
| `backup` | **Intended** to ERROR on a failed export. **Bug:** it compares the status with `"error"` while the log stores `"failed"`, so a failed export still shows OK with the last completion time [V]. |
| `incoming` | WARN if files wait in `incoming/` |
| `wizard` | INFO until the wizard is completed |

### 3.10 Exports and downloads [C][V]

One table builder (`datasets.build_datasets`) feeds the admin viewer, the files in the event folder and every download.
Tables follow the event type: stage events get Songs, Singers (with Paid) and Run Sheet; potluck on adds Potluck; potluck-only has just Potluck.
Files are rewritten atomically on every change (debounced `BACKUP_DEBOUNCE_SECONDS`, default 10), on admin page load, on Save Order,
on `/api/sync` and on event switch; a database snapshot is taken at most every 5 minutes (or when forced). User text is neutralized
against spreadsheet formula injection. The exports contain phone numbers.

### 3.11 API reference [C]

Auth column: **P** public, **O** operator or admin, **A** admin only. "CO" = also requires `console_enabled` (403 otherwise).
Public endpoints are limited by the privacy rules in 2.6.

**Pages and static:** see 3.2.

**Event and config**

| Method and path | Auth | Purpose | Notes |
|---|---|---|---|
| `GET /api/health` | P | App + downloader health | Used by the Docker healthcheck |
| `GET /api/event-info` | P | Branding, dates, switches, `allowed_media`, `max_upload_size_mb`, payment URL (blank if payment off), `sheet_url` | Source for the client-side navigation adaptations |
| `GET /api/signup/config` | P | Rules, age groups, menu, registered names, existing songs | Redacted |
| `POST /api/auth/login` | P | PIN -> cookie | Throttled |

**Sign-up, performer hub, potluck (public)**

| Method and path | Auth | Purpose | Errors |
|---|---|---|---|
| `POST /api/signup` | P | Register performer or food-only attendee | 400 rule errors, 409 dish taken |
| `PUT /api/signup/performance/{entry_id}` | P | Edit an act | 400 if edits locked, 404 |
| `GET /api/performer/profile?name=` | P | A person's acts, dish, counts, flags, all dishes, other songs | Exact name match |
| `GET /api/performer/names` | P | Sorted performer and partner names | |
| `POST /api/performer/performances` | P | Add an act for a registered name | 400 limits, 404 unregistered |
| `PUT /api/performer/rename` | P | Rename a person everywhere | 400 clash |
| `POST /api/signup/food`, `PUT /api/signup/food/{id}`, `DELETE /api/signup/food/{id}` | P | Claim, change, release a dish | 409 taken |
| `POST /api/upload` | P | Upload file or link (form: `entry_id`, `submission_type`, `media_type`, `youtube_url`, `file`) | 400, 404, 413, 422, 500 |
| `GET /api/stream/{id}`, `GET /api/track-info/{id}` | P | Play, metadata | 404 if no track |
| `GET /api/dashboard/performances`, `GET /api/dashboard/food` | P | Public setlist and potluck board | |
| `GET /api/live-status`, `GET /api/live-stream` | P | Live state, SSE | ETag |
| `GET /api/performances`, `GET /api/stage-queue` | P (full data for admin) | Act list | Redacted unless admin |

**Console (operator)**

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/set-active/{id}`, `POST /api/clear-active` | O+CO | Cue / uncue |
| `PATCH /api/status/{id}`, `PATCH /api/performance-notes/{id}` | O+CO | Status, notes |
| `POST /api/reorder-queue` (field `push_to_sheet` is a legacy name for "also save now") | O+CO | Store order |
| `POST /api/push-sequence` | O+CO | Save Order: rename files, export |
| `POST /api/sync` | O | Reconcile tracks and export now (legacy name) |
| `GET /api/download-track/{id}`, `GET /api/export-zip`, `GET /api/export-sequenced-zip`, `GET /api/admin/export-tracks-zip` | O | Track download, offline ZIP (three aliases) |

**Admin**

| Group | Endpoints (all A) |
|---|---|
| Settings and presets | `GET/PUT /api/admin/settings`, `GET /api/admin/presets`, `POST /api/admin/apply-preset` |
| Status | `GET /api/admin/summary`, `/readiness`, `/backup-status`; `POST /backup-now` |
| People | `GET /api/admin/roster`, `/participants`; `PUT/DELETE /api/admin/participants/{entry_id}`; `GET/PUT /api/admin/payments` |
| Potluck | `GET/POST /api/admin/food-groups`, `PUT/DELETE .../{id}`, `POST .../reorder`; `GET/POST /api/admin/food-items`, `PUT/DELETE .../{id}` (`force`), `POST .../bulk`; `PUT /api/admin/food-serving-note`, `/food-toggle`, `/signup-toggle`; `GET /api/admin/food-templates` |
| Data | `GET /api/admin/data`, `GET /api/admin/data/download?format=&sheet=`; `GET /api/admin/activity-logs` |
| Events | `GET/POST /api/admin/events`, `POST /api/admin/events/{id}/activate`, `POST /api/admin/events/{id}/clear-media` |

---

## 4. Non-functional specification

### 4.1 Security and privacy [C]

- Roles and throttling: section 3.1. PIN is never accepted in a URL. Cookie value is deterministic per PIN (valid until the PIN changes; no server-side expiry or logout).
- Public data: redaction in 2.6; `/data` serves images only; HTML-escaping of user text on render; formula-injection guard in exports.
- Input: settings validated and bounded; event ids restricted to `[A-Za-z0-9._-]` and checked to stay under the events root; downloader host allow-list (SSRF guard).
- Accepted weaknesses by design: login-free edits by name/entry id, public upload and streaming by entry id, 4-digit default PIN (`2026`) with a readiness warning.
- Phone numbers live in `event.db`, snapshots, exports and activity-log details. Share the folder only with organizers.
- No HTTPS in the app; put a reverse proxy in front (runbook has a Caddy example).

### 4.2 Network, offline and performance [C]

| Topic | Behaviour |
|---|---|
| Server dependencies at run time | None except the optional downloader container and (for the downloader) PyPI to update yt-dlp |
| Browser dependencies | Tailwind (`cdn.tailwindcss.com`), Lucide (`unpkg.com/lucide@latest`, unpinned), WaveSurfer (`unpkg.com/wavesurfer.js@7`), `marked` (jsDelivr) on every page. No web font is loaded (`Plus Jakarta Sans` is named in CSS but not fetched), so system fonts render. |
| Offline | Server side works with no internet. Browser side needs the CDNs unless the console has pre-cached them. Console offline plan: service worker + vault + action queue + USB ZIP. Guest pages have no offline support. |
| Concurrency | One uvicorn worker. Router handlers for sign-up, performer, food and admin are `async def` with blocking SQLite/file calls, so they run on the event loop; console routes are plain `def` (thread pool). Fine at roughly 100 guests; not load-tested. |
| Live push | One shared once-per-second check, any number of viewers |
| Scratch | Failed-upload leftovers older than an hour pruned; cache trimmed past 2 GB |

### 4.3 Backup and sync [C]

Inside the app: debounced exports, periodic database snapshots, manual "Export now", never any network call. **Sync to a cloud or NAS is the
operator's job and is out of scope here.** Facts the operator needs: never copy the live `event.db`/`-wal`/`-shm` (copy the snapshots in
`backups/`); exported files are mode `0600`; the optional bundled rclone sidecar follows `EVENT_ID` from `.env`, not the active event.

### 4.4 Deployment [C]

`docker compose up -d`: `app` (FastAPI, port 8000 mapped to `PORT`, default 8088; image runs as uid 1000 after an entrypoint that fixes volume ownership
as root; `tini`; healthcheck on `/api/health`), `downloader` (port 8001, internal; own image with yt-dlp, ffmpeg, deno), optional `rclone-sync` (profile
`sync`). Volumes: `./events:/events`, named `audio_cache:/data/cache` (shared scratch), `ytdlp_pkgs` (upgraded yt-dlp), `./config.yaml:/app/config.yaml:ro`,
`./secrets:/secrets:ro` (downloader). Dev and local-build variants: `docker-compose.dev.yml`, `docker-compose.local.yml`. Python 3.11.9 base for both images.

### 4.5 CI and tests [C][V]

GitHub Actions (`docker-publish.yml`): on push to `main` and `v*` tags: pytest on Python 3.11, then multi-arch (amd64, arm64) builds of both images to GHCR
with layer caching. Tests: 25 test files, about 4,000 lines, **183 passed** in about 11 s (run 2026-11-06 and unchanged code). Coverage areas: API, security and privacy,
event folder, presets and flags, food, exports, live stream, uploads, downloader client. No browser tests, no front-end unit tests, no sidecar tests, no load tests.

---

## 5. Known gaps

Carried over from `docs/AUDIT-2026-11.md` (sync finding excluded because sync is out of scope), then new findings from this spec pass.
IDs `A#` refer to the audit table; `N#` are new.

| ID | Severity | Gap | Where | Status in this spec |
|---|---|---|---|---|
| A2 | Medium | Browsers need the internet (CDN scripts; Tailwind browser build is dev-only; Lucide unpinned) | `app/static/*.html`, `sw.js` | Phase 1 |
| A3 | Medium | Feature switches scattered (92 `get_setting` calls; a new switch touches 6-8 files) | many | Phase 2 |
| A4 | Medium | Monolithic front end (`admin.js` 2,246, `intake.js` 2,043, `admin-settings.js` 1,930 lines; no modules) | `app/static/js` | Phase 2 |
| A5 | Medium | No schema versioning; swallowed `ALTER TABLE` errors | `repositories/schema.py` | Phase 4 |
| A6 | Low | Google-era names (`drive_file_*`, `created_via='sheet'`, `ColumnNamesConfig` + `COL_*` env vars, `push_to_sheet`, `/api/sync`, `backup_target_sheet`) | several | Phase 4 |
| A7 | Low | `reset_database()` drops all tables and has no callers | `db_service.py` | Phase 4 (delete) |
| A8 | Low | Pass-through facade in `db_service.py`, re-exports in `main.py` | | Phase 4 |
| A9 | Low | Only `.mp4` treated as video; stream always `audio/mpeg` for the rest (hand-delivered `.mov/.webm/.wav/.flac`) | `routers/audio.py` | Phase 0 |
| A10 | Low | Static session cookie; spoofable rate-limit key; global cap can lock out the admin for 5 min | `routers/auth.py` | Phase 0 (optional) |
| A11 | Low | Branding hard-coded (API titles, SW cache name, success message "Welcome to Paattukoottam", `config.yaml` defaults, brand title fallbacks) | several | Phase 3 |
| A12 | Low | Event list `singers` always 0; exports `0600`; sidecar hides pull errors; two connection pools for settings | various | Phase 0 |
| N1 | Medium | **Readiness never reports a failed export**: compares `"error"`, log writes `"failed"` [V] | `readiness_service.py`, `audit_repo.py` | Phase 0 |
| N2 | Medium | **Public edit is unconstrained**: any entry id, any `track_status` / `performance_type` string, no limit or duet re-check [V] | `routers/signup.py` | Phase 0 |
| N3 | Low | **Entry ids can be reused** after deleting the highest id; activity-log history for the old act then points at a new person [V] | `performance_repo.py` | Phase 0 |
| N4 | Medium | **Console keeps the raw PIN in `localStorage`** and sends it as a header on every call; README says sessions use an HMAC cookie, which is true only for the admin page | `js/admin.js` | Phase 2 |
| N5 | Low | **Stage monitor works only in the same browser** (BroadcastChannel); a second device or machine cannot act as the stage confidence monitor | `js/stage-monitor.js` | Open question Q6 |
| N6 | Low | Public `/api/performances` and `/api/stage-queue` keep private keys with blank values (no leak; confusing API shape) [V] | `routers/stage.py` | Phase 0 |
| N7 | Low | Blocking calls inside `async def` handlers (sign-up, performer, food, admin) hold the event loop | routers | Phase 2 |
| N8 | Low | `view-transition` meta tag on every page but no `@view-transition` rule; app is dark-only; `Plus Jakarta Sans` never loaded | `*.html`, `style.css` | Phase 3 |
| N9 | Low | Navigation adapter exists but only dims links and relabels; staff links visible to guests; not applied on `/live`, `/admin`, stage monitor | `utils.js`, `nav.js` | Phase 2 |
| N10 | Low | Activity-log `details` store phone numbers; admin-only but they also sit in every snapshot | `registration_service.py` | Phase 0 (redact) |
| N11 | Low | `admin-setup.js` depends on globals and monkey-patches `loadAllAdminData` from `admin-settings.js` (load-order coupling) | `js/` | Phase 2 |
| N12 | Low | UI copy "Automated Cloud Backup & One-Way Sync" and `/docs` titles still imply cloud features | `admin-settings.html` | Phase 3 |
| N13 | Low | `food_items.name` is unique across all groups, so "Rice" cannot exist in two groups (bulk add silently skips duplicates, reported as skipped) | `schema.py` | Open question Q9 |
| N14 | Low | Participants are unique by name, so two people with the same name share one record (phone, paid flag) | `schema.py` | Open question Q9 |

---

## 6. Target architecture and design plan [T]

Everything in this section is proposed. Decisions marked **Agreed** were made by the owner in conversation before this spec; the rest are recommendations.

### 6.1 Principles

1. **Agreed:** keep one folder + one SQLite per event as the source of truth. No central database of file paths. The folder stays copyable, archivable, restorable.
2. **Agreed:** keep the multi-page app. No single-page-app rewrite. App-like feel comes from CSS (view transitions, container queries) and good structure, not a framework.
3. **Agreed:** minimize external dependencies. Browsers must not need the internet. yt-dlp remains the one deliberate runtime dependency.
4. **Agreed:** one feature-flag registry drives server gates, presets, the public payload and navigation.
5. Make the three areas explicit in the code and the UI (own layout, own navigation, shared tokens).
6. Calm working screens, a little personality on the landing and live screens, nothing decorative that costs speed or readability.

### 6.2 Target module layout

```
app/
  features.py              [T] the flag registry (below)
  routers/ services/ repositories/    unchanged layering
  static/
    vendor/                [T] pinned lucide, wavesurfer, marked (committed, versioned file names)
    css/tokens.css         [T] design tokens (light + dark)
    css/app.css            [T] built Tailwind output (one file, committed or built in Docker)
    js/core/               [T] api.js (fetch + errors), auth.js, features.js, nav.js, dom.js (escape), toast.js, sw-register.js
    js/pages/              [T] signup.js, hub.js, dashboard.js, live.js, console/*.js, admin/*.js (ES modules)
    components/            [T] shared HTML snippets or small custom elements (app-header, tab-bar, side-rail, card, sheet)
```

### 6.3 Feature-flag registry

One list of `Feature(key, label, default, area, public, requires, preset_visible)`. Everything derives from it.

| Consumer | Today [C] | Target [T] |
|---|---|---|
| Defaults | `SignupConfig` and `default_app_settings()` | Registry `default` |
| Validation | `BOOL_SETTINGS` in `admin_service` | Registry keys |
| Presets | `FLAG_KEYS`, `SETTING_LABELS`, 8 hand-written dicts | Presets list only `{feature: on/off}` pairs; label from registry |
| Server gate | Inline `get_setting(..., getattr(...))` (about 25 places) | `Depends(require_feature("food_signup"))` returning a consistent 403/`closed` response |
| Public payload | Hand-copied booleans in `event.py` | `features: {key: bool}` generated; `GET /api/event-info` keeps the old booleans for one release |
| Navigation | `adaptNavigationForEventConfig` string matching | Each nav destination declares `requires: [...]`; the client builds menus from `features` |
| Tests | One file of examples | One generic test: every registry feature has a server gate (or is documented "client only"), appears in the admin UI, and in at least one preset |

Dependencies between flags (for example `track_upload_enabled` needs `stage_performances_enabled`) are expressed once in `requires` and enforced in both the gate and the nav.

### 6.4 Navigation model (one list, adaptive)

Frontier practice used (research appendix; search snippets, not full guideline pages): Apple HIG tab bars (bottom, labelled, 3-5 items, shrink on scroll, glass only
for the navigation layer); Material 3 (bottom bar on compact screens, navigation rail on medium/expanded, drawer fading out on phones); 2026 web guidance (container
queries, view transitions for multi-page sites, fluid type, 44 px / 48 dp targets, design tokens, dark mode as a first-class theme, restraint with effects);
event-app guidance (few features, schedule first, plan for weak connectivity, timely notices, one-handed use).

**Rule:** each area defines its destinations once. The component shows them as a **bottom tab bar below 840 px** and a **side rail at 840 px and above**
(Material "expanded" class; width thresholds to be tuned in Phase 3). A destination is shown only if its `requires` features are on. Staff destinations never appear in guest navigation.

| Area | Destinations (max 5) | Requires |
|---|---|---|
| Guest | Home (`/`) · Sign up (`/signup`) · My entry (`/performer`) · Schedule (`/dashboard`) · Live (`/live`) | Sign up: `signup_enabled` or `food_signup_enabled`; My entry: any of stage/food; Schedule: `dashboard_enabled`; Live: `live_display_enabled`. Labels follow the event type ("Food board" for potluck-only, "My dish" instead of "My entry"). |
| Console | Queue · Player · Notes (phone/tablet) ; on laptop one three-pane screen with its own compact header | `console_enabled` |
| Admin | **Setup** (event details, rules, features and presets, wizard) · **People** (participants, payments) · **Food** (menu, claims) · **Data** (spreadsheet, exports, activity, backup) · **Events** (switch, create, clear media, readiness) | Food only if `food_signup_enabled` |

Staff entry: a small "Staff" link in the footer of the guest pages opens one **shared staff sign-in** (admin or operator PIN) that lands on the console for operators and the
admin home for admins; the console and admin share the session (cookie) so the operator is not asked twice. Role decides which staff destinations exist.

Behaviour: tab bar can shrink while scrolling and return on scroll up; active destination uses `aria-current`; page-to-page motion via `@view-transition { navigation: auto }`
with `prefers-reduced-motion` honoured; the Live destination shows a small dot when an act is on stage.

### 6.5 Design system

| Piece | Target |
|---|---|
| Tokens (`tokens.css`) | Colour roles (surface, surface-raised, text, text-muted, accent, success, warning, danger, focus) in **light and dark**; spacing scale; radius; elevation; type scale with fluid `clamp()`; motion durations/easings; z-index layers. Tailwind is configured to read the tokens, so changing a token restyles every page. |
| Themes | Dark and light, follows `prefers-color-scheme`, manual override stored locally. Console and `/live` default to dark (booth and venue). |
| Components | App header, tab bar / side rail, card, button (primary, secondary, danger), field, select, toggle, badge/pill, toast, modal and bottom sheet, table that becomes cards on phones, empty state, skeleton, progress, waveform player bar. Each documented once with states (default, hover, focus, disabled, loading, error). |
| Layout | Container queries for components; page grids: guest = single column to two; console = 3-pane on laptop (queue, player, notes); admin = side rail + content. |
| Typography | One self-hosted variable font (or system stack decision, Q4), fluid sizes, tabular numbers for times and counts. |
| Touch and a11y | 44 px minimum targets, visible focus, labelled controls, contrast at WCAG AA, reduced motion, semantic landmarks, screen-reader labels on icon buttons. |
| Effects | Aurora background only on landing and live; off on console/admin; always optional and reduced-motion safe. |
| Copy | One name per concept (Performer Hub / Tracks / Intake / Upload collapse to "My entry"); event name and brand pulled from settings, never hard-coded. |

### 6.6 Front-end architecture

- Plain ES modules, no framework, no bundler required for JS (the browser loads modules directly). Tailwind is the only build step (CLI in a Docker build stage, plus `npm run build` locally).
- `core/api.js` is the single fetch wrapper (JSON, errors, 401 handling, retry for idempotent GETs); `core/features.js` loads `/api/event-info` once and exposes `has(feature)`.
- Large files split by screen and by responsibility (for example console: `queue.js`, `player.js`, `vault.js`, `offline-actions.js`, `stage-monitor-bridge.js`, `hotkeys.js`).
- Service worker: precache the shell of **all** areas from local files (no CDNs); network-first for `/api/live-status`, cache-first for static files with versioned names; the cache name carries a build version so updates are clean.
- Console auth moves from "raw PIN in localStorage" to the cookie plus an offline-safe unlock flag (decision Q7).

### 6.7 Backend adjustments (small)

Registry (6.3); `require_feature` dependency; correctness fixes from section 5 Phase 0; optional `PRAGMA user_version` migrations; `async def` handlers that touch SQLite become plain `def` (thread pool) or use `to_thread`.
No new services, no new runtime dependencies, no database engine change.

### 6.8 Phased roadmap

Order requested by the owner: assets, then registry + JS split + shared navigation, then visual redesign, then renames and migration. Phase 0 is an addition of this spec.

| Phase | Scope | Acceptance criteria |
|---|---|---|
| **0. Correctness fixes** (small, can ship first or alongside Phase 1) | N1 readiness status; N2 public edit validation (types, track status, limits); N3 id reuse (never reuse: keep a high-water mark in `sync_meta`); N6 consistent redacted shape; N10 redact phones in activity details; A9 media types from `mimetypes`; A12 small items | Each fix has a failing-then-passing test; existing 183 tests still pass; manual note in changelog |
| **1. Bundle assets** | Vendor Lucide, WaveSurfer, `marked` at pinned versions under `static/vendor/`; precompile Tailwind to `app.css` (Docker build stage + dev script); update 8 pages and `sw.js` | A test greps every HTML/JS/CSS file and fails on any `http(s)://` host except links the owner entered; app renders **identically** with outbound network blocked (Playwright `route.abort` on non-local hosts); screenshot diff vs. today within tolerance on all 8 pages at 390x844 and 1280x800; image build succeeds; no console errors |
| **2. Registry + modules + shared navigation** | `features.py` and `require_feature`; presets rewritten on the registry; ES module split with `core/`; shared header and nav component per area; staff entry and shared sign-in; console auth change; service worker covers all areas | Adding a throw-away feature touches only the registry, one gate, one page (demonstrated in a test); generic flag test passes; nav shows exactly the enabled destinations for each of the 8 presets (table-driven test); no staff links in guest nav; no file in `static/js` over 600 lines; all pytest tests pass; Playwright smoke covers each page |
| **3. Visual redesign** | Tokens, themes, components, per-area layouts, view transitions, a11y pass, branding from settings, copy cleanup (N12) | Axe scan has no serious/critical issues on every page; targets measured at least 44 px on phone layouts; light and dark verified on every page; Lighthouse mobile (throttled) Performance >= 90 and Accessibility >= 95 on guest pages (proposed thresholds, owner to confirm); INP under 200 ms on console actions on a mid-range laptop; reduced-motion respected; owner sign-off on screenshots of the five main screens on phone and laptop |
| **4. Renames and migration** | `PRAGMA user_version` migration runner; rename `drive_file_id` -> `track_version`, `drive_file_name` -> `track_file`, default `created_via` `'sheet'` -> `'signup'`; remove `ColumnNamesConfig`/`COL_*`, `reset_database`, facade layers; `/api/sync` -> `/api/export-now` and `push_to_sheet` -> `save_files` with the old names kept as aliases for one release; `signup_sheet_url` -> `external_link_url` (setting alias) | Fixture databases from `2fc83ae` and from the Google-era layout migrate cleanly and load; round-trip test (old snapshot restored into new code); API alias tests; grep finds no remaining Google-era identifiers (except the changelog); snapshots taken before migration |

### 6.9 Test plan

| Layer | What | Tool |
|---|---|---|
| Unit and API (exists) | Rules, privacy, presets, exports, live, uploads | `pytest` (183 today) |
| New backend | Flag registry invariants; every public JSON endpoint scanned for private keys with a seeded junior duet (generalizes the verification run in Appendix B); migration fixtures; id high-water mark; readiness failure path; public-edit validation | `pytest` |
| Static checks | No external hosts in assets; no JS file over the size cap; no inline `onclick` with user data; every nav destination maps to a route | `pytest` + a small script in CI |
| Browser smoke (new) | Per area at 390x844 and 1280x800: load, nav items correct for each preset, sign-up happy path and one rule error, upload a small MP3, cue/play in the console, Save Order, live screen updates after a cue (SSE), admin preset preview/apply, event create/switch | Playwright (Chromium; WebKit if available) in CI |
| Offline | Console reload with `context.setOffline(true)` after caching; action queue replays on reconnect | Playwright |
| Accessibility and visual | Axe on every page; screenshot comparison for the 8 pages x 2 viewports x 2 themes | Playwright + axe-core |
| Performance | Lighthouse CI on guest pages; a simple concurrent sign-up script (about 100 users) against a compose stack | Lighthouse CI; k6 or a Python script |
| Container | Build both images, run the stack, hit `/api/health`, upload a track, check folder layout | CI job |

---

## 7. Open questions for the owner

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| Q1 | Is the 4-digit PIN and login-free editing still right for every future event, or do some events want a per-person code? | Drives whether N2 fixes are enough | Keep login-free; add validation only |
| Q2 | Should Operator and Admin share one staff sign-in screen with role-based landing? | Shapes the nav and the console auth change | Yes |
| Q3 | Guest nav: is "My entry" the right name, and should potluck-only events say "My dish"? | Copy and nav labels | Yes to both |
| Q4 | Self-host a font or use the system font stack? | Look vs. weight and dependencies | System stack plus one self-hosted variable font only if it clearly helps |
| Q5 | Default theme for guests: follow the phone setting, or always dark as today? | Visual identity | Follow the phone, with a toggle; console and live stay dark |
| Q6 | Do you ever need the stage confidence monitor on a **different** computer than the console? | Today it cannot (same browser only) | Not needed; revisit if yes |
| Q7 | Console offline reload today relies on the PIN in `localStorage`. Accept a cookie plus an "unlocked on this device" flag instead? | Security vs. offline reload | Yes |
| Q8 | Lighthouse and speed thresholds in Phase 3 (90 / 95 / 200 ms): acceptable? | Acceptance criteria | Yes |
| Q9 | Same-name people and a dish name used in two groups: keep today's behaviour or allow duplicates? | Data model | Keep, document |
| Q10 | After Phase 4, how many releases should the old API names stay as aliases? | Compatibility vs. cleanup | One release |
| Q11 | Should `/live` and `/dashboard` show phone-free data only (as now), or may admins see a private view on the same pages? | Privacy surface | Phone-free only |
| Q12 | Is the cloud sync story staying fully outside the app, including removing the bundled `rclone/` sidecar from the repo later? | Repo scope | Keep the sidecar, document its limits |

---

## Appendix A. Sources for the research behind section 6

These were obtained from web search result snippets, not by reading the full guideline pages. Treat them as directional and confirm details on the official sites
before treating a number or rule as binding.

- Apple Human Interface Guidelines, Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars.md
- Apple Human Interface Guidelines, Toolbars: https://developer.apple.com/design/human-interface-guidelines/toolbars.md
- Apple newsroom, new software design (iOS 26 tab bars shrink on scroll): https://www.apple.com/uk/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design
- WWDC25 session 284 (Liquid Glass): https://developer.apple.com/videos/play/wwdc2025/284
- Critique of the iOS 26 tab bar: https://ryanashcraft.com/ios-26-tab-bar-beef
- 9to5Google, Material 3 Expressive navigation: https://9to5google.com/2025/05/14/material-3-expressive-navigation/
- Android developers, adaptive layouts with Material: https://developer.android.com/codelabs/adaptive-material-guidance
- SAP Fiori for Android, navigation bar and rail usage (Material 3): https://www.sap.com/design-system/fiori-design-android/v26-4/components/m3-standard-components/navigation-bar/usage
- Netguru, web design trends 2026: https://www.netguru.com/blog/top-web-design-trends
- Gapsy, responsive design trends 2026: https://gapsystudio.com/blog/responsive-design-trends
- Internet-Pros, modern CSS container queries and view transitions: https://internet-pros.com/blog/modern-css-container-queries-view-transitions-2026/
- UX Magazine, event apps (think tapas, not smorgasbord): https://uxmag.com/articles/event-apps-think-tapas-not-smorgasbord
- Ticket Fairy, mobile event apps in 2026 (offline, engagement): https://ticketfairy.com/blog/maximizing-mobile-event-apps-in-2026-offline-capabilities-engagement-tactics-real-world-lessons
- Swoogo, attendee mobile experience: https://swoogo.events/blog/attendee-mobile-experience/

The searches returned nothing specific about Luma, Partiful or Eventbrite navigation; those products still need a direct look if the owner wants them as references.
Material window-size thresholds in 6.4 (compact below 600, medium 600-839, expanded 840 and up, in dp) come from general knowledge, not from the snippets; verify before building.

## Appendix B. Verification log

Run on 2026-11-06/07 against commit `aa07405`, scratch folders under the session scratchpad; no app code or user data touched.

| Check | Result |
|---|---|
| Full test suite | 183 passed, about 11 s |
| Start app, empty events folder | Folder, `event.db`, exports, `tracks/`, `incoming/`, `backups/`, `gallery/` created |
| Sign-up through the API | `PK-001` created, in exports |
| Drop `PK-001_dropin.mp3` into `incoming/` | Adopted into `tracks/`, act `Uploaded`, duration `00:02`, version `v8338-...` within about 4 s |
| Create second event | Own folder and database, 30 menu items copied, 0 acts, `.active_event` written, list shows both |
| Fresh install poster URL | `/data/paattukoottam_animated.gif` returns 404 (file not in repo) |
| Privacy scan with a junior duet (performer, guardian, partner phones) and a cued act | Phone numbers absent (full response text searched) from `/api/performances`, `/api/stage-queue`, `/api/live-status`, `/api/dashboard/performances`, `/api/dashboard/food`, `/api/performer/profile` (performer and partner), `/api/signup/config`, `/api/event-info`, `/api/track-info/{id}`; admin header returns them |
| Public edit | `PUT /api/signup/performance/PK-001` with `track_status=Uploaded`, `performance_type=Banana` returned 200 and both values were stored |
| Failed export vs readiness | `backup_log.status` = `failed`; readiness `backup` check = `ok` |
| Auth on operator/admin routes without a PIN | 401 for `/api/admin/summary`, `/api/download-track/{id}`, `/api/sync`; 200 for `/api/performances`, `/api/stage-queue`, `/api/track-info/{id}` |
| Entry id after deleting the highest id | The deleted id was issued again |

Not observed: any page in a real browser (layout, view transitions, service worker, offline vault, WebGL), the stage monitor, SSE timing under load, a Docker build,
real YouTube extraction, rclone, behaviour on iOS Safari, load with many concurrent users.

## Appendix C. External plan review

Not yet received. After the owner pastes the other agent's architecture and design plan, this appendix will list what was adopted (marked "from external plan" in the sections above),
what was rejected and why, and what was missing from this draft.
