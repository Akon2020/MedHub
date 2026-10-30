#!/usr/bin/env bash
# Deploys a release archive on the cPanel account (docs/09-hebergement-deploiement.md).
# Usage: scripts/deploy.sh /home/<account>/medhub-<version>.tar.gz
set -euo pipefail

ARCHIVE="${1:?usage: deploy.sh <archive.tar.gz>}"
BASE="${MEDHUB_HOME:-$HOME/medhub}"
NAME="$(basename "$ARCHIVE" .tar.gz)"
TARGET="$BASE/releases/$(date +%Y-%m-%d_%H%M)_${NAME#medhub-}"

mkdir -p "$BASE/releases" "$BASE/shared/storage" "$BASE/shared/logs" "$BASE/shared/backups"
mkdir -p "$TARGET"
tar -xzf "$ARCHIVE" -C "$TARGET" --strip-components=1

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"

echo "Applying migrations (with a prior backup)..."
"$TARGET/scripts/migrate.sh" "$TARGET"

ln -sfn "$TARGET" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"
mkdir -p "$BASE/current/web/tmp"
touch "$BASE/current/web/tmp/restart.txt"

URL="${MEDHUB_BASE_URL:?MEDHUB_BASE_URL must be set}"
echo "Checking $URL/api/health ..."
for attempt in 1 2 3 4 5 6; do
  if curl -fsS --max-time 10 "$URL/api/health" | grep -q '"status":"ok"'; then
    echo "Deployment OK: $TARGET"
    exit 0
  fi
  sleep 10
done

echo "Health check failed, rolling back." >&2
if [ -n "$PREVIOUS" ]; then
  "$TARGET/scripts/rollback.sh" "$PREVIOUS"
fi
exit 1
