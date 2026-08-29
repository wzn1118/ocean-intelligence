#!/usr/bin/env sh
set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
environment_file="${1:-$project_dir/deploy/production.env}"

if [ ! -f "$environment_file" ]; then
  echo "Missing environment file: $environment_file" >&2
  echo "Create it from deploy/production.env.example and set real secrets." >&2
  exit 1
fi

chmod 600 "$environment_file"
set -a
. "$environment_file"
set +a

transport="${DEPLOY_TRANSPORT:-direct}"
case "$transport" in
  direct)
    profile="direct"
    alternate_profile="tunnel"
    alternate_service="cloudflared"
    ;;
  tunnel)
    if [ -z "${TUNNEL_TOKEN:-}" ] || [ "$TUNNEL_TOKEN" = "replace_with_a_cloudflare_tunnel_token" ]; then
      echo "Set a real TUNNEL_TOKEN in $environment_file." >&2
      exit 1
    fi
    profile="tunnel"
    alternate_profile="direct"
    alternate_service="caddy"
    ;;
  *)
    echo "DEPLOY_TRANSPORT must be either direct or tunnel." >&2
    exit 1
    ;;
esac

cd "$project_dir"

mkdir -p "$project_dir/audits"
release_id="$(date -u +%Y%m%dT%H%M%SZ)"
previous_image=""
if docker image inspect ocean-intelligence:production >/dev/null 2>&1; then
  previous_image="ocean-intelligence:rollback-$release_id"
  docker tag ocean-intelligence:production "$previous_image"
fi

docker compose --env-file "$environment_file" -f compose.prod.yaml --profile "$profile" config --quiet
docker compose --env-file "$environment_file" -f compose.prod.yaml --profile "$alternate_profile" stop "$alternate_service"
DOCKER_BUILDKIT=1 docker compose --env-file "$environment_file" -f compose.prod.yaml --profile "$profile" build --pull
image_id="$(docker image inspect ocean-intelligence:production --format '{{.Id}}')"
printf '%s  %s\n' "$release_id" "$image_id" > "$project_dir/audits/image-$release_id.sha256"
if docker sbom --help >/dev/null 2>&1; then
  docker sbom ocean-intelligence:production --format spdx-json > "$project_dir/audits/sbom-$release_id.spdx.json"
fi
if command -v trivy >/dev/null 2>&1; then
  trivy image --severity HIGH,CRITICAL --format json --output "$project_dir/audits/vulnerabilities-$release_id.json" ocean-intelligence:production
fi
docker compose --env-file "$environment_file" -f compose.prod.yaml --profile "$profile" up -d --remove-orphans
if ! docker compose --env-file "$environment_file" -f compose.prod.yaml ps --wait --wait-timeout "${DEPLOY_HEALTH_TIMEOUT_SECONDS:-180}" app codex-runtime; then
  if [ -n "$previous_image" ]; then
    echo "Deployment health check failed; rolling back to $previous_image" >&2
    docker tag "$previous_image" ocean-intelligence:production
    docker compose --env-file "$environment_file" -f compose.prod.yaml --profile "$profile" up -d --no-build app codex-runtime
  fi
  exit 1
fi
docker compose --env-file "$environment_file" -f compose.prod.yaml --profile "$profile" ps
