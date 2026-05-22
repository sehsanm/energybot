#!/usr/bin/env bash
# Manual deploy to prod (arvandev).
#
# Flow:
#   1. git commit + git push (do this yourself before running)
#   2. ./bin/deploy.sh           # normal deploy
#      ./bin/deploy.sh --reset   # discard any drift on the server and resync to origin/main
#
# What it does on the server:
#   git pull → docker compose build → alembic upgrade head (ephemeral container) →
#   docker compose up -d → health check.
#
# Admin UI is built locally and shipped as static files because npm registry is
# flaky from the Iran VPS. See docker-compose.override.yml + Dockerfile.prod for the
# Iran-mirror build args (apt + pip).

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
if ! git diff --quiet HEAD -- ':!.claude' ':!admin_ui/out'; then
  echo "WARNING: tracked files have uncommitted local edits. They will NOT be deployed:"
  git status --short -- ':!.claude' ':!admin_ui/out'
  read -rp "Continue with what's already pushed to origin/$BRANCH? [y/N] " ans
  [[ $ans == y || $ans == Y ]] || exit 1
fi

# --- Build admin UI locally ---------------------------------------------
say "[local] Building admin UI"
(cd admin_ui && npm run build >/dev/null)

# --- Refresh prod wheels locally ---------------------------------------
# Run pip download inside python:3.12-slim so platform tags (manylinux x86_64,
# cp312) match what the prod image will install. Iran-hosted PyPI mirrors are
# either flaky or paywall some packages (argon2-cffi), so prod's pip runs with
# --no-index off these wheels instead.
say "[local] Refreshing .deploy/wheels/"
rm -rf "$REPO_ROOT/.deploy/wheels"
mkdir -p "$REPO_ROOT/.deploy/wheels"
docker run --rm \
  -v "$REPO_ROOT/.deploy/wheels:/wheels" \
  -v "$REPO_ROOT/pyproject.toml:/pyproject.toml:ro" \
  python:3.12-slim sh -c '
    pip install -q tomli &&
    python -c "import tomli; print(chr(10).join(tomli.load(open(\"/pyproject.toml\",\"rb\"))[\"project\"][\"dependencies\"]))" > /tmp/req.txt &&
    pip download -q -d /wheels -r /tmp/req.txt
  ' >/dev/null
echo "  $(ls "$REPO_ROOT/.deploy/wheels" | wc -l) wheels, $(du -sh "$REPO_ROOT/.deploy/wheels" | cut -f1)"

# --- Sync code on remote ------------------------------------------------
if [[ $RESET -eq 1 ]]; then
  say "[remote] Resetting working tree to origin/$BRANCH"
  ssh "$REMOTE" "cd $REMOTE_DIR && git fetch origin && git checkout $BRANCH && git reset --hard origin/$BRANCH"
else
  say "[remote] Pulling latest $BRANCH"
  ssh "$REMOTE" "cd $REMOTE_DIR && git fetch origin && git checkout $BRANCH && git pull --ff-only origin $BRANCH"
fi

# --- Ship pre-built admin_ui/out/ + .deploy/wheels/ --------------------
say "[remote] Shipping admin_ui/out/"
tar -C admin_ui -cf - out/ | ssh "$REMOTE" "tar -C $REMOTE_DIR/admin_ui -xf -"

say "[remote] Shipping .deploy/wheels/"
ssh "$REMOTE" "rm -rf $REMOTE_DIR/.deploy/wheels && mkdir -p $REMOTE_DIR/.deploy/wheels"
tar -C .deploy -cf - wheels/ | ssh "$REMOTE" "tar -C $REMOTE_DIR/.deploy -xf -"

# --- Build new image ----------------------------------------------------
say "[remote] Building image"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose build app"

# --- Run migrations with NEW image, against existing DB ----------------
say "[remote] Running migrations"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose run --rm app alembic upgrade head"

# --- Swap app container to new image -----------------------------------
say "[remote] Swapping app container"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose up -d"

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
