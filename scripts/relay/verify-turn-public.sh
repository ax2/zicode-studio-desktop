#!/usr/bin/env bash
#
# Verify the public TURN path (STUN/TURN listener + allocation + relayed data)
# from the server itself against the public hostname. Requires root (reads the
# auth-secret from /etc/turnserver.conf), turnutils_uclient (coturn package)
# and python3 (local UDP echo peer).
#
# Usage: ./verify-turn-public.sh [host]
#   host defaults to turn.remote.zicode.com; overrides with ZICODE_TURN_PORT.
set -euo pipefail

HOST="${1:-turn.remote.zicode.com}"
PORT="${ZICODE_TURN_PORT:-3478}"
PEER_PORT="${ZICODE_TURN_PEER_PORT:-3480}"
PEER_IP="${ZICODE_TURN_PEER_IP:-}"
SECRET="$(grep '^static-auth-secret=' /etc/turnserver.conf | cut -d= -f2)"
USER="$(date +%s):zicode-verify"
CRED="$(printf '%s' "$USER" | openssl dgst -sha1 -hmac "$SECRET" -binary | openssl base64)"

echo "==> public TURN path check: ${HOST}:${PORT} (relay ports 49160-49167)"
if ! command -v turnutils_uclient >/dev/null 2>&1; then
  echo "error: turnutils_uclient not found (install coturn)" >&2
  exit 1
fi

# Local UDP echo peer so turnutils can test the relayed data path. Loopback
# peers are denied by coturn by default, so bind to the server's primary
# private address (or override with ZICODE_TURN_PEER_IP).
if [ -z "$PEER_IP" ]; then
  PEER_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || hostname -I 2>/dev/null | awk '{print $1}')"
fi
python3 - "$PEER_PORT" "$PEER_IP" <<'PY' &
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind((sys.argv[2], int(sys.argv[1])))
while True:
    d, a = s.recvfrom(4096)
    s.sendto(d, a)
PY
ECHO_PID=$!
trap 'kill "$ECHO_PID" 2>/dev/null || true' EXIT

OUT="$(timeout 90 turnutils_uclient -u "$USER" -w "$CRED" -e "$PEER_IP" -r "$PEER_PORT" "$HOST" 2>&1 || true)"
echo "$OUT" | head -12
echo "$OUT" | tail -10
RECV="$(echo "$OUT" | grep -o 'tot_recv_msgs=[0-9]*' | cut -d= -f2 | awk '{s+=$1} END {print s+0}')"
SEND="$(echo "$OUT" | grep -o 'tot_send_msgs=[0-9]*' | cut -d= -f2 | awk '{s+=$1} END {print s+0}')"
echo "==> relayed packets: ${RECV}/${SEND} received"
if [ "${RECV:-0}" -gt 0 ]; then
  echo "==> PASS: TURN allocation + relayed data over public path"
else
  echo "==> FAIL: check cloud security group / ufw and coturn log" >&2
  exit 1
fi
