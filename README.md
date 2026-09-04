# EMA Paattukoottam — Event & Track Manager

A modern, high-reliability web application built for **EMA Paattukoottam** (Exton Malayali Association) musical nights. It connects directly to Google Sheets (performer registration & stage sequencing) and Google Shared Drive (audio file ingestion & automated versioned archival), features an isolated YouTube audio extraction microservice with external JavaScript challenge solving, and delivers a low-latency stage playback console and real-time public live schedule.

---

## Key Features

1. **Singer Intake & Track Upload Portal (`/`)**:
   - Mobile-first, searchable performer dropdown.
   - Intelligent handling for multiple performances per singer and duets.
   - Missing song title detection with direct alert prompts.
   - Dual submission modes: Direct Audio Upload (MP3, WAV, M4A up to 200MB) or YouTube URL extraction.
   - Interactive waveform preview with instant play/pause and track metadata (file size, duration).

2. **Public Live Stage Program (`/live`)**:
   - Pre-show countdown hero card (`[DAYS] [HOURS] [MINUTES] [SECONDS]`) driven by `EVENT_START_TIME`.
   - Automatic live transition to `🔴 LIVE PROGRAM` and `🎤 NOW ON STAGE` when performances begin.
   - **Up Next (Please Be Ready)**: Automatically highlights the immediate next eligible acts so performers know when to report backstage.
   - Stage eligibility filter: Only acts that are Acoustic/Live, Group, or have an audio track uploaded are queued backstage.
   - Live audience schedule with search and collapsible completed acts counter.
   - Auto-refreshes every 5 seconds.

3. **Stage Sound & Playback Console (`/console`)**:
   - PIN-protected control center (default PIN: `2026`).
   - Waveform audio player with keyboard shortcuts (`Space`, `←`/`→` seek ±5s, `↓` cue next, `Enter` mark performed).
   - Drag-and-drop re-sequencing that updates both the Google Sheet and canonical file names in Google Drive.
   - Track status management (Upcoming, On Stage, Performed, On Hold/Skip).
   - Dynamic metadata tags (e.g. `Junior`, `Senior`, `Group`) from generic spreadsheet columns.
   - **Offline ZIP**: 1-click bundle of all sequenced tracks into a ZIP archive for offline USB backup.

4. **100% Environment-Driven Architecture**:
   - Accepts full Google Sheets and Google Drive URLs directly from your browser.
   - Dynamic Column Header Matching: Automatically matches columns from Row 1 by normalized name, so rearranging columns never breaks the app.
   - Dynamic event branding (`APP_TITLE`, `APP_SUBTITLE`).

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
                       │  └── Deno Challenge     │
                       │                         │
                       │  Volume: /data/cache    │
                       └─────────────────────────┘
```

- **`app` container**: FastAPI backend serving the mobile-friendly intake portal (`/`), public live stage schedule (`/live`), and stage console (`/console`), while proxying byte-range audio streams directly from a local volume cache or Google Drive.
- **`downloader` container**: Dedicated worker running `yt-dlp`, `ffmpeg`, and `deno` with `yt-dlp-ejs` challenge solving. Isolated from the main app so it can be rebuilt or updated independently in seconds without disrupting stage playback.
- **Shared Audio Volume (`/data/cache`)**: Persists audio locally so stage playback is instantaneous and impervious to venue Wi-Fi drops.

---

## Quickstart (Local Test & Preview)

You can run and test the complete application immediately:

```bash
# 1. Clone repository and navigate to folder
git clone https://github.com/your-org/event-track-manager.git
cd event-track-manager

# 2. Copy environment file
cp .env.example .env

