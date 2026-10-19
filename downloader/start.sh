#!/bin/sh
# Downloader entrypoint: keeps yt-dlp current without rebuilding the image.
#   - at start, and every YTDLP_UPDATE_HOURS (default 24), upgrades yt-dlp + yt-dlp-ejs into the user site
#     (/home/appuser/.local, which takes precedence over the version baked into the image)
#   - if the upgrade changed the version, the API process is restarted to load it
#   - if the upgrade fails (offline venue, PyPI down) the previous/bundled version keeps working
# Disable with YTDLP_AUTO_UPDATE=false.
set -u

AUTO="${YTDLP_AUTO_UPDATE:-true}"
HOURS="${YTDLP_UPDATE_HOURS:-24}"

version() { python -c "import yt_dlp; print(yt_dlp.version.__version__)" 2>/dev/null || echo unknown; }

update() {
  [ "$AUTO" = "true" ] || return 0
  echo "[downloader] checking for yt-dlp updates (current $(version))"
  pip install --no-cache-dir --user --upgrade --quiet yt-dlp yt-dlp-ejs 2>&1 | tail -2 || echo "[downloader] update failed, keeping $(version)"
}

update
echo "[downloader] starting with yt-dlp $(version)"
uvicorn main:app --host 0.0.0.0 --port 8001 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null; exit 0' TERM INT

while true; do
  # sleep in short slices so the trap above reacts quickly
  i=0; total=$((HOURS * 3600))
  while [ $i -lt $total ]; do sleep 30 & wait $!; i=$((i + 30)); kill -0 $API_PID 2>/dev/null || exit 1; done
  before="$(version)"
  update
  after="$(version)"
  if [ "$before" != "$after" ]; then
    echo "[downloader] yt-dlp updated $before -> $after, restarting API"
    kill $API_PID 2>/dev/null; wait $API_PID 2>/dev/null
    uvicorn main:app --host 0.0.0.0 --port 8001 &
    API_PID=$!
  fi
done
