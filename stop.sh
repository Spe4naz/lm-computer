#!/usr/bin/env bash
# Stops the lm-computer HTTP/MCP server. Native LM Studio tools remain until
# LM Studio is restarted.
# Run from the repository root:
#   ./stop.sh
# or:
#   bash stop.sh

set -euo pipefail

BASE_URL="${LM_COMPUTER_URL:-http://127.0.0.1:1236}"
TOKEN_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/lm-computer/token.txt"

usage() {
  cat <<'EOF'
Usage: ./stop.sh

Stops the plugin's HTTP/MCP server using its bearer token.
The token is read from ~/.config/lm-computer/token.txt.

Environment:
  LM_COMPUTER_URL   base URL (default: http://127.0.0.1:1236)

Native LM Studio tools continue to work until LM Studio is restarted.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

command -v curl >/dev/null 2>&1 ||
  { printf 'curl is required.\n' >&2; exit 1; }
[[ -f "$TOKEN_FILE" ]] ||
  { printf 'Token not found: %s\nStart the plugin once first.\n' "$TOKEN_FILE" >&2; exit 1; }

TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
[[ -n "$TOKEN" ]] || { printf 'Token file is empty: %s\n' "$TOKEN_FILE" >&2; exit 1; }

printf 'Stopping lm-computer HTTP/MCP at %s...\n' "$BASE_URL"

response="$(
  curl -sS -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -w $'\n%{http_code}' \
    "$BASE_URL/api/shutdown" 2>&1
)" || {
  printf 'Server is already stopped or unreachable.\n'
  exit 0
}

code="${response##*$'\n'}"
body="${response%$'\n'*}"

if [[ "$code" == "200" ]]; then
  printf 'HTTP/MCP server stopped.\n'
  printf 'Native LM Studio tools remain until LM Studio is restarted.\n'
else
  printf 'Stop failed (HTTP %s): %s\n' "$code" "$body" >&2
  exit 1
fi
