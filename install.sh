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

say "Installing lm-computer into LM Studio..."
if ! "$LMS_BIN" dev --install; then
  if command -v npm >/dev/null 2>&1; then
    warn "Install failed; retrying after npm ci..."
    npm ci
    "$LMS_BIN" dev --install
  else
    die "Install failed and npm is not available. Install Node.js/npm and retry."
  fi
fi

if ! command -v zenity >/dev/null 2>&1; then
  warn "zenity is missing. Approval dialogs on this machine need it:"
  warn "  sudo apt install -y zenity"
fi

if command -v ufw >/dev/null 2>&1 &&
  ufw status 2>/dev/null | grep -q "Status: active"; then
  warn "ufw is active. Allow the plugin port from the LAN:"
  warn "  sudo ufw allow 1236/tcp"
fi

cat <<'EOF'

lm-computer installed.

Paths:
  workspace:  ~/lm-chat-computer
  config:     ~/.config/lm-computer/config.json
  token:      ~/.config/lm-computer/token.txt   (created on first run)
  REST/MCP:   http://<this-machine>:1236

Notes:
  - Restart LM Studio if the plugin does not appear immediately.
  - Approvals currently use zenity on this machine. The LM Chat approval UI is
    not part of the current app build; the REST/MCP endpoints are ready for it.
  - opencode can connect to /mcp with the token from token.txt.
  - Never expose port 1236 to the internet.

To update later:
  git pull && ./install.sh
EOF
