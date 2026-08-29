#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p .runtime
mkdir -p .runtime/copernicus-daily-index

exec flock -n .runtime/copernicus-daily-index.lock \
  timeout --signal=TERM --kill-after=30s 60m \
  docker compose --env-file deploy/production.env -f compose.prod.yaml \
  --profile jobs run --rm --no-deps copernicus-indexer \
  >> .runtime/copernicus-daily-index/cron.log 2>&1
