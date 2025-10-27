#!/usr/bin/env bash
set -euo pipefail

PID=$(pgrep -f "horology-kernel" || true)
if [[ -z "$PID" ]]; then
  echo "[chaos] horology-kernel process not found" >&2
  exit 1
fi

GRACE_SECONDS=${GRACE_SECONDS:-2}
RESTART_COMMAND=${RESTART_COMMAND:-}

echo "[chaos] sending SIGTERM to horology-kernel pid $PID"
kill -TERM "$PID"
sleep "$GRACE_SECONDS"

if pgrep -f "horology-kernel" >/dev/null; then
  echo "[chaos] process still running, forcing shutdown"
  pkill -KILL -f "horology-kernel" || true
fi

echo "[chaos] kernel stopped"

if [[ -n "$RESTART_COMMAND" ]]; then
  echo "[chaos] restarting kernel with command: $RESTART_COMMAND"
  bash -c "$RESTART_COMMAND" &
  echo $! > .chaos-kernel-restart.pid
fi
