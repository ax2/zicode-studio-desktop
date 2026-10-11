#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || $# -eq 0 || -z "${DISPLAY:-}" || -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  echo 'Run under xvfb-run -a dbus-run-session with a command to check.' >&2
  exit 2
fi

notification_log="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/zicode-notification-daemon.log"
dunst -conf - </dev/null >"$notification_log" 2>&1 &
notification_pid=$!
trap 'kill "$notification_pid" 2>/dev/null || true; wait "$notification_pid" 2>/dev/null || true' EXIT
ready=0
for ((attempt = 0; attempt < 50; attempt++)); do
  if gdbus call --session --dest org.freedesktop.Notifications \
      --object-path /org/freedesktop/Notifications \
      --method org.freedesktop.Notifications.GetServerInformation >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$notification_pid" 2>/dev/null; then break; fi
  sleep 0.2
done
if [[ "$ready" != 1 ]]; then
  cat "$notification_log" >&2
  echo 'Real desktop notification service did not become ready.' >&2
  exit 1
fi
"$@"
