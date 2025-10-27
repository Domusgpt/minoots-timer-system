#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.dev.yml}
SERVICE_NAME=${KERNEL_SERVICE:-horology-kernel}
NET_INTERFACE=${CHAOS_INTERFACE:-eth0}
LATENCY_MS=${CHAOS_LATENCY_MS:-250}
JITTER_MS=${CHAOS_JITTER_MS:-75}
DURATION_SEC=${CHAOS_DURATION_SEC:-25}
SLEEP_BETWEEN=${CHAOS_INTERVAL_SEC:-45}

usage() {
  cat <<USAGE
Kernel chaos toolkit

Usage:
  $0 restart             Restart the horology kernel container once.
  $0 latency             Inject ${LATENCY_MS}ms latency (+/- ${JITTER_MS}ms jitter) for ${DURATION_SEC}s.
  $0 clear               Remove any latency shaping rules.
  $0 loop                Continuously alternate restart/latency actions.

Environment variables:
  COMPOSE_FILE          Docker compose manifest (default: docker-compose.dev.yml)
  KERNEL_SERVICE        Service name inside compose file (default: horology-kernel)
  CHAOS_INTERFACE       Network interface inside container (default: eth0)
  CHAOS_LATENCY_MS      Base latency for tc netem (default: 250)
  CHAOS_JITTER_MS       Jitter to add to latency (default: 75)
  CHAOS_DURATION_SEC    Duration to keep latency rules active (default: 25)
  CHAOS_INTERVAL_SEC    Sleep between loop iterations (default: 45)
USAGE
}

require_compose() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required to run chaos actions" >&2
    exit 1
  fi
}

restart_kernel() {
  require_compose
  echo "[chaos] restarting ${SERVICE_NAME} via ${COMPOSE_FILE}"
  docker compose -f "${COMPOSE_FILE}" restart "${SERVICE_NAME}"
}

inject_latency() {
  require_compose
  echo "[chaos] applying latency (${LATENCY_MS}ms ± ${JITTER_MS}ms) to ${SERVICE_NAME}:${NET_INTERFACE}"
  docker compose -f "${COMPOSE_FILE}" exec -T "${SERVICE_NAME}" \
    tc qdisc replace dev "${NET_INTERFACE}" root netem delay "${LATENCY_MS}ms" "${JITTER_MS}ms" 25%
  sleep "${DURATION_SEC}"
  clear_latency
}

clear_latency() {
  require_compose
  echo "[chaos] clearing latency rules from ${SERVICE_NAME}:${NET_INTERFACE}"
  docker compose -f "${COMPOSE_FILE}" exec -T "${SERVICE_NAME}" \
    tc qdisc del dev "${NET_INTERFACE}" root || true
}

loop_actions() {
  while true; do
    restart_kernel || echo "[chaos] restart failed" >&2
    sleep "${SLEEP_BETWEEN}"
    inject_latency || echo "[chaos] latency injection failed" >&2
    sleep "${SLEEP_BETWEEN}"
  done
}

case "${1:-}" in
  restart)
    restart_kernel
    ;;
  latency)
    inject_latency
    ;;
  clear)
    clear_latency
    ;;
  loop)
    loop_actions
    ;;
  -h|--help|help|'')
    usage
    ;;
  *)
    echo "unknown command: ${1}" >&2
    usage
    exit 1
    ;;
 esac
