#!/usr/bin/env bash
# Builds the production image, pushes it, then has Portainer recreate the container with it (same as « Recreate »
# with « Re-pull image » in its UI). Needs PORTAINER_API_KEY: a Portainer access token (My account > Access tokens).
set -euo pipefail

IMAGE=registry.jonas.bzh/inscript-carte:latest
PORTAINER=https://portainer.jonas.bzh
ENVIRONMENT=3
CONTAINER=inscript-carte

: "${PORTAINER_API_KEY:?Set PORTAINER_API_KEY to a Portainer access token}"
cd "$(dirname "$0")/.."

docker build --platform=linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

portainer() {
  curl -sS -m 300 -H "X-API-Key: $PORTAINER_API_KEY" -H 'content-type: application/json' -w '\n%{http_code}' "$@"
}

echo "Recreating $CONTAINER with the new image…"
# By id, never by name: Portainer renames the old container to "<name>-old" first, then a name would point to nothing
# and the recreate (and its rollback) would fail halfway.
response=$(portainer "$PORTAINER/api/endpoints/$ENVIRONMENT/docker/containers/$CONTAINER/json")
if [[ ${response##*$'\n'} != 200 ]]; then
  echo "Container $CONTAINER not found in Portainer: ${response%$'\n'*}" >&2
  exit 1
fi
id=$(printf '%s' "${response%$'\n'*}" | bun -e 'console.log((await Bun.stdin.json()).Id)')

response=$(portainer -X POST -d '{"PullImage":true}' "$PORTAINER/api/docker/$ENVIRONMENT/containers/$id/recreate")
if [[ ${response##*$'\n'} != 2?? ]]; then
  echo "Portainer could not recreate $CONTAINER: ${response%$'\n'*}" >&2
  echo "Check in Portainer that a container named $CONTAINER runs (not $CONTAINER-old)." >&2
  exit 1
fi
echo "Done: $CONTAINER runs the new image."
