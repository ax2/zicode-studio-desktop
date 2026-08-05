#!/usr/bin/env bash
# Deploy coturn (STUN/TURN) for ZiCode M2 P2P on the relay server.
#
# Run on the server as root (Debian/Ubuntu). Prerequisites:
#   1. DNS A record: turn.remote.zicode.com -> this server's public IP
#   2. Cloud security group opens UDP/TCP 3478 and the TURN relay range
#      (default 49152-65535) so hole punching and relay candidates work
#
# Usage: ./deploy-coturn.sh
# Optional settings (set in the deploy environment):
#   ZICODE_TURN_REALM=<domain>   default turn.remote.zicode.com
#   ZICODE_TURN_SECRET=<secret>  long-term credential secret; generated and
#                                printed once when omitted
#   ZICODE_TURN_RELAY_MIN_PORT / ZICODE_TURN_RELAY_MAX_PORT
#
# Credentials use coturn's long-term mechanism with auth-secret: the desktop
# derives short-lived TURN credentials (username=`<unix-ts>:<name>`,
# credential=base64(HMAC-SHA1(secret, username))) and hands them to the
# phone over the already-authenticated signaling channel. The secret itself
# is never sent to the phone and never committed to the repo.
set -euo pipefail

REALM="${ZICODE_TURN_REALM:-turn.remote.zicode.com}"
TURN_SECRET="${ZICODE_TURN_SECRET:-}"
RELAY_MIN_PORT="${ZICODE_TURN_RELAY_MIN_PORT:-49152}"
RELAY_MAX_PORT="${ZICODE_TURN_RELAY_MAX_PORT:-65535}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "error: this script targets Debian/Ubuntu (apt-get)" >&2
  exit 1
fi

EXTERNAL_IP="$(getent hosts "$REALM" | awk '{print $1}' | head -n 1)"
if [ -z "$EXTERNAL_IP" ]; then
  EXTERNAL_IP="$(hostname -I | awk '{print $1}')"
fi

GENERATED=0
if [ -z "$TURN_SECRET" ]; then
  TURN_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 32)"
  GENERATED=1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn

cat > /etc/turnserver.conf <<EOF
realm=${REALM}
external-ip=${EXTERNAL_IP}
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=${TURN_SECRET}
no-cli
min-port=${RELAY_MIN_PORT}
max-port=${RELAY_MAX_PORT}
EOF

systemctl enable --now coturn

echo "==> coturn deployed: realm=${REALM}, external-ip=${EXTERNAL_IP}, auth-secret enabled, relay ports ${RELAY_MIN_PORT}-${RELAY_MAX_PORT}"
if [ "$GENERATED" = "1" ]; then
  echo "    generated TURN secret (store securely, keep out of the repo): ${TURN_SECRET}"
fi
echo "    iceServers for the desktop config:"
echo "      [{urls:'stun:${REALM}:3478'},{urls:'turn:${REALM}:3478?transport=udp',username:'<unix-ts>:<name>',credential:'<hmac>'}]"
echo "    verify: turnutils_uclient -u '<unix-ts>:<name>' -w '<hmac>' ${REALM}"
