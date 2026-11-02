#!/usr/bin/env bash
# Install dependencies without a global pnpm, so no sudo / npm -g is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/node-env.sh
source "$ROOT/scripts/node-env.sh"

PNPM_VERSION="10.4.1"
PNPM="$ROOT/.tooling/pnpm/bin/pnpm.cjs"

if [[ ! -f "$PNPM" ]]; then
  echo "Fetching pnpm ${PNPM_VERSION} into .tooling/ ..."
  tarball="$(mktemp -t pnpm-XXXXXX.tgz)"
  trap 'rm -f "$tarball"' EXIT
  curl -fsSL "https://registry.npmjs.org/pnpm/-/pnpm-${PNPM_VERSION}.tgz" -o "$tarball"
  rm -rf "$ROOT/.tooling/pnpm"
  mkdir -p "$ROOT/.tooling/pnpm"
  tar -xzf "$tarball" -C "$ROOT/.tooling/pnpm" --strip-components=1
fi

echo "Using Node: $NODE ($("$NODE" --version))"
# Keep the content-addressable store in-tree; $HOME may not be writable.
exec "$NODE" "$PNPM" install --store-dir "$ROOT/.pnpm-store" "$@"
