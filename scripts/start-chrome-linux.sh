#!/usr/bin/env bash
# Launch Google Chrome with flags required for Web Bluetooth on Linux.
# Uses a dedicated profile so flags apply even if Chrome is already running.
# See: https://github.com/WebBluetoothCG/web-bluetooth/blob/master/implementation-status.md
#
# Remote / Windows users: do NOT run this script. It opens Chrome on the Linux host.
# On Windows, open Chrome yourself to:
#   http://localhost:3000/motor-ble-controller/
# (Cursor Remote SSH will forward port 3000), or use scripts/start-chrome-windows.bat

set -euo pipefail

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}/motor-ble-controller/"
PROFILE_DIR="${CHROME_BT_PROFILE_DIR:-$HOME/.config/motor-ble-controller-chrome}"

if [[ -n "${SSH_CONNECTION:-}${SSH_CLIENT:-}${SSH_TTY:-}" ]] && [[ "${FORCE_HOST_CHROME:-}" != "1" ]]; then
  echo "Detected remote SSH session."
  echo "This script opens Chrome on the Linux host — skip it for Windows remote use."
  echo ""
  echo "1) Keep the Vite server running on Linux:  ./scripts/start-dev.sh"
  echo "2) On your Windows PC, open Chrome to:"
  echo "   $URL"
  echo ""
  echo "Or double-click: scripts/start-chrome-windows.bat"
  echo "To force host Chrome anyway: FORCE_HOST_CHROME=1 $0"
  exit 0
fi

CHROME=""
for candidate in google-chrome-stable google-chrome chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then
    CHROME="$candidate"
    break
  fi
done

if [[ -z "$CHROME" ]]; then
  echo "Error: Google Chrome or Chromium not found." >&2
  echo "Install with: sudo apt install google-chrome-stable" >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

echo "Opening Web Bluetooth app in $CHROME"
echo "URL: $URL"
echo "Profile: $PROFILE_DIR"
echo ""
echo "Linux requires Chrome experimental Web Platform features for Web Bluetooth."
echo "This script starts a dedicated Chrome window with the required flags."
echo ""

exec "$CHROME" \
  --enable-experimental-web-platform-features \
  --enable-features=WebBluetooth \
  --user-data-dir="$PROFILE_DIR" \
  --new-window \
  "$URL"
