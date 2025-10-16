#!/usr/bin/env bash
set -euo pipefail

if ! command -v tc >/dev/null 2>&1; then
  echo "[chaos] tc command not available; cannot inject network jitter" >&2
  exit 1
fi

INTERFACE=${INTERFACE:-lo}
DELAY_MS=${DELAY_MS:-150}
JITTER_MS=${JITTER_MS:-50}
DURATION=${DURATION_SECONDS:-15}

cleanup() {
  tc qdisc del dev "$INTERFACE" root netem >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "[chaos] applying netem delay ${DELAY_MS}ms +/- ${JITTER_MS}ms on interface $INTERFACE"
tc qdisc add dev "$INTERFACE" root netem delay "${DELAY_MS}ms" ${JITTER_MS}ms
sleep "$DURATION"

echo "[chaos] removing netem rules from $INTERFACE"
cleanup
