#!/usr/bin/env bash
# Health check for the ZiCode rendezvous relay (cron / alerting friendly).
#
# Usage:
#   ./check-relay.sh [status-url] [expected-desktop-device-id]
# Defaults: https://relay.zicode.com/relay/status, dev-ax2-01.
#
# Exit codes: 0 = healthy, 1 = degraded (desktop offline), 2 = unreachable.
#
# Cron example (every 5 minutes, logs to syslog):
#   */5 * * * * /usr/local/bin/check-relay.sh || logger -t zicode-relay "relay check failed"
set -euo pipefail

STATUS_URL="${1:-https://relay.zicode.com/relay/status}"
EXPECTED_DESKTOP="${2:-dev-ax2-01}"

body="$(curl -fsS --max-time 15 "$STATUS_URL")" || {
  echo "relay status unreachable: $STATUS_URL" >&2
  exit 2
}

printf '%s\n' "$body" | grep -q '"desktops"' || {
  echo "relay status body malformed" >&2
  exit 2
}

if ! printf '%s\n' "$body" | grep -q "\"$EXPECTED_DESKTOP\""; then
  echo "expected desktop offline: $EXPECTED_DESKTOP" >&2
  exit 1
fi

echo "relay ok, desktop online: $EXPECTED_DESKTOP"
if command -v python3 >/dev/null 2>&1; then
  printf '%s\n' "$body" | python3 -c 'import json,sys
d=json.load(sys.stdin)
print("sessions:", len(d.get("sessions", [])))
print("usage:", d.get("usage"))
print("usageDay:", d.get("usageDay"))' || true
fi
