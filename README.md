# EMA Paattukoottam — Event & Track Manager

A specialized, lightweight web application built for **EMA Paattukoottam** (Exton Malayali Association) quarterly musical nights. It connects directly to Google Sheets (registration & live stage sequencing) and Google Shared Drive (audio files & versioned archives), features an isolated, auto-updatable `yt-dlp` microservice for YouTube audio extraction, and delivers a low-latency live stage playback console with offline contingency.

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
[ Stage Sound Op   ] ──►  ├── UI: /, /admin      │
                       │  └── Audio Stream Proxy │
                       │           ▲             │
                       │           │ Internal API│
                       │  downloader (:8001)     │
                       │  └── yt-dlp + ffmpeg    │
                       │                         │
                       │  Volume: /data/cache    │
                       └─────────────────────────┘
```

- **`app` container**: FastAPI backend serving the mobile-friendly intake portal (`/`), live stage console (`/admin`), and proxying byte-range audio streams directly from a local volume cache or Google Drive.
- **`downloader` container**: Dedicated worker running `yt-dlp` and `ffmpeg`. Isolated from the main app so it can be rebuilt or updated independently in seconds without disrupting stage playback.
- **Shared Audio Volume (`/data/cache`)**: Persists audio locally so stage playback is instantaneous and impervious to venue Wi-Fi throttling.

---

## Quickstart (Local Test & Preview)

You can run and test the complete application immediately **without needing Google Cloud credentials** using the built-in Mock Mode:

```bash
# 1. Clone repository and navigate to folder
cd event-track-manager

# 2. Copy environment file
cp .env.example .env

# 3. Start containers in mock/preview mode
docker compose up --build
```

- **Performer Intake Portal**: Open [http://localhost:8000](http://localhost:8000)
- **Stage Playback Console**: Open [http://localhost:8000/admin](http://localhost:8000/admin) (Default PIN: `2026`)

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
4. Copy the IDs from your browser URLs:
   - **Sheet ID**: From `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`
   - **Active Folder ID**: From `https://drive.google.com/drive/folders/<ACTIVE_FOLDER_ID>`
   - **Archive Folder ID**: From `https://drive.google.com/drive/folders/<ARCHIVE_FOLDER_ID>`

### 3. Configure `config.yaml`
Update `config.yaml` with your event details and IDs:

```yaml
event:
  id: "paattukoottam-q3-2026"
  name: "EMA Paattukoottam - Q3 Musical Night"

google:
  service_account_json_path: "/secrets/credentials.json"
  sheet_id: "1abcYOUR_GOOGLE_SHEET_ID_xyz"
  sheet_range: "Signups!A2:I"
  drive_folders:
    active_folder_id: "1defYOUR_ACTIVE_FOLDER_ID"
    archive_folder_id: "1ghiYOUR_ARCHIVE_FOLDER_ID"
```

---

## Google Sheet Schema

The Google Sheet serves as the single source of truth for performer sign-ups and live sequencing.

| Col | Index | Header | Example | Description |
|:---:|:---:|:---|:---|:---|
| **A** | `0` | `Entry_ID` | `PK-001` | Unique row identifier |
| **B** | `1` | `Performer_Name` | `Rahul Nair` | Primary singer |
| **C** | `2` | `Performance_Type` | `Solo` / `Duet` / `Acoustic` | Type of performance |
| **D** | `3` | `Partner_Name` | `Ananya Menon` | Collaborator if Duet |
| **E** | `4` | `Song_Title` | `Tum Hi Ho` | Name of the song |
| **F** | `5` | `Sequence_Order` | `1` | Order of performance on stage |
| **G** | `6` | `Track_Status` | `Pending` / `Uploaded` / `Performed` | Managed by application |
| **H** | `7` | `Drive_File_ID` | `1xyz987abc` | Active Google Drive File ID |
| **I** | `8` | `Last_Updated` | `2026-09-03T14:30:00` | ISO timestamp of last upload |

*Note: Column positions can be changed in `config.yaml` under `columns:` if your sheet layout differs.*

---

## YouTube Extraction & Updating `yt-dlp`

### Handling YouTube Bot Detection (Cookies)
Datacenter cloud IPs (AWS, DigitalOcean, Hetzner, etc.) are sometimes challenged by YouTube's anti-bot systems.
To bypass this:
1. Export your YouTube cookies from a standard secondary browser profile using a browser extension like *“Get cookies.txt LOCALLY”*.
2. Save the file to `./secrets/cookies.txt`.
3. The downloader container automatically detects this file and attaches `--cookies /secrets/cookies.txt`.

### Updating `yt-dlp` in 10 Seconds
When YouTube modifies its video player ciphers, update just the downloader container without touching the stage playback application:
```bash
docker compose build --no-cache downloader && docker compose restart downloader
```

---

## Live Stage Console (`/admin`)

The Stage Console provides a dark-mode, high-contrast dashboard for sound coordinators:
- **PIN Gate**: Configurable via `ADMIN_PIN` in `.env` (default `2026`).
- **Low-Latency Streaming**: Directly streams audio from the local volume cache via HTTP 206 Partial Content byte ranges.
- **Stage Keyboard Shortcuts**:
  - `Space`: Play / Pause
  - `←` / `→`: Seek ±5 seconds
  - `↓`: Cue next track in sequence
  - `Enter`: Mark current performance as **Performed** and cue next item
- **Offline Contingency Button**:
  - Click **"Offline ZIP"** to immediately bundle all active tracks in chronological order (`01_Rahul_Song.mp3`, `02_Ananya_Song.mp3`) with a sequence manifest for backup playback on a USB thumb drive.

---

## Production Deployment (Reverse Proxy)

### Nginx Configuration Example
```nginx
server {
    listen 443 ssl http2;
    server_name tracks.emaassociation.org;

    ssl_certificate /etc/letsencrypt/live/tracks.emaassociation.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tracks.emaassociation.org/privkey.pem;

    client_max_body_size 60M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Enable byte-range streaming buffer pass-through
        proxy_buffering off;
    }
}
```

---

## Running Automated Tests

```bash
uv run --with-requirements app/requirements.txt pytest tests
```

---

## License & Community
Maintained for **EMA Paattukoottam** (Exton Malayali Association). Built with FastAPI, Tailwind CSS, and `yt-dlp`.
