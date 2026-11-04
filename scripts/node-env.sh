# shellcheck shell=bash
# Sourced by the other scripts: locates a Node.js runtime and sets NODE.
# The system node may be far older than what Vite needs, so version is checked.

MIN_NODE_MAJOR=20

node_major_version() {
  local version
  version="$("$1" --version 2>/dev/null)" || return 1
  version="${version#v}"
  printf '%s' "${version%%.*}"
}

find_node() {
  local candidate major
  for candidate in \
    "${NODE:-}" \
    "$(command -v node 2>/dev/null || true)" \
    /usr/share/cursor/resources/app/resources/helpers/node \
    "$HOME/.nvm/versions/node"/*/bin/node
  do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    major="$(node_major_version "$candidate")" || continue
    [[ -n "$major" && "$major" -ge "$MIN_NODE_MAJOR" ]] || continue
    NODE="$candidate"
    return 0
  done
  return 1
}

if ! find_node; then
  echo "Error: Node.js ${MIN_NODE_MAJOR}+ not found (found: $(node --version 2>/dev/null || echo none))." >&2
  echo "Install Node ${MIN_NODE_MAJOR}+, or run this from a machine with Cursor installed (its bundled Node is used automatically)." >&2
  exit 1
fi

export NODE
