# Event & Track Manager: Specification

Status: draft 3, 2026-11-07 (draft 2 plus the owner's answers on hosting, uploads and rendering approach). Written against commit `aa07405` (code unchanged since `2fc83ae`).
Owner: BP. Audience: the owner (non-coder), any developer or AI agent who will change the app.

## How to read this document

| Tag | Meaning |
|---|---|
| **[C]** | **Current behaviour.** Read in the code at the commit above. |
| **[V]** | Current behaviour that was also **run** (live app or `TestClient`) while writing this spec. |
| **[T]** | **Target / proposed.** A decision or plan, not yet built. |
| **[O]** | **Owner-confirmed** fact or decision (stated by the owner in conversation). |
| *(from external plan)* | Idea that came from the second agent's plan; *adapted* means changed to fit decisions already made. Appendix C lists everything adopted, adapted and rejected. |

Rules used throughout: everything tagged [C] or [V] describes what the code does today, including its flaws. Everything
tagged [T] is a recommendation until the owner accepts it. Cloud sync (rclone) is **out of scope**: the owner runs it
outside the app, and this spec only records what the app does and does not provide for it.

Contents: 1 Purpose and users · 2 Domain model · 3 Functional spec · 4 Non-functional · 5 Known gaps · 6 Target architecture
and design plan · 7 Questions for the owner · Appendices (sources, verification log, external plan review).

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
| **1. Public / guest** | `/` landing, `/signup`, `/performer` (Performer Hub), `/dashboard`, `/live` (venue screen) | Phones for guests; a large screen for `/live`. Assumes **internet in the browser** (CDN scripts). | Phone first, renders without any third-party site, one-handed, 44 px targets (48 px primary), clear message when offline |
| **2. Console / operator** | `/console` (sound console), `/console/stage-monitor` (video confidence monitor) | One laptop (Chromium-class browser: IndexedDB, BroadcastChannel, service worker), flaky venue Wi-Fi. Stage monitor is a second window **in the same browser** on an HDMI display. | Laptop or tablet, dark, dense, offline-tolerant, no accidental clicks |
| **3. Admin** | `/admin` (10 tabs, event bar, setup wizard, readiness strip) | Desktop browser; phone works but is cramped | Desktop first, responsive; 5 grouped destinations |

### 1.4 Owner-confirmed deployment facts [O]

| Topic | Fact (owner, 2026-11-07) | Consequence |
|---|---|---|
| Where it runs | A Proxmox LXC at Hetzner, reached through a **Cloudflare Tunnel**; confirmed a Hetzner data centre, not home. It is **not** on the venue network. | Venue internet is a hard dependency for every venue device; the console must run from its offline vault; the app is on the public internet (children's names, 4-digit PIN). See 4.6 and 6.12. |
| Video on stage | A separate display or TV connected by HDMI (to the console laptop, assumed). | Stage monitor stays a second window in the console's browser (works today); no networked monitor needed. |
| Payments | A manual tracker (Paid checkbox and note) plus a link to the payment page; no payment processing. | The current Payments tab and `payment_url` are the whole feature. |
| Families | After one registration, offer to add another; no multi-act form. | See 6.10. |
| Sync | Handled by the owner outside the app. | Out of scope here. |

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

### 4.6 Remote hosting [O][C]

The app itself assumes nothing about where it runs. With the confirmed topology (1.4) these current behaviours matter: uploads pass through Cloudflare (which caps request bodies by plan, 6.12) while the app allows 200 MB audio and 500 MB video;
the rate limiter trusts the first `X-Forwarded-For` value; guest pages are readable by anyone with the URL and are not marked noindex; the console's offline vault is filled only when the operator presses a button; `/live` has no path to follow the console without the server. Gaps N15 to N23 record these.

## 5. Known gaps

Carried over from `docs/AUDIT-2026-11.md` (sync finding excluded because sync is out of scope), then new findings from this spec pass.
IDs `A#` refer to the audit table; `N#` are new.

| ID | Severity | Gap | Where | Status in this spec |
|---|---|---|---|---|
| A2 | Medium | Browsers need the internet (CDN scripts; Tailwind browser build is dev-only; Lucide unpinned) | `app/static/*.html`, `sw.js` | Phase 1 |
| A3 | Medium | Feature switches scattered (92 `get_setting` calls; a new switch touches 6-8 files) | many | Phase 2 |
| A4 | Medium | Monolithic front end (`admin.js` 2,246, `intake.js` 2,043, `admin-settings.js` 1,930 lines; no modules) | `app/static/js` | Phase 2 |
| A5 | Medium | No schema versioning; swallowed `ALTER TABLE` errors | `repositories/schema.py` | Phase 2 (runner), Phase 5 |
| A6 | Low | Google-era names (`drive_file_*`, `created_via='sheet'`, `ColumnNamesConfig` + `COL_*` env vars, `push_to_sheet`, `/api/sync`, `backup_target_sheet`) | several | Phase 5 |
| A7 | Low | `reset_database()` drops all tables and has no callers | `db_service.py` | Phase 5 (delete) |
| A8 | Low | Pass-through facade in `db_service.py`, re-exports in `main.py` | | Phase 5 |
| A9 | Low | Only `.mp4` treated as video; stream always `audio/mpeg` for the rest (hand-delivered `.mov/.webm/.wav/.flac`) | `routers/audio.py` | Phase 0 |
| A10 | Medium (public internet) | Static session cookie; spoofable rate-limit key; 4-digit PIN with a global failure cap that lets anyone lock the admin out for 5 min | `routers/auth.py` | Phase 0 (see N17, N23) |
| A11 | Low | Branding hard-coded (API titles, SW cache name, success message "Welcome to Paattukoottam", `config.yaml` defaults, brand title fallbacks) | several | Phase 3 |
| A12 | Low | Event list `singers` always 0; exports `0600`; sidecar hides pull errors; two connection pools for settings | various | Phase 0 |
| N1 | Medium | **Readiness never reports a failed export**: compares `"error"`, log writes `"failed"` [V] | `readiness_service.py`, `audit_repo.py` | Phase 0 |
| N2 | Medium | **Public edit is unconstrained**: any entry id, any `track_status` / `performance_type` string, no limit or duet re-check [V] | `routers/signup.py` | Phase 0 |
| N3 | Low | **Entry ids can be reused** after deleting the highest id; activity-log history for the old act then points at a new person [V] | `performance_repo.py` | Phase 0 |
| N4 | Medium | **Console keeps the raw PIN in `localStorage`** and sends it as a header on every call; README says sessions use an HMAC cookie, which is true only for the admin page | `js/admin.js` | Phase 2 |
| N5 | Low | **Stage monitor works only in the same browser** (BroadcastChannel); a second device or machine cannot act as the stage confidence monitor | `js/stage-monitor.js` | Resolved: owner confirmed the TV is on HDMI (1.4) |
| N6 | Low | Public `/api/performances` and `/api/stage-queue` keep private keys with blank values (no leak; confusing API shape) [V] | `routers/stage.py` | Phase 0 |
| N7 | Low | Blocking calls inside `async def` handlers (sign-up, performer, food, admin) hold the event loop | routers | Phase 2 |
| N8 | Low | `view-transition` meta tag on every page but no `@view-transition` rule; app is dark-only; `Plus Jakarta Sans` never loaded | `*.html`, `style.css` | Phase 3 |
| N9 | Low | Navigation adapter exists but only dims links and relabels; staff links visible to guests; not applied on `/live`, `/admin`, stage monitor | `utils.js`, `nav.js` | Phase 2 |
| N10 | Low | Activity-log `details` store phone numbers; admin-only but they also sit in every snapshot | `registration_service.py` | Phase 0 (redact) |
| N11 | Low | `admin-setup.js` depends on globals and monkey-patches `loadAllAdminData` from `admin-settings.js` (load-order coupling) | `js/` | Phase 2 |
| N12 | Low | UI copy "Automated Cloud Backup & One-Way Sync" and `/docs` titles still imply cloud features | `admin-settings.html` | Phase 3 |
| N13 | Low | `food_items.name` is unique across all groups, so "Rice" cannot exist in two groups (bulk add silently skips duplicates, reported as skipped) | `schema.py` | Open question Q9 |
| N14 | Low | Participants are unique by name, so two people with the same name share one record (phone, paid flag) | `schema.py` | Open question Q9 |
| N15 | Medium | Upload limits (200 MB audio, 500 MB video) exceed what Cloudflare accepts on Free/Pro (100 MB per request; Tunnel-specific behaviour not confirmed); a larger file would fail with 413 at the edge | `audio_workflow_service.py`, Cloudflare | Owner will handle the limit (worst case a direct reverse proxy); app keeps a cap and a clear 413 message (Phase 0) |
| N16 | Medium | No `robots.txt`, no `X-Robots-Tag`; public pages list children's names [V grep] | `app/` | Phase 0 |
| N17 | Medium | Rate-limit key is the first `X-Forwarded-For` value (client-settable); behind Cloudflare use `CF-Connecting-IP` | `routers/auth.py` | Phase 0 |
| N18 | Medium | Offline vault is filled only when the operator presses "Cache All Offline"; nothing tells the operator it is incomplete before doors | `js/admin.js` | Phase 4 |
| N19 | Low | Track reconcile runs inside read requests (at most every 3 s) instead of a background task | `event_service.py` | Phase 2 |
| N20 | Low | Reordering saves instantly, but Save Order (file names, exports) is a manual step, and drag has no lock against stray touches | `js/admin.js`, `routers/stage.py` | Phase 4 |
| N21 | Medium | `/live` has no path to follow the console when the venue loses the internet (no `BroadcastChannel` listener) | `live.html` | Phase 4 |
| N22 | Low | No UI to restore a replaced or deleted track from `tracks/_archive/` | `track_store.py` | Phase 3 |
| N23 | Medium | A 4-digit default PIN protects `/admin` and `/console` on a public URL | `readiness_service.py`, `config.py` | Phase 0 (warn below 6 characters) |

---

## 6. Target architecture and design plan [T]

Everything in this section is proposed unless marked **[O]** (owner-confirmed). **(from external plan)** marks ideas that came from the second agent's plan, with "adapted" when
they were changed to fit decisions already made. Appendix C lists what was adopted, adapted and rejected, and why.

### 6.1 Principles

1. **[O] Agreed:** one folder plus one SQLite per event stays the source of truth. No central database of file paths. The folder stays copyable, archivable, restorable.
2. **[O] Agreed:** multi-page app, no single-page-app rewrite. App-like feel comes from CSS (view transitions, container queries) and good structure.
3. **[O] Agreed:** minimize dependencies. Browsers must not need the internet to render the app. yt-dlp stays the one deliberate runtime dependency.
4. **[O] Agreed:** one feature-flag registry drives server gates, presets, the public payload and navigation.
5. Make the areas explicit in code and UI: guest, venue screen, sound console, admin, each with its own shell, sharing tokens and components.
6. Calm working screens; personality only on the landing and live screens.
7. **Design for the remote host (6.12).** The server is not on the venue network, so the console must survive losing the internet, and the public internet must not be able to hurt guests or children. (from external plan, adapted: it assumed a venue LAN)

### 6.2 Decision register (what the external review changed)

| ID | Topic | Decision | Status |
|---|---|---|---|
| D1 | How pages are rendered | **Decided: keep browser-rendered pages with ES modules; inject the shell (navigation + feature map) from the server** so every page gets one source for navigation and flags and no wrong-menu flash. No Jinja2 or HTMX now. Reasons: it honours the agreed principles (no rewrite, fewest dependencies); the console must be client-side code anyway, so a second rendering style would mean two ways to build screens for a project maintained with AI help; the real pain (navigation and flags in many places) is solved by the shell. Revisit only if Phase 2 or 3 shows large duplicated render code across guest pages. | Decided (owner delegated, 2026-11-07) |
| D2 | Track-to-act link | Keep the **entry id in the file name** as the link and the disaster-recovery format (agreed). Add an optional per-event **file-facts table** (sha256, size, duration, loudness gain) as a cache the folder can always rebuild. | Proposed (Phase 5) |
| D3 | Service worker | **Revised.** Console: full shell cache plus offline vault. Guest pages: cache only versioned static files, never HTML or JSON; show a clear "offline, schedule as of 7:42 PM" banner from the last good response. | Replaces the earlier "offline-tolerant guest pages" idea |
| D4 | Guest navigation shape | Bottom tab bar on phones, **top bar on desktop** (not a side rail). Admin and console use a left rail on desktop. Hide the bar when fewer than two destinations are enabled. | Proposed |
| D5 | Admin destinations | Five, grouped by job (Overview, Lineup, People and Potluck, Setup and Rules, System), replacing the 10 tabs and the earlier Setup/People/Food/Data/Events grouping. Event switcher lives in the rail header. | Proposed |
| D6 | Console hotkeys | **Keep today's keys** (Space, arrows, `M` mute, `Down` next, `Enter` done). Add `F` for a 3-second fade out. | Proposed |
| D7 | Reorder and Save Order | Add a **reorder lock** (on by default during the show) and **auto-run Save Order** a few seconds after the last drop. The order itself already saves instantly; only file names and exports wait for Save Order. | Proposed |
| D8 | Guest edit safety | Optional switch `guest_edit_verification` (default off): after sign-up the device gets a signed cookie; other devices must enter the last 4 digits of the sign-up phone, or the admin PIN. Login-free stays the default. | Proposed (Q1) |

### 6.3 Target module layout

```
app/
  features.py              [T] the flag registry (6.4)
  db/migrations.py         [T] numbered migrations on PRAGMA user_version (6.8)
  routers/ services/ repositories/    unchanged layering
  shell injector           [T] small helper in `routers/pages.py` that inlines the navigation and feature map into each page
  static/
    vendor/                [T] pinned wavesurfer, marked, lucide sprite; SHA-256 checked
    fonts/                 [T] self-hosted variable fonts
    css/tokens.css         [T] design tokens (light + dark)
    css/app.css            [T] Tailwind output built in Docker
    js/core/               [T] api.js, auth.js, features.js, nav.js, dom.js, toast.js, offline-banner.js, sw-register.js
    js/pages/              [T] signup.js, my-entry.js, schedule.js, live.js, admin/*.js
    js/console/            [T] main.js, deck-machine.js, audio-engine.js, vault-idb.js, offline-actions.js, stage-sync.js, hotkeys.js
```

### 6.4 Feature-flag registry

One list of `Feature(key, label, default, area, public, requires)`. Existing key names stay (renames only through a migration), so old databases keep working.

| Consumer | Today [C] | Target [T] |
|---|---|---|
| Defaults | `SignupConfig` and `default_app_settings()` | Registry `default` |
| Validation | `BOOL_SETTINGS` in `admin_service` | Registry keys |
| Presets | `FLAG_KEYS`, `SETTING_LABELS`, 8 hand-written dicts | Presets listed as `{feature: on/off}` pairs; label from registry |
| Server gate | Inline `get_setting(..., getattr(...))` (about 25 places) | `Depends(require_feature("food_signup"))`, one consistent refusal |
| Public payload | Hand-copied booleans in `event.py` | Generated `features` map; old booleans kept for one release |
| Navigation | `adaptNavigationForEventConfig` string matching | Destinations declare `requires`; shell built from the feature map |
| Tests | Examples in one file | One generic test over every feature and every preset |

**Presets are patches, not full states** (kept from today, and a correction to the external sample). `freeze` changes only five flags and leaves the rest as the organizer set them.
A preset written as a complete flag set would silently turn payments off and the potluck back on when freezing, and would re-enable anything the organizer had switched off.
The external sample also changed three presets (`acoustic`, `karaoke_video`, `rehearsal` lose or gain the potluck and payments) relative to the current table in 3.8; those
changes should be a deliberate owner decision, not a side effect of a refactor.
Flag dependencies (`track_upload_enabled` needs `stage_performances_enabled`) are declared once in `requires` and enforced by both gate and navigation.

### 6.5 Navigation model

Frontier practice used (Appendix A; search snippets): Apple HIG tab bars (bottom, labelled, few items); Material 3 (bar on compact, rail on larger screens, one destination list that adapts);
2026 web guidance (container queries, view transitions for multi-page sites, 44 and 48 px targets, tokens, dark mode, restraint); event-app guidance (schedule first, plan for weak
connectivity, one-handed use). The external plan added: peer-level destinations per role, no one-tab bars, safe-area padding (from external plan).

**Rules**
1. Each area defines its destinations once, with `requires` flags. A destination appears only when its features are on; disabled features disappear (not greyed).
2. If fewer than two destinations remain, the bar is not drawn. (from external plan)
3. Phones (below 768 px): fixed bottom bar, labelled, 48 px targets (44 px floor), `env(safe-area-inset-bottom)` padding. Desktop: guests get a **top bar**; admin and console get a **left rail**. (from external plan, adapted)
4. Staff destinations never appear in guest navigation. Staff reach `/console` and `/admin` by URL, a printed QR code, or a small "Staff sign-in" link in the guest footer, then one shared sign-in.
5. Routes: `/dashboard` becomes `/schedule` and `/performer` becomes `/my-entry`, with permanent redirects from the old paths (and the existing `/tracks`, `/upload`, `/intake` aliases). Labels follow the event type ("Food board", "My dish" when stage is off). (from external plan)
6. View transitions between pages with `@view-transition { navigation: auto; }`, wrapped for reduced motion. The `Live` destination shows a dot when an act is on stage.

| Area | Destinations (max 5) | Requires |
|---|---|---|
| Guest | Home `/` · Schedule `/schedule` (stage lineup and potluck menu as a segmented switch) · Sign up `/signup` (primary accent) · My entry `/my-entry` · Live `/live` | Schedule: `dashboard_enabled`; Sign up: `signup_enabled` or `food_signup_enabled`; My entry: `performer_edits_enabled` or `track_upload_enabled` or food on; Live: `live_display_enabled` (kept in guest navigation because family at home can follow along) |
| Venue screen | `/live` full-screen, no navigation | `live_display_enabled` |
| Console | Own compact header, no tab bar on laptop; `/console/monitor` full-screen | `console_enabled` and operator/admin sign-in |
| Admin | **1 Overview** (readiness, quick preset, wizard banner, totals, show-day quick controls) · **2 Lineup** (running order, track status, incoming matcher) · **3 People and Potluck** (roster, payments, dishes, downloads) · **4 Setup and Rules** (details, features and presets, rules) · **5 System** (events, snapshots, offline ZIP, activity, backups) | Lineup only with `stage_performances_enabled` |

Where today's 10 tabs go: Event Details, Sign-Up Rules and Features & Presets -> Setup and Rules; Food & Potluck, Participants, Payments, Spreadsheet downloads -> People and Potluck;
Stats and readiness -> Overview; Backup & Sync, Activity, event bar -> System; the order and track status that live in the console and participant rows -> Lineup. Every old setting must remain reachable in two clicks (acceptance test in Phase 3).
The on-screen **spreadsheet viewer** is kept for now (owner built it recently); downloads become prominent buttons. Retiring the viewer is Q17.

### 6.6 Design system

| Piece | Target |
|---|---|
| Tokens (`tokens.css`) | Colour roles, spacing (4 px base), radius, elevation, fluid type with `clamp()`, motion, z-index; Tailwind reads them. |
| Themes | Guest and admin follow `prefers-color-scheme` with a manual override. **Console, stage monitor and `/live` are always dark** (dark booth, projector). (from external plan) |
| Effects | Aurora/glow only on the landing hero and `/live`; off on console, admin and forms. Reason: contrast, GPU load next to the waveform, glare. (from external plan, adapted) |
| Type | System stack is the fallback. Proposed self-hosted variable fonts: a sans (Inter) for UI, a monospace (JetBrains Mono) for timecodes, entry codes and counts with tabular numbers; an optional display serif for the event title only (Q4). Inputs 16 px minimum so iOS does not zoom. |
| Targets and a11y | 48 px primary targets, 44 px floor; visible focus; colour never the only signal (status badges pair colour with icon and text); WCAG AA contrast; reduced motion kills animation and view transitions. |
| Icons | Replace the `lucide@latest` runtime script with a static SVG sprite of only the icons used (about 35); no icon script at runtime. (from external plan) |
| Copy | One name per concept; no brand text hard-coded. |

**Proposed palette ("Warm Stage Studio", from external plan, corrected).** Taste is the owner's call; the numbers below were **recomputed** (WCAG relative luminance) and two of the external
values failed AA, so they are replaced. CI should run a contrast script over this table.

| Token | Light | Dark | Notes (contrast measured) |
|---|---|---|---|
| `--bg-canvas` | `#FAF8F5` | `#0B0D10` | page |
| `--bg-surface-1` | `#FFFFFF` | `#13161B` | cards, rows |
| `--bg-surface-2` | `#F2EFE9` | `#1C2027` | hover, inputs, table headers |
| `--bg-elevated` | `#FFFFFF` | `#252A34` | modals, sticky bars |
| `--text-primary` | `#141518` | `#F3F4F6` | 17.2 : 1 and 17.7 : 1 on canvas |
| `--text-secondary` | `#525866` | `#9CA3AF` | 6.7 : 1 and 7.7 : 1 |
| `--text-muted` | `#5F6778` (was `#6E7687`) | `#8A92A0` (was `#6B7280`) | external values measured 4.30 and 4.02, below the 4.5 AA minimum; replacements measure 5.4 and 6.2 on canvas and 5.0 and 5.2 on surface-2 |
| `--border-subtle` / `--border-strong` | `#E4E0D8` / `#C7C1B5` | `#262B35` / `#3D4554` | hairlines |
| `--accent-primary` | `#C84B31` | `#F06449` | **Buttons:** white text on the light accent measures 4.66 (passes); in dark use **dark text** on the accent (6.14); white on the dark accent is 3.17 and fails. **Small accent text or links on canvas:** light `#C84B31` measures 4.40 (fails), use `#B5412A` (5.28) |
| `--status-playing` | `#0D7A5F` on `#E6F4F0` | `#34D399` on `#064E3B` | 4.68 and 5.06 |
| `--status-cued` | `#B45309` on `#FEF3C7` | `#FBBF24` on `#451A03` | 4.51 and 8.97 |
| `--status-danger` | `#B91C1C` on `#FEE2E2` | `#F87171` on `#450A0A` | 5.30 and 5.84 |

**Component primitives** (ten, defined once with states): app shell (header, bar, rail), status badge, act row (guest, admin and console densities), segmented switch (`tablist`),
file upload with a pre-check (size and duration before upload, progress), confirm dialog on the native `<dialog>` element (focus trap and Esc for free), toast region (`aria-live`),
empty state, PIN pad dialog (`inputmode="numeric"`), readiness banner. Plus the table-to-cards pattern for phones. (from external plan, merged with the earlier list)

### 6.7 Front-end architecture

- Plain ES modules; no framework, no JS bundler. One build step: the **standalone Tailwind CLI binary** in a Docker build stage (no Node installed on the host or in the final image). The download must pick the binary by `TARGETARCH` because CI builds amd64 and arm64 (the external sample hard-coded arm64) and verify its SHA-256. A `vendor` script fetches pinned third-party files at build time (or they are committed), checks SHA-256 and fails the build on mismatch. (from external plan, adapted)
- `core/api.js` is the single fetch wrapper (JSON, errors, 401, backoff for GETs). `core/features.js` reads the server-injected feature map; no extra request before first paint.
- Console split by responsibility: `deck-machine.js` (transport state machine), `audio-engine.js` (WaveSurfer plus an optional gain stage for fades and loudness), `vault-idb.js`, `offline-actions.js`, `stage-sync.js`, `hotkeys.js`, `main.js`.
- Service worker (D3): console shell and offline vault as today but from local files; guest pages cache only versioned static assets; HTML and JSON are never served stale. A small `offline-banner.js` shows "offline, showing schedule as of <time>" using the last good response held in `sessionStorage`.
- Console auth moves from the raw PIN in `localStorage` to the cookie plus an "unlocked on this device" flag (Q7).
- No Preact/Alpine layer for the console (rejected, Appendix C): the state-machine module gives the safety without a framework.

### 6.8 Backend and data adjustments

- **Feature registry** and `require_feature` (6.4).
- **Migrations:** `PRAGMA user_version` with numbered steps in `app/db/migrations.py`; an automatic copy of `event.db` to `backups/event.pre_v<N>_<timestamp>.db` before each step; each step in a transaction; failures stop startup loudly. Step 1 is an idempotent baseline equal to today's `ensure_database()` (existing databases report version 0 and already have the schema). (from external plan, adapted)
- **Background reconcile:** a single background task watches `incoming/` and `tracks/` every few seconds and updates the database; request handlers only read. It tells the console and `/live` by the existing push channel. Must be restarted cleanly on event switch. (from external plan)
- **Upload checks:** keep streaming with early refusal; add an `ffprobe` check (valid stream, real duration) for audio and video; measure loudness at ingest (6.10). Upload size is limited by Cloudflare (6.12), so choose the per-file cap and consider chunked uploads.
- **Readiness additions:** `PRAGMA quick_check`, every database track reference exists with the expected size, disk under 2 GB warns, last export failed (fix N1), console vault completeness is shown in the console itself (the server cannot see a browser's vault). (from external plan, adapted)
- **Activity log:** record the actor role (Guest, Operator, Admin) and drop phone numbers from `details`. Client IPs are not stored by default (they are personal data and, behind Cloudflare, need the right header). (from external plan, adapted)
- **Handlers:** database-touching `async def` handlers become `def` (thread pool).
- **Optional per-event file-facts table (Phase 5):** `track_facts(entry_id, file_name, sha256, size, duration, loudness_lufs, gain_db, checked_at)`, rebuilt from the folder at any time; the folder remains the truth.
- No new services; no change of database engine.

Admin Lineup also supports adding and deleting acts, replacing tracks, matching incoming files to acts, and saving the running order. Deletion archives the track; entry IDs are not reused. These actions require Admin authentication.

### 6.9 Console and live upgrades

| Upgrade | Detail | Provenance |
|---|---|---|
| Transport state machine | `IDLE, CUED, PLAYING, PAUSED, FADING, ENDED`; selecting a row while `PLAYING` never changes the deck, it sets "on deck" or asks first. Unit-tested. | from external plan |
| On-deck concept | Active deck plus the next act shown with its notes; "Cue next" loads it (owner prefers the word "cue" throughout the UI and docs; never "arm"). The existing disruption modal stays as the confirmation. | from external plan, adapted |
| Fade out | `F` fades over 3 s through a gain stage, then stops. Keep `M` as mute; do not remap keys (D6). | from external plan, adapted |
| Reorder lock | Lock toggle (on during the show); unlocked shows drag handles; each drop saves the order; file renames and exports run automatically after a few seconds idle (D7). The manual Save Order button stays for "do it now". | from external plan, adapted (its premise that unsaved orders are lost is wrong, see Appendix C) |
| Screen wake lock | Request a screen wake lock on `/console`, `/console/monitor`, `/live`; re-request on visibility change (needs HTTPS, which Cloudflare provides). | from external plan |
| Output device | `setSinkId` lets the operator pin playback to the audio interface; Chromium only, so it is optional and hidden when unsupported. | from external plan |
| Vault | Auto-cache on console open from a manifest (`entry_id`, file name, sha256, size, duration), with an always-visible pill "Vault 18/18 ready, 142 MB"; manual buttons stay. Blobs stay in IndexedDB (as today). Manifest endpoint is operator-only. | from external plan, adapted (vault already exists, manual) |
| Live screen offline path | When `/live` runs as a window in the console's browser, it also listens to the `BroadcastChannel`, so the TV keeps updating with no internet. Otherwise it keeps its last state and sponsor gallery. | new (follows from the remote host, 6.12) |
| Loudness | Measure integrated loudness on ingest; store a gain value; the console applies it at playback; originals are untouched; optional normalized copy in the ZIP (Q16). Two-pass analysis, not single-pass. | from external plan, adapted |
| ZIP escape hatch | Add a `00_Playlist.m3u8` (opens in VLC in show order) and a printable `00_Run_Sheet.html` next to today's numbered files and text run sheet. | from external plan |
| "Unplug" acceptance test | Open console and monitor, wait for "all ready", cut the network, reload the console, play act 1, scrub, fade, cue a video act, edit notes; restore the network and watch queued changes sync. | from external plan, adapted to a remote host |

### 6.10 Guest flow and safety upgrades

| Item | Detail | Provenance |
|---|---|---|
| Existing-name lookup | While typing a name on `/signup`, compare with `registered_performers` (already returned by the config call) and offer "Edit PK-004 / No, new act". No new endpoint. | from external plan, adapted |
| After sign-up | Success card offers **Upload track now**, **Add another act**, **Add a dish**. This is the owner's answer to "families registering several people": no multi-act form needed. | [O] |
| Progressive form | Partner fields only for Duet/Group; upload zone hidden for "acoustic / no track". | from external plan |
| Edit verification | Optional flag (D8). | from external plan, adapted |
| Magic upload link | Admin copies a per-act link `/my-entry?code=PK-006&t=<hmac>` for WhatsApp; it opens straight to that act's upload and bypasses verification when verification is on. | from external plan |
| Restore previous track | Admin can restore a file from `tracks/_archive/` with one click (today it is manual). | from external plan, adapted |
| Search engines | Send `X-Robots-Tag: noindex, nofollow, noarchive` on every response and serve `/robots.txt` with `Disallow: /` (not present today, verified). | from external plan |
| Event passcode (optional) | A shared word or a token in the invite link before guest pages show anything, for public deployments. Alternatives outside the app (a Cloudflare access rule) exist. | from external plan, adapted (Q18) |
| Minor display names | Optional per-act checkbox "show first name and last initial on public screens"; full name stays in admin and console. | from external plan (Q18) |
| Dietary tags and tent cards | Chips (vegetarian, vegan, halal, nuts, gluten-free, dairy-free, spicy) per dish, and a print stylesheet for 8 table cards per sheet. Backlog, needs a schema column. | from external plan (backlog) |

### 6.11 Roadmap

Order the owner asked for, plus Phase 0 (fixes and hardening) and a console phase. External effort estimates (days per phase) were **not adopted**: they are unvalidated guesses.

| Phase | Scope | Acceptance criteria |
|---|---|---|
| **0. Fixes and public-internet hardening** | N1 readiness status; N2 public edit validation (types, track status, limits, duet rule); N3 never reuse entry ids (high-water mark in `sync_meta`); N6 consistent redacted shape; N10 no phones in activity details; A9 media types from `mimetypes`; N16 `X-Robots-Tag` and `robots.txt`; N17 optional `TRUST_CLOUDFLARE` to key rate limits on `CF-Connecting-IP`; N15 per-file upload cap behind the tunnel (and chunked upload decision); `ffprobe` check; readiness additions | Each fix has a test that fails before and passes after; the 183 existing tests pass; readiness shows ERROR after a forced export failure; `curl -I` on every page shows the robots header |
| **1. Bundle assets** | Standalone Tailwind CLI in the Docker build (arch-aware, hash-checked); pinned wavesurfer and marked; Lucide pinned for now (sprite comes in Phase 3); self-hosted fonts; update the 8 pages and `sw.js` | A test fails on any `http(s)://` host in HTML/JS/CSS except links an organizer typed; with all non-local requests aborted every page renders with no console errors; screenshot diff against today within tolerance (8 pages x 390x844 and 1280x800); both images build for amd64 and arm64; compiled CSS size recorded (the external target was under 25 KB gzipped; unverified) |
| **2. Registry, modules, shared shell** | `features.py` + `require_feature`; presets as patches on the registry; migration runner (no renames yet); background reconcile; ES module split; server-injected shell and navigation per area; route renames with redirects; staff sign-in and console auth change; guest service-worker policy (D3) | Adding a throw-away feature touches only the registry, one gate and one page (shown by a test); generic flag test passes; navigation matches the enabled destinations for each of the 8 presets (table-driven); no staff links in guest navigation; no JS file over 600 lines; all tests pass; old URLs redirect |
| **3. Visual redesign and guest/admin flows** | Tokens, themes, components, icon sprite, guest flows (6.10), admin consolidation to 5 destinations with Overview and readiness, copy and branding from settings | Axe scan has no serious or critical issues on every page; measured targets at least 44 px (48 px for primary controls) on phone layouts; every old admin setting reachable in two clicks (checklist test); light and dark verified; contrast script passes on the token table; Lighthouse mobile (throttled) Performance 90+ and Accessibility 95+ on guest pages (proposed; external plan wanted Accessibility 100); owner sign-off on screenshots of five main screens on phone and laptop |
| **4. Console and live** | 6.9 items: state machine, reorder lock plus auto Save Order, fade, wake lock, sink id, auto vault with pill, `/live` BroadcastChannel path, loudness gain, ZIP extras | "Unplug" test passes end to end; selecting a row during playback never interrupts audio (tested); a dropped order is saved and files renamed without pressing a button; operator confirms hotkeys feel unchanged |
| **5. Renames, migration, file facts** | Migrations 2+: `drive_file_id` -> `track_version`, `drive_file_name` -> `track_file`, `created_via` default `'sheet'` -> `'signup'`; remove `ColumnNamesConfig`/`COL_*`, `reset_database`, facade layers; `/api/sync` -> `/api/export-now`, `push_to_sheet` -> `save_files` (old names kept as aliases for one release); `signup_sheet_url` -> `external_link_url`; optional file-facts table | Fixture databases from `2fc83ae` and from the Google-era layout migrate and load; old snapshot restores into new code; pre-migration backup created; alias tests; grep finds no Google-era identifiers outside the changelog |
| **Backlog** | Allergen tags and tent cards, minor display names, event passcode, edit verification, magic links, restore-previous-track UI, Cloudflare gating notes | Each needs an owner yes first (Q15, Q18, Q19) |

### 6.12 Remote hosting behind a Cloudflare Tunnel [O][T]

Owner-confirmed: the stack runs on a Proxmox LXC at Hetzner and is reached through a Cloudflare Tunnel (confirmed: Hetzner data centre). Consequences:

| Topic | Effect | What to do |
|---|---|---|
| Venue internet drops | Every venue device (console laptop, TV, guests on venue Wi-Fi) loses the app. Guests on cellular are unaffected. | Console runs from its vault and service worker; stage monitor works (same browser); `/live` follows the console by `BroadcastChannel`; offline ZIP is the last resort. The vault must be complete before doors (auto-cache, pill). |
| Server or tunnel down | Same as above for everyone | Same fallbacks; runbook step "cache all, then check the pill" before every show |
| Upload size | Cloudflare caps request bodies at 100 MB on Free and Pro (200 Business, 500 Enterprise by default), per Cloudflare's documentation as found by search; whether Tunnel traffic follows the same cap was not confirmed. The app allows 200 MB audio and 500 MB video. | **Owner will handle it** (plan check, or a direct reverse proxy on the server that bypasses Cloudflare for uploads). The app still sets its own cap, shows a clear message on HTTP 413, and may offer chunked upload later |
| Client IP | The rate limiter keys on the first `X-Forwarded-For` value, which a client can set. Behind Cloudflare the trustworthy value is `CF-Connecting-IP`. | `TRUST_CLOUDFLARE` setting; only then use that header |
| PIN on the open internet | A 4-digit PIN has 10,000 possibilities; the global failure cap also lets anyone lock the admin out for 5 minutes | Longer PIN (6+) recommended by the readiness check; optionally put `/admin*`, `/console*`, `/api/admin*` behind a Cloudflare Access rule as a second lock (outside the app) |
| Children's data | Public pages show names of minors to anyone with the URL | Robots header, optional passcode, optional short display names (6.10) |
| HTTPS | Provided by Cloudflare; the app already marks cookies `Secure` when `x-forwarded-proto` is https; wake lock needs a secure context | Nothing to build |
| Venue video | A separate TV on HDMI is driven from the console laptop [O]; the stage monitor window must run in the console's browser (works today) | Document in the runbook; keep the monitor window same-browser |

### 6.13 Test plan

| Layer | What | Tool |
|---|---|---|
| Unit and API (exists) | Rules, privacy, presets, exports, live, uploads | `pytest` (183 today) |
| New backend | Flag registry invariants (every feature has a gate, an admin control, and appears in a preset); every public JSON endpoint scanned for private keys with a seeded junior duet (generalizes Appendix B); migration fixtures and pre-migration backup; id high-water mark; readiness failure path; public-edit validation; rate-limit key with and without `TRUST_CLOUDFLARE`; robots header on every response | `pytest` |
| Static checks | No external hosts in assets; no JS file over the size cap; every navigation destination maps to a route; contrast script over the token table (fails below AA) | `pytest` plus a small script in CI |
| Console logic | `deck-machine` transitions (selecting a row while `PLAYING` must not change the active deck), timecode helpers, vault manifest diff | Browser tests, or Node's built-in test runner in CI only (no Node at run time) |
| Browser smoke | Per area at 390x844 and 1280x800: load, navigation correct for each of the 8 presets, sign-up happy path plus one rule error, upload a small MP3, cue and play in the console, reorder lock, live screen updates after a cue (push), admin preset preview and apply, event create and switch | `pytest-playwright` (Chromium; WebKit if available) in CI |
| Offline | All third-party requests aborted: every page renders without console errors; the "unplug" test from 6.9 (set the context offline after the vault is full, reload, play, fade, edit notes, reconnect, verify sync) | Playwright |
| Accessibility and visual | Axe on every page; screenshots for 8 pages x 4 viewports (375x667, 393x852, 1024x768 console, 1920x1080 live) x 2 themes | Playwright, axe-core |
| Performance | Lighthouse CI on guest pages; a script that signs up about 100 people concurrently against a compose stack | Lighthouse CI; k6 or Python |
| Container | Build both images (amd64 and arm64), run the stack, hit `/api/health`, upload a track, check the folder layout | CI job |

---

## 7. Questions for the owner

**Answered by the owner on 2026-11-07 (recorded, no longer open)**

| Topic | Answer | Where it landed |
|---|---|---|
| Where does video play? | On a separate display or TV connected by HDMI (to the console laptop, as assumed; speak up if the TV is driven by a different computer) | 1.4, 6.12; closes the old Q6 about a second device |
| Payments | A manual tracker only (Paid checkbox, note) plus a deep link to the payment page; no payment processing | 1.4, existing Payments tab; optional QR/link on the landing and success card |
| Several people per family | After a registration, offer to add another; no multi-act form | 6.10 |
| Where does it run? | Proxmox LXC at a Hetzner data centre, through a Cloudflare Tunnel (confirmed) | 1.4, 4.6, 6.12 |
| Upload size limit behind Cloudflare | The owner will handle it; worst case the owner serves the app through a direct reverse proxy on the server, bypassing Cloudflare for uploads | 6.12; the app should still enforce its own per-file cap and show a clear error on 413 |
| Page rendering approach (old Q13) | Delegated to the spec author: stay with ES modules plus a server-injected shell; no Jinja2/HTMX now | D1 |

**Open**

| # | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| Q1 | Keep login-free editing for every event, or enable the optional verification (signed cookie plus phone last 4) for public deployments? | Hardening vs. friction for older guests | Keep login-free; ship verification as an off-by-default switch |
| Q2 | One shared staff sign-in with role-based landing? | Navigation and console auth | Yes |
| Q3 | Guest names: "Schedule" and "My entry" (and "My dish" for potluck-only)? Old URLs redirect. | Copy | Yes |
| Q4 | Fonts: self-host Inter and JetBrains Mono, or system fonts only? Display serif for the event title? | Look vs. weight | Self-host the two; no display serif |
| Q5 | Guests follow the phone's light/dark setting, with console, monitor and live always dark? | Visual identity | Yes |
| Q7 | Console reload offline: replace the raw PIN in `localStorage` with a cookie plus an "unlocked on this device" flag? | Security vs. offline reload | Yes |
| Q8 | Phase 3 thresholds (Lighthouse 90 and 95, INP 200 ms) acceptable? | Acceptance | Yes |
| Q9 | Same-name people and one dish name in two groups: keep today's behaviour? | Data model | Keep, document |
| Q10 | How long to keep old API names as aliases? | Compatibility | One release |
| Q11 | Public pages stay phone-free only? | Privacy | Yes |
| Q12 | Keep the bundled `rclone/` sidecar in the repo (sync is yours to run)? | Repo scope | Keep, document limits |
| Q15 | Allow the optional event passcode and minor short names? | Child privacy on a public URL | Build both as off-by-default switches |
| Q16 | Loudness: apply gain at playback only, or also bake a normalized copy? | Changes the audio the PA plays vs. preserving originals | Playback gain; optional copy in the ZIP |
| Q17 | Retire the on-screen spreadsheet viewer once downloads are prominent? | Less to maintain vs. a feature you just built | Keep for now |
| Q18 | Per-act "short name on public screens" and event passcode wording acceptable? | Public-facing copy | As in 6.10 |
| Q19 | Dietary tags and printable table cards worth doing before the next event? | Scope | Backlog |
| Q20 | Keep today's console hotkeys unchanged and add only `F` for fade? | Muscle memory | Yes |

---

## Appendix D. Owner decisions from the design review (round 2, 2026-11-07)

Recorded from the owner's answers to `docs/DESIGN-REVIEW-2.md`. They override earlier text in this spec where they differ. The design canvas (69 boards) already follows them.

| Topic | Decision |
|---|---|
| PIN | One 4-digit Admin PIN opens both the console and the admin screens. No operator PIN in the UI. No "6 or more characters" warning (remove readiness warning N23). The only PIN warning is "still the default PIN", without printing the digits. The word "Staff" becomes "Admin" everywhere. |
| Phone numbers | Not treated as private for this community. The sign-up name lookup may pre-fill the phone. Public Schedule and Live still show no phones. |
| Dish-only sign-up | Anyone can sign up for a dish alone, also at a full event. Sign-up step 1 offers Perform / Bring a dish / Both. |
| Juniors | Guardian name and phone fields stay. Age groups are configurable (list, not a 2-way toggle). Full name is stored; juniors are always shown publicly as first name plus last initial; admin and console show the full name. Adults may opt in to the short form. Admin switch "Always shorten junior names on public screens" (default on). |
| Partners | Duet and group partner entry keeps the existing-name check: "already signed up, same person?" with Yes / No, plus phone (and guardian for a junior) for a new person. |
| Uploads | Limits and allowed types come from admin settings (default audio 200 MB, video 500 MB). Audio MP3, WAV, M4A. Video MP4 and WebM. No MOV. YouTube and SoundCloud links stay. |
| TV text | Minimum 24 px on /live and the stage monitor; the Announcement is a prominent full-width strip. Stage monitor shows no developer notes. |
| Background | Live and stage monitor backgrounds are slow ambient moving lights (colours drift over minutes) or one solid colour; no per-act image upload. Sponsor reel panel defaults to black. |
| Console | Announcement inline; background, fade timer and stage monitor controls in a "Screens" sheet. "Done" is hold-to-confirm, not a bare Enter. Status chip and Admin button look different. Wording is "cue", never "arm". |
| Public schedule | Never shows "Needs track" or "Junior". |
| Stage notes | Split into an act note (stays with the act, console only) and an event-wide Announcement (stays across acts; shown on Live and the stage monitor). This changes today's behaviour, where stage notes are public per act. |

## Appendix A. Sources for the research behind sections 5 and 6

Obtained from web search result snippets, not from reading the full pages. Treat as directional; confirm on the official sites before treating a number or rule as binding.

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
- Cloudflare upload limits, plan caps and error 413 (search snippets; Tunnel behaviour not confirmed): https://fast.io/resources/cloudflare-upload-limit/ and https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413

Cited by the external plan but **not opened by this spec's author** (listed so they can be checked): MDN View Transition API, MDN `<dialog>`, MDN Screen Wake Lock API, W3C WCAG 2.2 target size, use of color and animation from interactions,
Material 3 navigation bar specs and dark-theme elevation, web.dev learn forms.
The searches returned nothing specific about Luma, Partiful or Eventbrite navigation.
Material window-size classes (compact below 600, medium 600 to 839, expanded 840 and up, in dp) come from general knowledge, not the snippets; verify before building. The 768 px phone/desktop switch in 6.5 follows the external plan and is tunable.

## Appendix B. Verification log

Run on 2026-11-06 and 2026-11-07 against commit `aa07405` (code unchanged), scratch folders only; no app code or user data touched.

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
| Reorder persistence | `POST /api/reorder-queue` changed `sequence_order` in the database immediately (1/2 swapped) and set the dirty flag; only file names and exports wait for Save Order |
| `robots.txt` / noindex | No handling anywhere under `app/` |
| Vault caching trigger | `cacheAllTracksOffline` is only called from a button handler; nothing caches automatically |
| Contrast of the external palette | Computed with the WCAG formula: `--text-muted` measures 4.30 (light) and 4.02 (dark) against claims of 4.6 and 4.5; muted text on surface-2 measures 3.97 and 3.38; light accent as small text on canvas 4.40; white on the dark accent 3.17. Other listed pairs pass AA. Replacement values in 6.6 were measured the same way. |
| Cloudflare request-body caps | Free and Pro 100 MB, Business 200 MB, Enterprise 500 MB by default, per search results quoting Cloudflare documentation; Tunnel-specific behaviour not confirmed |

Not observed: any page in a real browser (layout, view transitions, service worker, offline vault, WebGL), the stage monitor, SSE timing under load, a Docker build, real YouTube extraction, rclone,
iOS Safari behaviour, load with many concurrent users, Cloudflare Tunnel behaviour, the external plan's performance and size claims (500 readers, 8 ms p99, under 25 KB CSS, under 15 KB guest JS).

## Appendix C. External plan review

The second agent's plan ("Principal Architecture & Product Design Specification") was reviewed on 2026-11-07 against this spec, the code and the owner's answers.

### C.1 Adopted (placed in the sections shown, marked "from external plan")

| Idea | Where |
|---|---|
| Standalone Tailwind CLI in a Docker stage, hash-verified vendoring, no Node on the host | 6.7, Phase 1 |
| Static Lucide sprite instead of the runtime icon script | 6.6, Phase 3 |
| Self-hosted variable fonts, 16 px minimum inputs, tabular numbers | 6.6 |
| Palette and token structure (with two corrected values and extra contrast rules) | 6.6 |
| Console, monitor and live always dark; aurora only on hero and live | 6.6 |
| Ten component primitives, native `<dialog>`, toast region, PIN pad | 6.6 |
| Hide navigation when fewer than two destinations; top bar for desktop guests; left rail for admin; safe-area padding; 48 px targets | 6.5 |
| Route renames `/schedule` and `/my-entry` with redirects | 6.5 |
| Admin consolidated to five job-based destinations with an Overview and readiness home | 6.5, Phase 3 |
| Numbered migrations on `PRAGMA user_version` with automatic pre-migration backup | 6.8 |
| Background reconcile instead of scanning inside requests | 6.8, N19 |
| `ffprobe` validation, loudness measurement, extra readiness checks (`quick_check`, file sizes, disk) | 6.8, 6.9 |
| Transport state machine, fade out, reorder lock, auto-save of order, wake lock, output device, auto vault with manifest and pill | 6.9 |
| `.m3u8` playlist and printable run sheet in the offline ZIP; "unplug the router" acceptance test | 6.9 |
| Existing-name lookup on sign-up, progressive form, magic upload links, restore-previous-track | 6.10 |
| `X-Robots-Tag` and `robots.txt`; optional event passcode; optional short names for minors | 6.10, Phase 0 |
| Actor labels in the activity log | 6.8 |
| `pytest-playwright`, four-viewport visual checks, unit tests for the deck state machine | 6.13, Phases 2 to 4 |

### C.2 Adapted (changed to fit decisions already made or facts in the code)

| External idea | Change |
|---|---|
| Jinja2 + HTMX for guest and admin pages | Not adopted (adds two dependencies, rewrites most pages, and the console would still need client-side code). Server-injected shell instead; decision D1. |
| Database `tracks` table as the runtime link, filenames only an export | Kept filename token as the link (agreed; also what drop-in and rclone workflows use). Offered an optional rebuildable file-facts table instead. |
| Guest pages must never use a service worker | Accepted in part: no stale HTML or JSON; versioned static assets only; banner for offline. |
| Phone-last-4 and cookie verification for edits | Optional off-by-default switch, not a change of philosophy. |
| Reorder auto-save | Order already saves instantly; auto-run only the file renames and export. |
| Offline table assuming a venue LAN | Rewritten for a remote host (6.12). |
| Activity log with client IPs | Roles yes, IPs no by default. |
| Effort estimates | Dropped (unvalidated). |

### C.3 Rejected, with one-line reasons

| Suggestion | Reason |
|---|---|
| Preact or Alpine for the console | A state-machine module gives the safety without adding a framework (agreed principle 3). |
| Remap `M` to "push to live" and `Enter` to "cue next" | Breaks the operator's current muscle memory (mute, mark done) for no gain. |
| Delete the spreadsheet viewer now | The owner built it recently; downloads become prominent, retirement is Q17. |
| Full-state preset classes (`EventFlags`) | Would change presets from patches to full states, so `freeze` would flip payments and potluck; also silently changes `acoustic`, `karaoke_video`, `rehearsal` (6.4). |
| Flag renames (`stage_enabled`, `live_screen_enabled`, ...) in the sample | Would orphan stored settings; renames only through a migration. |
| Renames and `tracks` table in Phase 1 with the asset work | The owner's order is assets, then registry and shell, then redesign, then renames; the migration runner arrives in Phase 2, renames in Phase 5. |
| Hard-coded arm64 Tailwind binary in the Dockerfile | CI builds amd64 and arm64; pick by `TARGETARCH`. |
| Guest-visible "no Live link" (Live only for the venue) | Family and friends at home may follow along; kept as a guest destination that is hidden when the feature is off. |
| IP addresses in the activity log | Personal data; not needed. |

### C.4 Statements in the external plan that do not match the code (corrected here)

| Claim | Fact |
|---|---|
| "About 6,000 lines of JS" | 9,301 lines across 12 files; three files exceed 1,900 lines. |
| Forgetting Save Order loses the order change | The order is stored in the database on every drop; Save Order only renames files and rewrites exports (verified). |
| Clicking a queue row interrupts playback | A confirmation dialog appears first (`confirmIfPlaying`). A stronger deck model is still a fair improvement. |
| Vault should use IndexedDB blobs, stage monitor should use BroadcastChannel | Both already do. |
| Filename parsing breaks on Unicode normalization of Malayalam names | Linking uses the ASCII entry-id token, not the name part of the file name. |
| Reconcile "scans disk synchronously during requests" | True, throttled to once per 3 s; moved to a background task (N19). |
| Palette contrast "AA / AAA verified" | Two muted-text values and two accent uses fail; corrected (6.6). |
| Preset sample matches the current presets | It differs for `acoustic`, `karaoke_video`, `rehearsal`, `freeze` (6.4). |
| Server on the venue network | The owner's server is remote (6.12); the offline table was redone. |

### C.5 Claims not verified

The plan's performance numbers (500 readers, 20 writes per second, 8 ms p99), asset sizes (CSS under 25 KB gzipped, guest JS under 15 KB, HTMX 14 KB, WaveSurfer 28 KB, sprite 8 KB, fonts 48 KB and 32 KB), and
Lighthouse targets were not measured; they are carried only as proposed targets where stated.
