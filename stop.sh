#!/usr/bin/env bash
# Stops the lm-computer REST/MCP service and its HTTP listeners.
# Run from the repository root:
#   ./stop.sh
# or:
#   bash stop.sh
#
# REST and MCP live in one process, so stopping one stops the other.
# Native LM Studio tools are not affected.

set -euo pipefail

HOME_DIR="${LM_COMPUTER_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/lm-computer}"
CONFIG_FILE="$HOME_DIR/config.json"
TOKEN_FILE="$HOME_DIR/token.txt"

usage() {
  cat <<'EOF'
Usage: ./stop.sh

Stops the REST/MCP process using the bearer token. The REST port is read from
~/.config/lm-computer/config.json; if the REST listener is disabled, the script
tries the MCP port instead. If both are unreachable, it stops
lm-computer.service through systemd.

Environment:
  LM_COMPUTER_URL    explicit base URL, skips config discovery
  LM_COMPUTER_HOME   config directory (default: ~/.config/lm-computer)
  LM_COMPUTER_TOKEN  token override (default: token.txt from the config dir)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

command -v curl >/dev/null 2>&1 ||
  { printf 'curl is required.\n' >&2; exit 1; }

# Turn a bind address into a connect address.
connect_host() {
  local host="${1:-}"
  case "$host" in
    ""|0.0.0.0) printf '127.0.0.1' ;;
    ::) printf '[::1]' ;;
    *:*)
      if [[ "$host" == \[* ]]; then
        printf '%s' "$host"
      else
        printf '[%s]' "$host"
      fi
      ;;
    *) printf '%s' "$host" ;;
  esac
}

# Prints host, port, mcpHost, mcpPort, apiEnabled, mcpEnabled, one per line.
read_config() {
  [[ -f "$CONFIG_FILE" ]] || return 0
  if command -v python3 >/dev/null 2>&1; then
    local parsed
    parsed="$(
      python3 - "$CONFIG_FILE" <<'PY' 2>/dev/null || true
import json
import sys

sys.stdout.reconfigure(newline="\n")

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    sys.exit(1)

host = str(data.get("host") or "0.0.0.0")
port = data.get("port") or 1236
mcp_host = str(data.get("mcpHost") or host)
mcp_port = data.get("mcpPort") or 1237
api_enabled = "1" if data.get("apiEnabled", True) else "0"
mcp_enabled = "1" if data.get("mcpEnabled", True) else "0"
for value in (host, port, mcp_host, mcp_port, api_enabled, mcp_enabled):
    print(value)
PY
    )"
    if [[ -n "$parsed" ]]; then
      printf '%s\n' "$parsed"
      return 0
    fi
  fi

  local host port mcp_host mcp_port api_enabled mcp_enabled
  host="$(grep -oP '"host"\s*:\s*"\K[^"]+' "$CONFIG_FILE" 2>/dev/null | head -n1 || true)"
  port="$(grep -oP '"port"\s*:\s*\K[0-9]+' "$CONFIG_FILE" 2>/dev/null | head -n1 || true)"
  mcp_host="$(grep -oP '"mcpHost"\s*:\s*"\K[^"]+' "$CONFIG_FILE" 2>/dev/null | head -n1 || true)"
  mcp_port="$(grep -oP '"mcpPort"\s*:\s*\K[0-9]+' "$CONFIG_FILE" 2>/dev/null | head -n1 || true)"
  api_enabled="$(grep -oP '"apiEnabled"\s*:\s*\K(true|false)' "$CONFIG_FILE" 2>/dev/null | head -n1 || true)"
  mcp_enabled="$(grep -oP '"mcpEnabled"\s*:\s*\K(true|false)' "$CONFIG_FILE" 2>/dev/null | head -n1 || true)"
  printf '%s\n' \
    "${host:-0.0.0.0}" \
    "${port:-1236}" \
    "${mcp_host:-${host:-0.0.0.0}}" \
    "${mcp_port:-1237}" \
    "$([[ "${api_enabled:-true}" == "false" ]] && printf 0 || printf 1)" \
    "$([[ "${mcp_enabled:-true}" == "false" ]] && printf 0 || printf 1)"
}

TOKEN="${LM_COMPUTER_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$TOKEN_FILE" ]]; then
  TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
fi
[[ -n "$TOKEN" ]] ||
  { printf 'Token not found: %s\nStart the plugin once first.\n' "$TOKEN_FILE" >&2; exit 1; }

config=()
while IFS= read -r line; do
  config+=("${line%$'\r'}")
done < <(read_config)

api_host="${config[0]:-0.0.0.0}"
api_port="${config[1]:-1236}"
mcp_host="${config[2]:-$api_host}"
mcp_port="${config[3]:-1237}"
api_enabled="${config[4]:-1}"
mcp_enabled="${config[5]:-1}"

urls=()
if [[ -n "${LM_COMPUTER_URL:-}" ]]; then
  urls+=("${LM_COMPUTER_URL%/}")
else
  if [[ "$api_enabled" == "1" ]]; then
    urls+=("http://$(connect_host "$api_host"):$api_port")
  fi
  if [[ "$mcp_enabled" == "1" ]]; then
    mcp_url="http://$(connect_host "$mcp_host"):$mcp_port"
    if [[ ${#urls[@]} -eq 0 || "$mcp_url" != "${urls[0]}" ]]; then
      urls+=("$mcp_url")
    fi
  fi
  if [[ ${#urls[@]} -eq 0 ]]; then
    urls+=("http://127.0.0.1:1236" "http://127.0.0.1:1237")
  fi
fi

auth_failed=0
stop_failed=0
for base in "${urls[@]}"; do
  printf 'Stopping lm-computer at %s...\n' "$base"
  if ! response="$(
    curl -sS --max-time 5 -X POST \
      -H "Authorization: Bearer $TOKEN" \
      -w $'\n%{http_code}' \
      "$base/api/shutdown" 2>&1
  )"; then
    printf '  unreachable, trying next.\n'
    continue
  fi

  code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  if [[ "$code" == "200" ]]; then
    printf 'HTTP/MCP server stopped.\n'
    printf 'Native LM Studio tools remain until LM Studio is restarted.\n'
    exit 0
  fi
  if [[ "$code" == "401" ]]; then
    printf '  unauthorized: the token does not match.\n' >&2
    auth_failed=1
    continue
  fi
  printf '  stop failed (HTTP %s): %s\n' "$code" "$body" >&2
  stop_failed=1
done

if [[ "$auth_failed" == "1" ]]; then
  printf 'Check the token in %s, then retry.\n' "$TOKEN_FILE" >&2
  exit 1
fi
if [[ "$stop_failed" == "1" ]]; then
  exit 1
fi

UNIT_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/lm-computer.service"
if [[ -f "$UNIT_FILE" ]] && command -v systemctl >/dev/null 2>&1; then
  if systemctl --user stop lm-computer.service 2>/dev/null; then
    printf 'lm-computer.service stopped.\n'
    exit 0
  fi
fi

printf 'Server is already stopped or unreachable.\n'
exit 0