# 3. Start containers
docker compose up --build
```

- **Performer Intake Portal**: Open [http://localhost:8088](http://localhost:8088)
- **Public Live Stage Program**: Open [http://localhost:8088/live](http://localhost:8088/live)
- **Stage Playback Console**: Open [http://localhost:8088/console](http://localhost:8088/console) (Default PIN: `2026`)

---

## Google Workspace Setup Guide (Production)

### 1. Google Cloud Service Account
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `ema-paattukoottam`).
3. Navigate to **APIs & Services > Library**, search for and enable:
   - **Google Sheets API**
   - **Google Drive API**
4. Navigate to **APIs & Services > Credentials**:
   - Click **Create Credentials > Service Account**.
   - Name it `track-manager` and click **Create and Continue**.
   - Click on the created service account, go to the **Keys** tab, click **Add Key > Create new key > JSON**.
   - Save the downloaded file to `secrets/credentials.json`.

### 2. Share Google Sheet and Google Shared Drive
1. Open your Google Sheet in your browser and click **Share**.
2. Add the service account email (e.g. `track-manager@ema-paattukoottam.iam.gserviceaccount.com`) as **Editor**.
3. Open your **Google Shared Drive**:
   - Create two folders inside: `Active` and `Archive`.
   - Click **Manage members** on the Shared Drive and add the service account email with **Content Manager** or **Contributor** permission.
4. Copy full URLs directly from your browser into `.env`:
   - `GOOGLE_SHEET_URL="https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit"`
   - `GOOGLE_DRIVE_ACTIVE_FOLDER="https://drive.google.com/drive/folders/<ACTIVE_FOLDER_ID>"`
   - `GOOGLE_DRIVE_ARCHIVE_FOLDER="https://drive.google.com/drive/folders/<ARCHIVE_FOLDER_ID>"`

---

## Dynamic Google Sheet Schema

The application automatically resolves columns from **Row 1** using normalized name matching (ignoring extra whitespace, linebreaks, and parenthetical instructions).

| Purpose | Default Header | Description |
|:---|:---|:---|
| Primary Performer | `Singer (1)` | Main singer or performer |
| Duet Partner | `Singer (2)` | Collaborator name if duet |
| Performance Type | `Solo/Duet/Group` | Solo, Duet, Group, or Acoustic |
| Sequence Order | `Sequence` | Numerical stage order (1, 2, 3...) |
| Song Name | `Song Name` | Title of the track |
| Movie / Album | `Movie/Album Name` | Optional context |
| Performance Status | `Performance Status` | Managed by Console (`Upcoming`, `On Stage`, `Performed`, `On Hold`) |
| Track Uploaded | `Track Status` / `Track Uploaded` | Managed by App (`Yes` / `Pending` / `Acoustic`) |
| Duration | `Duration (Minutes)` | Managed by App (`MM:SS`) |
| Extra Tags | `Age Group (Junior/Senior)` | Displayed as badge tags in Console (`Junior`, `Senior`, etc.) |

---

## YouTube Extraction & Cookies

Modern YouTube requires External JavaScript (EJS) challenge solving. The `downloader` microservice automatically includes:
1. `deno` JavaScript runtime and `yt-dlp-ejs` challenge solver library.
2. Cookie authentication via `secrets/yt_cookies.txt` (or `cookies.txt`).
3. Automatic copying to a writable session buffer in `/tmp` to support read-only Docker secret mounts.

### Updating `yt-dlp`
```bash
docker compose build --no-cache downloader && docker compose restart downloader
```

---

## Live Stage Console (`/console`)

The Stage Console provides a dark-mode, high-contrast dashboard for sound coordinators:
- **PIN Gate**: Configurable via `ADMIN_PIN` in `.env` (default `2026`).
- **Low-Latency Streaming**: Directly streams audio from the local volume cache via HTTP 206 Partial Content byte ranges.
- **Stage Keyboard Shortcuts**:
  - `Space`: Play / Pause
  - `←` / `→`: Seek ±5 seconds
  - `↓`: Cue next eligible track in sequence
  - `Enter`: Mark current performance as **Performed** and cue next item
- **Offline Contingency Button**:
  - Click **"Offline ZIP"** to immediately bundle all active tracks in chronological order (`01_01_PK-002_Joshua_Sohan_Puthumazha.mp3`) with an offline manifest for emergency USB thumb drive playback.

---

## Running Automated Tests

```bash
docker exec event_track_manager_app pytest /app/tests
```

---

## License & Community
Maintained for **EMA Paattukoottam** (Exton Malayali Association). Built with FastAPI, Tailwind CSS, WaveSurfer.js, and `yt-dlp`.
