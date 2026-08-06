#!/usr/bin/env bash
# Pre-flight check for the ZiCode relay server deployment.
#
# Run on the target Debian/Ubuntu server as root BEFORE deploy-relay.sh.
# Verifies DNS, toolchain, packages and disk, and prints a checklist.
# Exit codes: 0 = all hard checks passed, 1 = at least one hard check failed.
#
# Usage: ./preflight-check.sh [relay-domain] [turn-domain]
set -uo pipefail

RELAY_DOMAIN="${1:-relay.zicode.com}"
TURN_DOMAIN="${2:-turn.remote.zicode.com}"
FAILED=0

check() {
  local name="$1"
  local status="$2"
  if [ "$status" = "ok" ]; then
    echo "  [PASS] $name"
  else
    echo "  [FAIL] $name"
    FAILED=1
  fi
}

echo "==> ZiCode relay deployment pre-flight (${RELAY_DOMAIN} / ${TURN_DOMAIN})"

echo "--- DNS ---"
RELAY_IP="$(getent hosts "$RELAY_DOMAIN" | awk '{print $1}' | head -n 1)"
TURN_IP="$(getent hosts "$TURN_DOMAIN" | awk '{print $1}' | head -n 1)"
check "DNS A: $RELAY_DOMAIN -> ${RELAY_IP:-missing}" "$([ -n "$RELAY_IP" ] && echo ok || echo fail)"
check "DNS A: $TURN_DOMAIN -> ${TURN_IP:-missing}" "$([ -n "$TURN_IP" ] && echo ok || echo fail)"
if [ -n "$RELAY_IP" ] && [ -n "$TURN_IP" ] && [ "$RELAY_IP" != "$TURN_IP" ]; then
  echo "  [NOTE] relay and turn resolve to different IPs (${RELAY_IP} vs ${TURN_IP}); ensure both point at this server"
fi

echo "--- OS / package manager ---"
if grep -qEi 'debian|ubuntu' /etc/os-release 2>/dev/null; then
  check "Debian/Ubuntu" "ok"
else
  check "Debian/Ubuntu" "fail"
fi
check "apt-get" "$(command -v apt-get >/dev/null 2>&1 && echo ok || echo fail)"

echo "--- Toolchain ---"
check "cargo" "$(command -v cargo >/dev/null 2>&1 && echo ok || echo fail)"
check "rustc" "$(command -v rustc >/dev/null 2>&1 && echo ok || echo fail)"
check "nginx" "$(command -v nginx >/dev/null 2>&1 && echo ok || echo fail)"
check "certbot" "$(command -v certbot >/dev/null 2>&1 && echo ok || echo fail)"
check "systemctl" "$(command -v systemctl >/dev/null 2>&1 && echo ok || echo fail)"

echo "--- Network ---"
if command -v curl >/dev/null 2>&1; then
  GITHUB_STATUS="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 https://github.com 2>/dev/null || true)"
  check "GitHub reachable (for deploy script clone)" "$([ "$GITHUB_STATUS" = "200" ] && echo ok || echo fail)"
else
  check "curl installed" "fail"
fi

echo "--- Disk / memory ---"
AVAIL_KB="$(df -k /root 2>/dev/null | awk 'NR==2 {print $4}')"
check "disk free >= 5 GB (${AVAIL_KB:-0} KB)" "$([ "${AVAIL_KB:-0}" -ge 5242880 ] 2>/dev/null && echo ok || echo fail)"
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null)"
check "memory >= 1 GB (${MEM_KB:-0} KB)" "$([ "${MEM_KB:-0}" -ge 1048576 ] 2>/dev/null && echo ok || echo fail)"

echo "--- Ports (bind check, inbound must also be open in the cloud security group) ---"
for port in 80 443; do
  check "local bind port ${port} free" "$(ss -lnt 2>/dev/null | awk '{print $4}' | grep -q ":$port$" && echo fail || echo ok)"
done
echo "  [NOTE] cloud security group must open: TCP 80/443, UDP+TCP 3478, UDP/TCP 49152-65535"

if [ "$FAILED" -eq 0 ]; then
  echo "==> pre-flight PASSED; proceed with deploy-relay.sh"
else
  echo "==> pre-flight FAILED; fix the failing checks before deploying" >&2
fi
exit "$FAILED"
