# Event & Track Manager

A high-reliability, cloud-native event production and stage playback system built for **EMA Paattukoottam** (Exton Malayali Association) and adaptable to any stage musical night, talent show, or concert.

It connects directly to **Google Sheets** for performer registration and live stage sequencing, uses **Google Shared Drive** as the ground truth for backing tracks and automated versioned archival, features an isolated **YouTube audio extraction worker** with JavaScript challenge solving, and delivers a low-latency stage sound playback console, performer intake portal, and live public audience schedule.

---

## Key Features

1. **Performer Intake & Track Upload Portal (`/`)**:
   - Mobile-first, searchable performer dropdown matching both primary singers and duet partners.
   - Intelligent handling for multiple performances per singer.
   - Missing song title detection with direct warning alerts.
   - Dual submission modes: Direct Audio Upload (MP3, WAV, M4A up to 200MB) with 320kbps stage-fidelity transcoding, or YouTube URL extraction.
   - Interactive waveform preview with instant play/pause and track duration metadata.
   - Live synchronization indicator displaying relative sync times (`● Synced Just now`).

2. **Public Live Stage Program (`/live`)**:
   - Pre-show countdown card (`[DAYS] [HOURS] [MINUTES] [SECONDS]`) driven by `EVENT_START_TIME`.
   - Automatic live transition to `🔴 LIVE PROGRAM` and `🎤 NOW ON STAGE` when performances begin.
   - **Up Next (Please Be Ready)**: Automatically highlights the immediate next eligible acts so performers know when to report backstage.
   - Stage eligibility filter: Only acts that are Acoustic/Live, Group, or have an audio track uploaded are cued for backstage readiness.
   - Multi-tier ordering configuration (`LIVE_ORDER_BY`) supporting readiness, sequence, and age group.
   - Auto-refreshes every 5 seconds with background polling.

3. **Stage Sound & Playback Console (`/console`)**:
   - PIN-protected control center (configured via `ADMIN_PIN`).
   - **Staged Reordering with Glowing Sync**:
     - Drag-and-drop re-sequencing runs with `<1ms` response time in local SQLite.
     - Out-of-sync banner appears and the `Refresh Data` button turns into a glowing amber **"Sync to Sheet"** button.
     - 1-click batch synchronization updates Google Sheets and renames files in Google Drive.
   - Full keyboard shortcuts (`Space` play/pause, `←`/`→` seek ±5s, `↓` cue next, `Enter` mark performed).
   - Instant local audio file download button for emergency playback in external players (VLC, QuickTime).
   - Dynamic metadata tags (e.g. `Junior`, `Senior`, `Solo`, `Duet`) derived from spreadsheet columns.
   - **Offline ZIP**: 1-click bundle of all sequenced tracks into a numbered ZIP archive for offline USB backup.

4. **100% Environment-Driven Architecture**:
   - Accepts full Google Sheets and Google Drive URLs copied directly from your browser.
   - Dynamic Column Header Matching: Automatically matches columns from Row 1 by normalized name, so rearranging columns never breaks the app.
   - Configurable entry ID prefix (`ENTRY_ID_PREFIX="PK"` or `"EMA"`).
   - Safe, non-destructive database management using a stable SQLite database file.

---

## Architecture Overview

```
                           [ Google Workspace ]
                        ┌────────────────────────┐
                        │ Google Sheet (Signups) │
                        │ Google Shared Drive    │
                        └───────────▲────────────┘
                                    │ HTTPS (Service Account)
                       ┌────────────▼────────────┐
                       │   Docker Compose Net    │
                       │                         │
[ Singers / Intake ] ──►  app (FastAPI :8000)    │
[ Audience / Live  ] ──►  ├── / (Intake)         │
[ Stage Sound Op   ] ──►  ├── /live (Audience)   │
                       │  ├── /console (Stage)   │
                       │  └── Audio Stream Proxy │
                       │           ▲             │
                       │           │ Internal API│
                       │  downloader (:8001)     │
                       │  ├── yt-dlp + ffmpeg    │
                       │  └── Deno EJS Engine    │
                       │                         │
                       │  Volume: /data/cache    │
                       └─────────────────────────┘
```

- **`app` container**: FastAPI backend serving the web interfaces, Google Workspace integration, SQLite cache, and HTTP 206 Partial Content byte-range audio streaming.
- **`downloader` container**: Dedicated worker running `yt-dlp`, `ffmpeg`, and `deno` with `yt-dlp-ejs` challenge solving. Isolated from the main app so it can be updated independently without interrupting stage audio.
- **Shared Audio Volume (`/data/cache`)**: Persists audio locally so playback is instantaneous and resilient against venue Wi-Fi drops.

---

## Multi-Architecture Docker Images (GHCR)

Pre-built multi-architecture Docker images (`linux/amd64` for standard Intel/AMD servers and `linux/arm64` for Apple Silicon / ARM servers) are published automatically to GitHub Container Registry on every commit to `main`:

- **Main App**: `ghcr.io/binuengoor/event-track-manager-app:latest`
- **Downloader**: `ghcr.io/binuengoor/event-track-manager-downloader:latest`

The included `docker-compose.yml` uses these images directly by default.

---

## Quickstart (Local Test & Preview)

To run the application locally using Docker:

```bash
# 1. Clone repository
git clone https://github.com/binuengoor/event-track-manager.git
cd event-track-manager

# 2. Copy environment template
cp .env.example .env

# 3. Launch containers
docker compose up -d
```

