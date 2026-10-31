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

echo "Recreating $CONTAINER with the new image…"
curl --fail-with-body -sS -m 300 -X POST \
  -H "X-API-Key: $PORTAINER_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"PullImage":true}' \
  "$PORTAINER/api/docker/$ENVIRONMENT/containers/$CONTAINER/recreate" > /dev/null
echo "Done: $CONTAINER runs the new image."
