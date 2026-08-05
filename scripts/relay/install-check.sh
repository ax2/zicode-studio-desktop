#!/usr/bin/env bash
# Install the relay health check and its systemd timer on the relay server.
#
# Run on the server as root. Usage:
#   ./install-check.sh
#   ZICODE_RELAY_ALERT_URL=https://hooks.example.com/zicode ./install-check.sh
#
# The timer runs check-relay.sh --json every 5 minutes; on failure it exits
# non-zero and, when a webhook is configured, POSTs a JSON alert (best effort).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ALERT_URL="${ZICODE_RELAY_ALERT_URL:-}"

install -m 0755 "$SCRIPT_DIR/check-relay.sh" /usr/local/bin/check-relay.sh
if [ -n "$ALERT_URL" ]; then
  sed "s|^Environment=ZICODE_RELAY_ALERT_URL=$|Environment=ZICODE_RELAY_ALERT_URL=${ALERT_URL}|" \
    "$SCRIPT_DIR/zicode-relay-check.service" \
    > /etc/systemd/system/zicode-relay-check.service
else
  cp "$SCRIPT_DIR/zicode-relay-check.service" /etc/systemd/system/zicode-relay-check.service
fi
cp "$SCRIPT_DIR/zicode-relay-check.timer" /etc/systemd/system/zicode-relay-check.timer
systemctl daemon-reload
systemctl enable --now zicode-relay-check.timer
echo "installed check-relay.sh + zicode-relay-check.timer (alert: $([ -n "$ALERT_URL" ] && echo on || echo off))"
