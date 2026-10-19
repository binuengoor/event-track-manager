#!/bin/sh
# Starts as root only to make the mapped folders writable, then drops to the unprivileged app user.
# This is what makes `volumes: ./events:/events` work on a fresh Linux host (Docker creates that folder as root).
set -e
if [ "$(id -u)" = "0" ]; then
  for d in /events /data; do
    if [ -d "$d" ] && [ "$(stat -c %u "$d" 2>/dev/null)" != "1000" ]; then
      chown -R appuser:appuser "$d" 2>/dev/null || echo "[entrypoint] could not change owner of $d (continuing)"
    fi
  done
  exec gosu appuser "$@"
fi
exec "$@"
