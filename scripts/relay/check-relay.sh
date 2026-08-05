#!/usr/bin/env bash
# Health check for the ZiCode rendezvous relay (cron / alerting friendly).
#
# Usage:
#   ./check-relay.sh [status-url] [expected-desktop-device-id]
#   ./check-relay.sh --json [--alert-url https://example.com/hook] \
#       [status-url] [expected-desktop-device-id]
#
# Options:
#   --json          print a single JSON result line (also on success)
#   --alert-url URL POST a JSON alert payload when the check fails (best
#                   effort; overrides ZICODE_RELAY_ALERT_URL)
#
# Defaults: https://relay.zicode.com/relay/status, dev-ax2-01.
#
# Exit codes: 0 = healthy, 1 = degraded (desktop offline), 2 = unreachable.
#
# Cron example (every 5 minutes, logs to syslog):
#   */5 * * * * /usr/local/bin/check-relay.sh || logger -t zicode-relay "relay check failed"
#
# systemd timer example (units live in this directory):
#   ./install-check.sh          # installs the timer
#   ZICODE_RELAY_ALERT_URL=... ./install-check.sh
set -euo pipefail

PYTHON_BIN=""
if python3 --version >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif python --version >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

STATUS_URL="${1:-https://relay.zicode.com/relay/status}"
EXPECTED_DESKTOP="dev-ax2-01"
JSON=0
ALERT_URL="${ZICODE_RELAY_ALERT_URL:-}"
STATUS_URL_SET=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --json)
      JSON=1
      shift
      ;;
    --alert-url)
      shift
      if [ "$#" -eq 0 ]; then
        echo "error: --alert-url requires a URL" >&2
        exit 2
      fi
      ALERT_URL="$1"
      shift
      ;;
    *)
      if [ "$STATUS_URL_SET" -eq 0 ]; then
        STATUS_URL="$1"
        STATUS_URL_SET=1
      else
        EXPECTED_DESKTOP="$1"
      fi
      shift
      ;;
  esac
done

exit_code=0
reason="ok"
detail="relay ok, desktop online: $EXPECTED_DESKTOP"
body=""
if ! body="$(curl -fsS --max-time 15 "$STATUS_URL")"; then
  exit_code=2
  reason="unreachable"
  detail="relay status unreachable: $STATUS_URL"
elif ! printf '%s\n' "$body" | grep -q '"desktops"'; then
  exit_code=2
  reason="malformed"
  detail="relay status body malformed"
elif ! printf '%s\n' "$body" | grep -q "\"$EXPECTED_DESKTOP\""; then
  exit_code=1
  reason="desktop_offline"
  detail="expected desktop offline: $EXPECTED_DESKTOP"
fi

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
summary="$(printf '%s\n' "$body" | "$PYTHON_BIN" -c 'import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print("{}"); raise SystemExit(0)
print(json.dumps({
    "desktops": d.get("desktops", []),
    "sessions": d.get("sessions", []),
    "usage": d.get("usage", []),
    "usageDay": d.get("usageDay"),
    "usageHistoryDays": len(d.get("usageHistory", [])),
}, ensure_ascii=False))' 2>/dev/null || printf '{}')"

if [ "$JSON" -eq 1 ]; then
  printf '{"ok":%s,"exit":%d,"reason":"%s","at":"%s","statusUrl":"%s","expectedDesktop":"%s","summary":%s}\n' \
    "$([ "$exit_code" -eq 0 ] && echo true || echo false)" \
    "$exit_code" \
    "$reason" \
    "$now" \
    "$STATUS_URL" \
    "$EXPECTED_DESKTOP" \
    "$summary"
elif [ "$exit_code" -eq 0 ]; then
  echo "$detail"
  if command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    printf '%s\n' "$body" | "$PYTHON_BIN" -c 'import json,sys
d=json.load(sys.stdin)
print("sessions:", len(d.get("sessions", [])))
print("usage:", d.get("usage"))
print("usageDay:", d.get("usageDay"))
print("usageHistoryDays:", len(d.get("usageHistory", [])))' || true
  fi
else
  echo "$detail" >&2
fi

if [ "$exit_code" -ne 0 ] && [ -n "$ALERT_URL" ]; then
  payload="$(printf '{"ok":%s,"exit":%d,"reason":"%s","detail":"%s","at":"%s","statusUrl":"%s","expectedDesktop":"%s"}' \
    "$([ "$exit_code" -eq 0 ] && echo true || echo false)" \
    "$exit_code" \
    "$reason" \
    "$detail" \
    "$now" \
    "$STATUS_URL" \
    "$EXPECTED_DESKTOP")"
  if ! curl -fsS --max-time 10 -H 'Content-Type: application/json' \
      -d "$payload" "$ALERT_URL" >/dev/null 2>&1; then
    echo "alert delivery failed: $ALERT_URL" >&2
  fi
fi

exit "$exit_code"
