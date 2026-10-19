# Operator Runbook

For the organizer and the sound coordinator. Plain steps, in the order you need them.

Roles: **Organizer** (runs `/admin`), **Sound operator** (runs `/console`), **MC / venue screen** (shows `/live`).

---

## 1. Weeks before the event

1. Deploy (README quickstart or Hetzner steps below). Set a strong `ADMIN_PIN` in `.env`. Never keep `2026`.
2. Put the real event details in `.env` once, then fine-tune in `/admin → Event Details`.
3. Share the Google Sheet and Drive folders with the service-account email (README, Google setup).
4. In `/admin` pick a preset: `musical_night` (full), `acoustic`, `competition`, or `potluck`.
5. Add food groups and items under `/admin → Food` (or leave the seeded catalog).
6. Drop sponsor logos/flyers into `./data/gallery` (png/jpg/webp/gif). The live screen splits 70/30 automatically.
7. Share `https://<your-domain>/signup` with participants.

## 2. Pre-event checklist (do this 2 days before; this is the only real-Google test)

| Check | How | Pass |
|---|---|---|
| App healthy | `curl https://<host>/api/health` | `"status":"healthy"`, `"mock_mode":false` |
| Downloader up | same call, `downloader.status` | `healthy` |
| PIN works, wrong PIN is refused | log in at `/console` | |
| Test signup | `/signup` with a fake name | appears in `/admin → Participants` |
| Track upload | `/performer` → upload a short MP3 | file appears in Drive `Active/`, Sheet row shows Uploaded |
| YouTube link | paste a normal video URL | track appears; if "bot detection", add `secrets/yt_cookies.txt` |
| Backup | `/admin → Backup → Force Backup Now` | status success, `<event_id>_backup` sheet updated |
| Reorder + sync | drag in `/console`, press **Sync to Sheet** | Sheet Sequence column and Drive file prefixes change |
| Live screen | open `/live` on the venue display | countdown shows, no phone numbers anywhere |
| Delete the test data | `/admin → Participants` | |

## 3. Event day: before doors (sound operator)

1. Open `/console`, enter the PIN. Keep this tab open all night.
2. Press **Cache All Offline** so every track is stored in the browser. This protects against venue Wi-Fi drops.
3. Click **Offline ZIP** and save the file to a USB stick. It contains numbered tracks plus `00_Show_Run_Sheet.txt`. This is your emergency plan (play from VLC).
4. Resolve every "song title missing" or "no track" row; ask the performer to fix it at `/performer`.
5. Finalize order: drag rows, then press the amber **Sync to Sheet**.
6. Optional: set preset `freeze` in `/admin` to lock signups and edits once the order is final.
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

1. `/admin → Backup → Force Backup Now`, then confirm the backup sheet.
2. Download the database: `docker cp event_track_manager_app:/db/event_data.db ./event_data_$(date +%F).db`.
3. Download the activity log if you need an audit trail.
4. Apply preset `freeze`. To start a new event, change `EVENT_ID`, use a new Sheet/Drive folders, and start with empty volumes (`docker compose down -v` **deletes all data: back up first**).

## 6. Deploy / update (Hetzner or any Docker host)

```bash
# first time
git clone https://github.com/binuengoor/event-track-manager.git /opt/event-track-manager
cd /opt/event-track-manager && mkdir -p secrets data && cp .env.example .env && nano .env
# put secrets/credentials.json (and optional secrets/yt_cookies.txt) in place
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

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "YouTube blocked automated download" | Bot detection | Add `secrets/yt_cookies.txt`, `docker compose restart downloader`; or ask for a file upload |
| Downloader `unavailable` in `/api/health` | Container down or yt-dlp broken | `docker compose pull downloader && docker compose up -d downloader` |
| Sheet is not updating | Sync is one-way and debounced (10 s) | Press **Sync to Sheet** or **Force Backup Now**; check `/admin → Backup` error text |
| Backup says error | Service account lost access, wrong folder | Re-share Sheet/folders with the service-account email |
| Track shows "Pending" though uploaded | Drive file removed from `Active/` | Re-upload; the app reconciles Drive every ~15 s |
| Old audio plays | Browser cache | Console **Clear Cache** then re-cache the track |
| Edits to the Sheet disappear | Sheet is export only | Change data in the app (`/admin`), not the Sheet |
| Forgot PIN | | Edit `ADMIN_PIN` in `.env`, `docker compose up -d` |
| Login says "Too many failed attempts" (HTTP 429) | Rate limit (8 per client / 100 overall per 5 min) | Wait 5 minutes, or `docker compose restart app` to clear it |
| Everything is in mock mode | Missing/invalid `secrets/credentials.json` | Fix the file, restart; `/api/health` must say `mock_mode:false` |
| Live screen frozen | Network on the display device | Reload `/live` (it polls every 5 s) |

## 8. Privacy rules for organizers

- Phone numbers are visible only in `/admin` and the Google Sheet/backup. Restrict Sheet sharing to organizers.
- Do not paste phone numbers into stage notes, song titles or event notes; those fields are shown publicly.
- Delete test registrations before announcing the signup link.

## 9. Refreshing the README screenshots

Uses real Chrome headless and the demo seed (fictional names; never run it against a real event).

```bash
# 1. start an isolated mock instance (separate data folders, port 8770)
mkdir -p /tmp/etm/cache /tmp/etm/db
MOCK_GOOGLE_API=true CACHE_DIR=/tmp/etm/cache DB_DIR=/tmp/etm/db DATA_DIR=/tmp/etm ADMIN_PIN=4321 \
  .venv/bin/python -m uvicorn app.main:app --port 8770 &
# 2. seed demo signups and cue one act
.venv/bin/python docs/seed_demo_data.py
# 3. capture (needs: npm i puppeteer-core, Google Chrome, ffmpeg for the GIF)
mkdir -p out frames && node docs/screenshots.js
ffmpeg -y -framerate 8 -i frames/f%03d.jpg -vf "scale=300:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" out/aurora.gif
cp out/*.jpg out/aurora.gif docs/images/
```
