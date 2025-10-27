#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "[infra] docker not available; skipping compose validation"
else
  echo "[infra] validating docker-compose.dev.yml"
  docker compose -f "$REPO_ROOT/docker-compose.dev.yml" config >/dev/null
fi

echo "[infra] validating bootstrap script syntax"
bash -n "$REPO_ROOT/scripts/bootstrap-dev.sh"

echo "[infra] infra smoke tests completed"
