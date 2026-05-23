#!/usr/bin/env bash
# Manual deploy to prod (arvandev).
#
# Flow:
#   1. git commit + git push (do this yourself before running)
#   2. ./bin/deploy.sh           # normal deploy
#      ./bin/deploy.sh --reset   # discard any drift on the server and resync to origin/main
#
# What it does on the server (no laptop bandwidth besides the SSH control
# channel — no wheels or admin static files are uploaded from the laptop):
#   git pull → docker compose build (npm install + pip install happen on
#   the server inside the image build) → alembic upgrade head → docker
#   compose up -d → health check.
#
# If the server can't reach the canonical registries (Iran VPS often can't
# reach pypi.org / registry.npmjs.org / deb.debian.org reliably), set any
# of these env vars before running deploy — they are forwarded as docker
# build args. Pick mirrors known to work from your VPS:
#
DEPLOY_NPM_REGISTRY=https://mirror.abrha.net/repository/npm/
DEPLOY_PIP_INDEX_URL=https://mirror.abrha.net/repository/pypi/simple
#DEPLOY_PIP_EXTRA_INDEX_URL=https://pypi.org/simple
DEPLOY_APT_MIRROR=mirror.arvancloud.ir

set -euo pipefail

REMOTE=${REMOTE:-arvandev}
REMOTE_DIR=${REMOTE_DIR:-/srv/energybot}
BRANCH=${BRANCH:-main}
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RESET=0
for a in "$@"; do
  case "$a" in
    --reset) RESET=1 ;;
    *) echo "unknown arg: $a"; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# --- Local sanity checks -------------------------------------------------
say "[local] Sanity check"
if ! git diff --quiet HEAD -- ':!.claude'; then
  echo "WARNING: tracked files have uncommitted local edits. They will NOT be deployed:"
  git status --short -- ':!.claude'
  read -rp "Continue with what's already pushed to origin/$BRANCH? [y/N] " ans
  [[ $ans == y || $ans == Y ]] || exit 1
fi

# --- Sync code on remote ------------------------------------------------
if [[ $RESET -eq 1 ]]; then
  say "[remote] Resetting working tree to origin/$BRANCH"
  ssh "$REMOTE" "cd $REMOTE_DIR && git fetch origin && git checkout $BRANCH && git reset --hard origin/$BRANCH"
else
  say "[remote] Pulling latest $BRANCH"
  ssh "$REMOTE" "cd $REMOTE_DIR && git fetch origin && git checkout $BRANCH && git pull --ff-only origin $BRANCH"
fi

# --- Forward optional mirror build args --------------------------------
BUILD_ARGS=""
for v in NPM_REGISTRY PIP_INDEX_URL PIP_EXTRA_INDEX_URL APT_MIRROR; do
  src_var="DEPLOY_$v"
  val=${!src_var:-}
  if [[ -n "$val" ]]; then
    # printf %q quotes the value safely for the remote shell.
    BUILD_ARGS+=" --build-arg $v=$(printf %q "$val")"
  fi
done
if [[ -n "$BUILD_ARGS" ]]; then
  echo "  forwarding build args:$BUILD_ARGS"
fi

# Force the prod Dockerfile for all compose calls. docker-compose.yml reads
# this via ${DOCKERFILE:-Dockerfile}, so local dev (with DOCKERFILE unset)
# still uses the dev Dockerfile.
REMOTE_ENV="DOCKERFILE=Dockerfile.prod"

# --- Build new image on remote (npm + pip happen on the server) --------
say "[remote] Building image (Dockerfile.prod)"
ssh "$REMOTE" "cd $REMOTE_DIR && $REMOTE_ENV docker compose build${BUILD_ARGS} app"

# --- Run migrations with NEW image, against existing DB ----------------
say "[remote] Running migrations"
ssh "$REMOTE" "cd $REMOTE_DIR && $REMOTE_ENV docker compose run --rm app alembic upgrade head"

# --- Swap app container to new image -----------------------------------
say "[remote] Swapping app container"
ssh "$REMOTE" "cd $REMOTE_DIR && $REMOTE_ENV docker compose up -d"

# --- Health check -------------------------------------------------------
say "[remote] Health check"
ssh "$REMOTE" '
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf http://localhost:8000/health >/dev/null; then
      echo "  /health OK after ${i} attempt(s)"
      exit 0
    fi
    sleep 2
  done
  echo "  /health did not come up — check docker logs energybot-app-1"
  exit 1
'

say "Deployed."
