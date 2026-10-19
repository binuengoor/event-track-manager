# Operator Runbook

For the organizer and the sound coordinator. Plain steps, in the order you need them.

Roles: **Organizer** (runs `/admin`, Admin PIN), **Sound operator** (runs `/console`, Admin or Operator PIN), **MC / venue screen** (shows `/live`).

---

## 1. Weeks before the event

1. Deploy (section 6). In `.env` set a strong `ADMIN_PIN`. Optionally set `OPERATOR_PIN` so a volunteer can run the console without admin access.
2. Open `/admin`. The **setup wizard** appears on a fresh event: pick the event type (or later use **Features & Presets**), then name, date, venue, potluck menu and rules.
3. Fine-tune in **Event Details**, **Sign-Up Rules** (songs per person, solos, audio/video, age groups) and **Food & Potluck** (paste a menu into *Quick add*).
4. Drop sponsor logos into `events/<EVENT_ID>/gallery/` (png/jpg/webp/gif). The live screen splits 70/30 automatically.
5. Optional cloud copy: set up the rclone sidecar (`rclone/README.md`) so the event folder is mirrored to Google Drive, Dropbox, a NAS, etc.
6. Share `https://<your-domain>/signup` with participants.

## 2. Pre-event checklist (2 days before)

Open `/admin`: the **Event readiness** strip at the top should be green (or only show things you accept).

| Check | How | Pass |
|---|---|---|
| Readiness strip | `/admin` top | No red items; PIN is not the default |
| App healthy | `curl https://<host>/api/health` | `"status":"healthy"` |
| Test signup | `/signup` with a fake name | appears in `/admin -> Participants` |
| Track upload | `/performer` upload a short MP3 | act shows **Ready** in `/console`; file in `events/<id>/tracks/` |
| YouTube link | paste a normal video URL | track appears (if "bot detection", add `secrets/yt_cookies.txt`) |
| Hand-delivered file | copy `PK-001_test.mp3` into `events/<id>/incoming/` | PK-001 shows Ready within seconds |
| Reorder + save | drag in `/console`, press **Save Order** | file names get the new numbers; `signups.xlsx` updates |
| Live screen | open `/live` on the venue display, cue an act in the console | screen changes within a second or two |
| Operator PIN | log in to `/console` with it | works; `/admin` refuses it |
| Export opens | open `events/<id>/signups.xlsx` | 4 tabs: Performances, Run Sheet, Potluck, Participants |
| Cloud copy (if used) | check the remote folder | tracks, xlsx and `backups/` appear |
| Delete test data | `/admin -> Participants` | |

## 3. Event day: before doors (sound operator)

1. Open `/console`, log in. Keep this tab open all night.
2. Press **Cache All Offline** so every track is stored in the browser. This protects against venue Wi-Fi drops.
3. Click **Offline ZIP** and save it to a USB stick (numbered tracks plus `00_Show_Run_Sheet.txt`). This is the emergency plan (play from VLC).
4. Resolve every "song title missing" or "no track" row (readiness strip lists them); ask performers to fix it on the Performer Hub, or drop the file in `incoming/` named with the entry id.
5. Finalize order: drag rows, then press **Save Order**.
6. Optional: apply the **Show-day freeze** preset to lock sign-ups and edits.
7. Put `/live` on the venue screen (full-screen, F11).

## 4. During the show (sound operator)

| Action | Key / button |
|---|---|
| Cue next | `↓` or **Cue Next** (loads, does not autoplay) |
| Play / pause | `Space` |
| Seek ±5 s | `←` / `→` |
| Mute | `M` |
| Mark performed | `Enter` or **Done** |
| Hold / skip | **Hold** button in the player bar |
| Stage note | **+ Note** (shows on `/live` immediately) |
| Uncue | **Uncue** (returns the act to the queue) |

Rules of thumb:
- If a warning modal appears while audio is playing, read it. It exists to stop you cutting the music.
- If the network dies, keep going. Cached tracks and the console keep working; changes sync when it returns.
- If a track will not play, use **Download** on the player bar and play it externally, or use the USB ZIP.
- Never close the `/console` tab mid-show. Cue state survives a reload, but audio stops.

## 5. After the event

0. **Spreadsheet** tab: download the final Excel (or CSV bundle). **Payments** tab: confirm who has paid and save.

