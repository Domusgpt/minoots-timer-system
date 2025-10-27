#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-minoots}

echo "[bootstrap] Starting local infrastructure via docker compose"
docker compose -f "$REPO_ROOT/docker-compose.dev.yml" up -d

echo "[bootstrap] Running control plane database migrations"
(
  cd "$REPO_ROOT/apps/control-plane"
  if [ ! -d node_modules ]; then
    npm install --silent
  fi
  npx --yes dotenv-cli -e "$REPO_ROOT/.env" -- npm run db:migrate 2>/dev/null || npm run db:migrate
)
echo "[bootstrap] Seeding control plane policy data"
(
  cd "$REPO_ROOT/apps/control-plane"
  npx --yes dotenv-cli -e "$REPO_ROOT/.env" -- npm run policy:seed 2>/dev/null || npm run policy:seed
)

echo "[bootstrap] Ensuring JetStream stream exists"
node "$REPO_ROOT/services/action-orchestrator/scripts/ensure-jetstream.js"

echo "[bootstrap] Bootstrap completed"
