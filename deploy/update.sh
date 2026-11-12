#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

if [[ ! -f .env ]]; then
  echo "Missing server .env" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Server checkout has tracked changes; refusing to overwrite them" >&2
  exit 1
fi

git fetch --quiet origin \
  '+refs/heads/main:refs/remotes/origin/main' \
  '+refs/tags/deploy-ready:refs/tags/deploy-ready'

target="$(git rev-parse 'refs/tags/deploy-ready^{commit}')"
current="$(git rev-parse HEAD)"
git merge-base --is-ancestor "$target" refs/remotes/origin/main
git merge-base --is-ancestor "$current" "$target"

if [[ "$current" == "$target" ]] && \
   docker image inspect "pdmu-front:$target" >/dev/null 2>&1 && \
   curl -fsS http://127.0.0.1:8080/ >/dev/null 2>&1; then
  echo "PDMU already serves $target"
  exit 0
fi

git checkout --quiet main
git merge --ff-only --quiet "$target"
export PDMU_REVISION="$target"
docker compose --env-file .env -f deploy/compose.yaml build web
docker compose --env-file .env -f deploy/compose.yaml up -d --no-deps --no-build web

container="$(docker compose --env-file .env -f deploy/compose.yaml ps -q web)"
for ((attempt=0; attempt<24; attempt++)); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || true)" == healthy ]] && \
     curl -fsS http://127.0.0.1:8080/ >/dev/null 2>&1; then
    echo "PDMU deployed $target"
    exit 0
  fi
  sleep 5
done

echo "PDMU failed health check at $target" >&2
if [[ "$current" != "$target" ]] && docker image inspect "pdmu-front:$current" >/dev/null 2>&1; then
  export PDMU_REVISION="$current"
  docker compose --env-file .env -f deploy/compose.yaml up -d --no-deps --no-build --force-recreate web
  git reset --hard --quiet "$current"
  echo "Restored previous version $current" >&2
fi
exit 1
