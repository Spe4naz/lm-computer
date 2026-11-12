#!/usr/bin/env bash
# Starts the always-on REST/MCP service. Native LM Studio tools are unaffected.
set -euo pipefail

if ! command -v systemctl >/dev/null 2>&1; then
  printf 'systemctl is required. Run manually instead:\n  node dist/standalone.js\n' >&2
  exit 1
fi

UNIT_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/lm-computer.service"
if [[ ! -f "$UNIT_FILE" ]]; then
  printf 'lm-computer.service is not installed. Run ./install.sh first.\n' >&2
  exit 1
fi

systemctl --user start lm-computer.service
systemctl --user --no-pager --lines=5 status lm-computer.service || true