- **Performer Intake Portal**: [http://localhost:8088](http://localhost:8088)
- **Public Live Stage Program**: [http://localhost:8088/live](http://localhost:8088/live)
- **Stage Playback Console**: [http://localhost:8088/console](http://localhost:8088/console) (Default PIN: `2026`)

To build from source locally instead of pulling images from GHCR, uncomment the `build:` blocks in `docker-compose.yml` and run `docker compose up -d --build`.

---

## Google Workspace Setup (Production)

### 1. Google Cloud Service Account
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (e.g. `event-track-manager`).
3. Under **APIs & Services > Library**, enable:
   - **Google Sheets API**
   - **Google Drive API**
4. Under **APIs & Services > Credentials**:
   - Click **Create Credentials > Service Account** (e.g. `track-manager`).
   - Open the service account, go to **Keys**, and select **Add Key > Create new key > JSON**.
   - Save the file as `secrets/credentials.json`.

### 2. Share Sheet & Drive Folders
1. Open your Google Sheet and click **Share**. Add the service account email as **Editor**.
2. Open your Google Shared Drive:
   - Create two folders: `Active` (for current backing tracks) and `Archive` (for previous revisions).
   - Add the service account email to the Shared Drive with **Content Manager** or **Contributor** access.
3. In your `.env` file, paste the URLs:
   ```env
   GOOGLE_SHEET_URL="https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit"
   GOOGLE_DRIVE_ACTIVE_FOLDER="https://drive.google.com/drive/folders/<ACTIVE_FOLDER_ID>"
   GOOGLE_DRIVE_ARCHIVE_FOLDER="https://drive.google.com/drive/folders/<ARCHIVE_FOLDER_ID>"
   ```

---

## Hetzner Cloud Remote Deployment Guide

Follow these steps to deploy this application to a remote Hetzner Cloud virtual server (CX22 / CPX21 / CAX11 / CAX21):

### Step 1: Provision Server on Hetzner Cloud
1. In the [Hetzner Cloud Console](https://console.hetzner.cloud/), click **Add Server**.
2. Select your preferred location (e.g., Nuremberg, Falkenstein, or Ashburn).
3. Choose an OS image: **Ubuntu 24.04 LTS** or **Debian 12**.
4. Choose any server type (e.g., **CX22** x86_64 or **CAX11** ARM64 — both are fully supported via multi-arch images).
5. Add your SSH key and click **Create & Buy Now**.

### Step 2: Connect & Install Docker
SSH into your Hetzner server:
```bash
ssh root@<YOUR_HETZNER_SERVER_IP>
```

Install Docker and Docker Compose Plugin:
```bash
# Update packages
apt-get update && apt-get install -y ca-certificates curl git

# Install Docker using the official convenience script
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Verify Docker and Compose plugin installation
docker --version
docker compose version
```

### Step 3: Clone Repository & Configure Environment
```bash
# Clone the repository onto the server
git clone https://github.com/binuengoor/event-track-manager.git /opt/event-track-manager
cd /opt/event-track-manager

# Create the secrets directory
mkdir -p secrets

# Copy environment template
cp .env.example .env
```

Edit your `.env` configuration:
```bash
nano .env
```
Fill in your event details:
- `APP_TITLE`: Your event name.
- `EVENT_START_TIME`: Scheduled start (e.g. `09-28-2026 06:30PM`).
- `GOOGLE_SHEET_URL`: Full Google Sheet URL.
- `GOOGLE_DRIVE_ACTIVE_FOLDER`: Full Google Drive Active folder URL.
- `GOOGLE_DRIVE_ARCHIVE_FOLDER`: Full Google Drive Archive folder URL.
- `ADMIN_PIN`: Secret 4-digit PIN for the Stage Console.
- `PORT`: Set to `80` (or `8088` if using a reverse proxy).

### Step 4: Transfer Service Account Credentials & YouTube Cookies
From your local machine, copy your `credentials.json` and optional `yt_cookies.txt` directly to the server:
```bash
# Run this from your local computer:
scp secrets/credentials.json root@<YOUR_HETZNER_SERVER_IP>:/opt/event-track-manager/secrets/credentials.json

# Optional: transfer YouTube cookies for downloader
scp secrets/yt_cookies.txt root@<YOUR_HETZNER_SERVER_IP>:/opt/event-track-manager/secrets/yt_cookies.txt
```

### Step 5: Pull Images & Start Services
On the Hetzner server:
```bash
cd /opt/event-track-manager

# Pull pre-built multi-architecture images from GHCR
docker compose pull

# Start services in the background
docker compose up -d
```

### Step 6: Verify Deployment & Logs
Check running containers:
```bash
docker compose ps
```

Check health status:
```bash
curl http://localhost:8088/api/health
```

View live logs:
```bash
docker compose logs -f app
```

Access the app via your browser at `http://<YOUR_HETZNER_SERVER_IP>:8088` (or port 80 if configured).

---

## Setting Up HTTPS with Caddy or Nginx (Recommended)

To enable automatic SSL encryption and custom domain routing (e.g. `tracks.yourdomain.com`):

### Using Caddy (Easiest)
Install Caddy on your Hetzner host:
```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

Create `/etc/caddy/Caddyfile`:
```caddy
tracks.yourdomain.com {
    reverse_proxy localhost:8088
}
```

Restart Caddy:
```bash
systemctl restart caddy
```
Caddy will automatically provision and renew a free Let's Encrypt SSL certificate!

---

## Updating the Application on the Server

Whenever a new commit is pushed to GitHub, a new multi-arch image is automatically built and pushed to GHCR. To update your Hetzner server:

```bash
cd /opt/event-track-manager
git pull
docker compose pull
docker compose up -d
```

---

## Running Automated Tests

Run the test suite inside the running container:
```bash
docker exec event_track_manager_app pytest /app/tests
```

---

## License & Community
Maintained for **EMA Paattukoottam** (Exton Malayali Association). Built with FastAPI, Tailwind CSS, WaveSurfer.js, SQLite, and `yt-dlp`.
