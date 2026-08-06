#!/usr/bin/env bash
# One-shot provisioning for the ZiCode relay server (Debian/Ubuntu, as root).
#
# Runs pre-flight checks, deploys the rendezvous relay, deploys coturn, and
# installs the health-check timer. Read the printed relayTurn* settings and
# paste them into the desktop's remote access panel.
#
# Usage:
#   ZICODE_RELAY_REGISTRATION_TOKEN=<secret> \
#   ZICODE_RELAY_BYTE_QUOTA_PER_DEVICE=<bytes> \
#   ZICODE_RELAY_ALERT_URL=<webhook-url> \
#   ./provision.sh
#
# Secrets are never written to this repository.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> 1/4 pre-flight checks"
"$SCRIPT_DIR/preflight-check.sh"

echo "==> 2/4 deploy rendezvous relay"
"$SCRIPT_DIR/deploy-relay.sh"

echo "==> 3/4 deploy coturn (STUN/TURN)"
"$SCRIPT_DIR/deploy-coturn.sh"

echo "==> 4/4 install monitoring timer"
if [ -n "${ZICODE_RELAY_ALERT_URL:-}" ]; then
  ZICODE_RELAY_ALERT_URL="$ZICODE_RELAY_ALERT_URL" "$SCRIPT_DIR/install-check.sh"
else
  "$SCRIPT_DIR/install-check.sh"
fi

echo "==> provisioning complete"
echo "    next: paste the relayTurnUrl / relayTurnRealm / relayTurnSecret"
echo "    values printed by deploy-coturn.sh into the desktop's"
echo "    Settings -> Remote access -> TURN relay, save, and restart ZiCode."
