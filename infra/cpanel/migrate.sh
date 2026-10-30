#!/usr/bin/env bash
# Backs up the database, then applies the migrations of a release.
# Usage: scripts/migrate.sh <release directory>
set -euo pipefail

RELEASE="${1:?usage: migrate.sh <release directory>}"
BASE="${MEDHUB_HOME:-$HOME/medhub}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BASE/shared/backups"
echo "pg_dump before migration..."
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$BASE/shared/backups/pre-migrate-$STAMP.dump"
sha256sum "$BASE/shared/backups/pre-migrate-$STAMP.dump" > "$BASE/shared/backups/pre-migrate-$STAMP.dump.sha256"

MEDHUB_MIGRATIONS_DIR="$RELEASE/migrations" node "$RELEASE/migrations/migrate.mjs"
