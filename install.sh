#!/usr/bin/env bash
# Installs the lm-computer plugin into LM Studio and starts the REST/MCP
# systemd user service.
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

Installs lm-computer into LM Studio for the current user and starts the
lm-computer systemd user service (REST + MCP).

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

say "Installing the REST/MCP user service..."
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  warn "node was not found in PATH; skipping the systemd service."
  warn "Run it manually with: node \"$SCRIPT_DIR/dist/standalone.js\""
elif ! command -v systemctl >/dev/null 2>&1; then
  warn "systemctl not found; skipping the user service."
  warn "Run it manually with: node \"$SCRIPT_DIR/dist/standalone.js\""
else
  UNIT_DIR="$HOME/.config/systemd/user"
  UNIT_FILE="$UNIT_DIR/lm-computer.service"
  mkdir -p "$UNIT_DIR"
  cat >"$UNIT_FILE" <<EOF
[Unit]
Description=LM Computer REST and MCP service
After=network.target

[Service]
Type=simple
WorkingDirectory=$SCRIPT_DIR
ExecStart="$NODE_BIN" "$SCRIPT_DIR/dist/standalone.js"
Environment=LM_COMPUTER_HOME=$HOME/.config/lm-computer
PassEnvironment=DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectControlGroups=yes
ProtectKernelTunables=yes
# ProtectKernelModules and ProtectClock are deliberately absent: both imply
# capability-dropping, which a systemd --user service cannot perform. With them
# the unit fails with "Failed to drop capabilities: Operation not permitted"
# (status=218/CAPABILITIES) and restart-loops forever.
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=default.target
EOF

  if systemctl --user daemon-reload 2>/dev/null; then
    systemctl --user enable lm-computer.service >/dev/null 2>&1 || true
    if ! systemctl --user restart lm-computer.service; then
      warn "Could not start lm-computer.service."
      warn "Check: systemctl --user status lm-computer.service"
    fi
  else
    warn "The systemd user manager is unavailable."
    warn "Start manually with: node \"$SCRIPT_DIR/dist/standalone.js\""
  fi
fi

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

Service:
  systemctl --user status lm-computer.service
  systemctl --user restart lm-computer.service
  ./start.sh
  ./stop.sh

Notes:
  - The plugin inside LM Studio provides native tools only. REST/MCP run in the
    lm-computer.service process, because LM Studio evicts plugin processes and
    their HTTP listeners would disappear.
  - Restart LM Studio if the plugin does not appear immediately.
  - Approvals currently use zenity on this machine. The LM Chat approval UI is
    not part of the current app build; the REST/MCP endpoints are ready for it.
  - opencode connects to the MCP port (1237) with the token from token.txt.
  - Do not add this MCP server to LM Studio: the plugin already provides native
    tools there.
  - Never expose ports 1236/1237 to the internet.

To update later:
  git pull && ./install.sh
EOF