1. `/admin -> Backup & Sync -> Force Backup Now` (writes `signups.xlsx/csv`, `potluck.csv` and a database snapshot).
2. Copy or zip the whole `events/<EVENT_ID>/` folder. That is the complete archive (database snapshot, signups, every track).
3. To start a new event: `/admin` -> **New event** (copies rules and the potluck menu if you want; never sign-ups). The old event stays untouched and can be re-opened from the Event bar any time.
4. To free disk space: **Manage -> Clear media** on the finished event (type its id to confirm). Sign-ups, potluck and payments are kept; only audio/video files are deleted.

## 6. Deploy / update

```bash
# first time
git clone https://github.com/binuengoor/event-track-manager.git /opt/event-track-manager
cd /opt/event-track-manager && cp .env.example .env && nano .env
mkdir -p events && chown -R 1000:1000 events         # the container runs as uid 1000
docker compose pull && docker compose up -d
curl http://localhost:8088/api/health

# update
git pull && docker compose pull && docker compose up -d
```

HTTPS with Caddy (`/etc/caddy/Caddyfile`), then `systemctl restart caddy`:

```caddy
tracks.example.com {
    reverse_proxy localhost:8088
}
```

Logs: `docker compose logs -f app` and `docker compose logs -f downloader`.

## 7. Handling tracks by hand

Files are matched to acts by the **entry id** in the file name (the id shown in the console, e.g. `PK-004`).

| I want to... | Do this |
|---|---|
| Attach a file I already have | Copy `PK-004_anything.mp3` into `events/<id>/incoming/` (or the remote `incoming/` if rclone is on) |
| Replace a track | Upload again on the Performer Hub, or drop a new file named with the same id. The old one moves to `tracks/_archive/` |
| Remove a track | Move the file out of `tracks/`; the act goes back to "Pending" |
| Fix numbering | Press **Save Order** in the console |

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "YouTube blocked automated download" | Bot detection | Add `secrets/yt_cookies.txt`, `docker compose restart downloader`; or ask for a file upload |
| Readiness: "YouTube link extractor not reachable" | Downloader container down | `docker compose up -d downloader` (file uploads still work) |
| Readiness: "Event folder not writable" | Permissions on the mapped folder | `chown -R 1000:1000 events` |
| Dropped file stays in `incoming/` | Name has no entry id, or the id is unknown | Rename it to include the id (e.g. `PK-004_song.mp3`) |
| Track shows "Pending" though I added it | File is not in `tracks/` or has no entry id in its name | Check the name; it must contain the id between underscores |
| `signups.xlsx` looks out of date | Export is debounced (10 s) | **Export signups now** in Backup & Sync |
| Edits to the spreadsheet disappear | The spreadsheet is an export | Change data in the app (`/admin`), not the file |
| Nothing reaches the cloud | rclone sidecar not running or remote misconfigured | `docker compose --profile sync logs rclone-sync`; re-run `rclone config` |
| Forgot PIN | | Edit `ADMIN_PIN` in `.env`, `docker compose up -d` |
| "Too many failed attempts" (HTTP 429) | Rate limit (8 per client / 100 overall per 5 min) | Wait 5 minutes, or `docker compose restart app` |
| Live screen frozen | Network on the display device | Reload `/live` |
| Old audio plays in the console | Browser vault | Console **Clear Cache** then re-cache the track |

## 9. Privacy rules for organizers

- Phone numbers are visible only in `/admin` and in the exported files (`signups.xlsx/csv`) and database snapshots. Share the folder or cloud remote with organizers only.
- Do not paste phone numbers into stage notes, song titles or event notes; those fields are shown publicly.
- Delete test registrations before announcing the signup link.

## 10. Refreshing the README screenshots

Uses real Chrome headless and the demo seed (fictional names; never run it against a real event).

```bash
# 1. start an isolated instance (its own event folder, port 8770)
mkdir -p /tmp/etm/scratch
EVENTS_DIR=/tmp/etm CACHE_DIR=/tmp/etm/scratch ADMIN_PIN=4321 \
  .venv/bin/python -m uvicorn app.main:app --port 8770 &
# 2. seed demo signups and cue one act
.venv/bin/python docs/seed_demo_data.py
# 3. capture (needs: npm i puppeteer-core, Google Chrome, ffmpeg for the GIF)
mkdir -p out frames && node docs/screenshots.js
ffmpeg -y -framerate 8 -i frames/f%03d.jpg -vf "scale=300:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" out/aurora.gif
cp out/*.jpg out/aurora.gif docs/images/
```
