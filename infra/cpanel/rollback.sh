#!/usr/bin/env bash
# Points `current` back to a previous release and restarts Passenger.
# Migrations stay compatible with the previous code for one version, so no schema rollback is needed.
# Usage: scripts/rollback.sh <previous release directory>
set -euo pipefail

PREVIOUS="${1:?usage: rollback.sh <previous release directory>}"
BASE="${MEDHUB_HOME:-$HOME/medhub}"

ln -sfn "$PREVIOUS" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"
mkdir -p "$BASE/current/web/tmp"
touch "$BASE/current/web/tmp/restart.txt"
echo "Rolled back to $PREVIOUS"
