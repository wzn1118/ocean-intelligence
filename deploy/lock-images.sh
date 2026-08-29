#!/usr/bin/env sh
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
output="${1:-$project_dir/deploy/image-lock.env}"

resolve() {
  variable="$1"
  image="$2"
  docker pull "$image" >/dev/null
  digest="$(docker image inspect "$image" --format '{{index .RepoDigests 0}}')"
  if [ -z "$digest" ] || [ "$digest" = "<no value>" ]; then
    echo "Unable to resolve digest for $image" >&2
    exit 1
  fi
  printf '%s=%s\n' "$variable" "$digest"
}

{
  echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ); review and source from production.env."
  resolve POSTGRES_IMAGE "${POSTGRES_IMAGE:-postgres:16-alpine}"
  resolve NODE_IMAGE "${NODE_IMAGE:-node:22-alpine}"
  resolve PYTHON_IMAGE "${PYTHON_IMAGE:-python:3.13-slim}"
  resolve CADDY_IMAGE "${CADDY_IMAGE:-caddy:2-alpine}"
  resolve CLOUDFLARED_IMAGE "${CLOUDFLARED_IMAGE:-cloudflare/cloudflared:latest}"
} > "$output"

chmod 600 "$output"
echo "Wrote immutable image references to $output"
