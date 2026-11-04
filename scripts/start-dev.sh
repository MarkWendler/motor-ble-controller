#!/usr/bin/env bash
# Start the Vite dev server without requiring pnpm on PATH.
# Vite 7 needs Node.js 20.19+ / 22.12+ (optional chaining, etc.).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/node-env.sh
source "$ROOT/scripts/node-env.sh"

if [[ ! -f "$ROOT/node_modules/vite/bin/vite.js" ]]; then
  echo "Error: dependencies missing. Run: ./scripts/setup.sh" >&2
  exit 1
fi

PORT="${PORT:-3000}"
echo "Starting Vite with: $NODE ($("$NODE" --version))"
echo "Open on your Windows machine (do not use start-chrome-linux.sh over remote):"
echo "  http://localhost:${PORT}/motor-ble-controller/"
echo ""

exec "$NODE" "$ROOT/node_modules/vite/bin/vite.js" --host --port "$PORT"
