#!/usr/bin/env bash
# Installs the lm-computer plugin into LM Studio on Linux.
# Run from the repository root:
#   ./install.sh
# or:
#   bash install.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

say() {
  printf '\033[1;36m%s\033[0m\n' "$*"
}

warn() {
  printf '\033[1;33m%s\033[0m\n' "$*" >&2
}

die() {
  printf '\033[1;31m%s\033[0m\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./install.sh

Installs lm-computer into LM Studio for the current user.

Environment:
  LMS_BIN   path to the lms CLI (default: lms from PATH or ~/.lmstudio/bin/lms)

The script does not use sudo. The plugin runs inside LM Studio; LM Studio must
be installed and the lms CLI must be available.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ "$(uname -s)" == "Linux" ]] || die "This installer targets Linux (Ubuntu)."
[[ -f manifest.json && -f package.json ]] ||
  die "Run install.sh from the lm-computer repository root."

LMS_BIN="${LMS_BIN:-}"
if [[ -z "$LMS_BIN" ]]; then
  if command -v lms >/dev/null 2>&1; then
    LMS_BIN="$(command -v lms)"
  elif [[ -x "$HOME/.lmstudio/bin/lms" ]]; then
    LMS_BIN="$HOME/.lmstudio/bin/lms"
  else
    die "The lms CLI was not found. Start LM Studio, or set LMS_BIN=/path/to/lms."
  fi
fi
[[ -x "$LMS_BIN" ]] || die "lms is not executable: $LMS_BIN"

say "LM Studio CLI: $LMS_BIN"
"$LMS_BIN" --version || warn "Could not read the lms version."

if command -v npm >/dev/null 2>&1; then
  say "Installing npm dependencies..."
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  say "Building the plugin..."
  npm run build
else
  [[ -f dist/index.js ]] ||
    die "dist/index.js is missing and npm is not available. Install Node.js/npm and retry."
  warn "npm was not found; using the existing dist/ build."
fi

[[ -f dist/index.js ]] || die "Build failed: dist/index.js is missing."

say "Installing lm-computer into LM Studio..."
"$LMS_BIN" dev --install

if ! command -v zenity >/dev/null 2>&1; then
  warn "zenity is missing. Approval dialogs on this machine need it:"
  warn "  sudo apt install -y zenity"
fi

if command -v ufw >/dev/null 2>&1 &&
  ufw status 2>/dev/null | grep -q "Status: active"; then
  warn "ufw is active. Allow the plugin ports from the LAN:"
  warn "  sudo ufw allow 1236/tcp   # REST API for LM Chat"
  warn "  sudo ufw allow 1237/tcp   # MCP for opencode"
  warn "Skip the MCP port if you do not use opencode."
fi

cat <<'EOF'

lm-computer installed.

Paths:
  workspace:  ~/lm-chat-computer
  config:     ~/.config/lm-computer/config.json
  token:      ~/.config/lm-computer/token.txt   (created on first run)
  REST API:   http://<this-machine>:1236/api
  MCP:        http://<this-machine>:1237/mcp

Notes:
  - Restart LM Studio if the plugin does not appear immediately.
  - Stop both listeners with: ./stop.sh
  - Approvals currently use zenity on this machine. The LM Chat approval UI is
    not part of the current app build; the REST/MCP endpoints are ready for it.
  - opencode connects to the MCP port (1237) with the token from token.txt.
  - Do not add this MCP server to LM Studio: the plugin already provides native
    tools there, and the MCP bridge can start before the plugin is loaded.
  - Never expose ports 1236/1237 to the internet.

To update later:
  git pull && ./install.sh
EOF
