#!/usr/bin/env bash
# Encrypted PostgreSQL backup with checksum (docs/09-hebergement-deploiement.md section 7).
# Usage: scripts/backup.sh daily|weekly|monthly
# Copy to an external destination (S3 compatible or SFTP) is configured with MEDHUB_BACKUP_REMOTE_*.
set -euo pipefail

KIND="${1:-daily}"
BASE="${MEDHUB_HOME:-$HOME/medhub}"
DIR="$BASE/shared/backups/$KIND"
: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${MEDHUB_BACKUP_ENCRYPTION_KEY:?MEDHUB_BACKUP_ENCRYPTION_KEY must be set}"

mkdir -p "$DIR"
FILE="$DIR/medhub-$(date +%Y%m%d-%H%M%S).dump.enc"

pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:MEDHUB_BACKUP_ENCRYPTION_KEY -out "$FILE"
sha256sum "$FILE" > "$FILE.sha256"

# Retention of backup files only (7 daily, 4 weekly, 12 monthly). Application data is never purged.
case "$KIND" in
  daily) KEEP=7 ;;
  weekly) KEEP=4 ;;
  monthly) KEEP=12 ;;
  *) KEEP=7 ;;
esac
ls -1t "$DIR"/*.dump.enc 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"
done

echo "Backup written: $FILE"
