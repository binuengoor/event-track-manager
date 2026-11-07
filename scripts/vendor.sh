#!/bin/sh
# Re-fetch the pinned third-party browser libraries into app/static/vendor/ and verify SHA-256.
#   scripts/vendor.sh           re-download and verify against CHECKSUMS.sha256 (fails on mismatch)
#   scripts/vendor.sh --update  re-download and rewrite CHECKSUMS.sha256 (after bumping a version below)
set -eu

WAVESURFER_VERSION=7.12.12
MARKED_VERSION=18.1.3
LUCIDE_VERSION=1.70.0

DIR="$(cd "$(dirname "$0")/.." && pwd)/app/static/vendor"
mkdir -p "$DIR"
cd "$DIR"

fetch() { curl -fsSL --retry 3 -o "$1" "$2"; }

fetch wavesurfer.min.js "https://unpkg.com/wavesurfer.js@${WAVESURFER_VERSION}/dist/wavesurfer.min.js"
fetch marked.umd.js "https://unpkg.com/marked@${MARKED_VERSION}/lib/marked.umd.js"
fetch lucide.min.js "https://unpkg.com/lucide@${LUCIDE_VERSION}/dist/umd/lucide.min.js"

if [ "${1:-}" = "--update" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum lucide.min.js marked.umd.js wavesurfer.min.js > CHECKSUMS.sha256
  else
    shasum -a 256 lucide.min.js marked.umd.js wavesurfer.min.js > CHECKSUMS.sha256
  fi
  echo "CHECKSUMS.sha256 rewritten"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c CHECKSUMS.sha256
else
  shasum -a 256 -c CHECKSUMS.sha256
fi
