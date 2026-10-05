#!/usr/bin/env bash
# Nightly backup: the database and every uploaded file, kept for
# BACKUP_KEEP_DAYS, verified, and copied off-site if a target is set.
#
#   crontab:  30 1 * * *  /path/to/deploy/onprem/backup.sh >> …/backup.log 2>&1
#
# A backup that has never been restored is a hope, not a backup. See the
# restore drill in README.md, and run it once a term.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

set -a
# shellcheck disable=SC1091
. ./.env.onprem
set +a

dest="${BACKUP_DIR:-$here/backups}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%MZ)"
mkdir -p "$dest"

log() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Written to .partial and renamed only when complete, so a crash midway can
# never leave something that looks like a good backup.
log "database"
./compose.sh exec -T db pg_dump -h localhost -U postgres -d postgres \
  --format=custom --compress=6 > "$dest/db-$stamp.dump.partial"
# Prove the dump is readable before trusting it.
./compose.sh exec -T db pg_restore --list < "$dest/db-$stamp.dump.partial" > /dev/null
mv "$dest/db-$stamp.dump.partial" "$dest/db-$stamp.dump"

log "uploaded files"
tar -C supabase/volumes -czf "$dest/storage-$stamp.tar.gz.partial" storage
gzip -t "$dest/storage-$stamp.tar.gz.partial"
mv "$dest/storage-$stamp.tar.gz.partial" "$dest/storage-$stamp.tar.gz"

log "pruning backups older than $keep_days days"
find "$dest" -maxdepth 1 \( -name 'db-*.dump' -o -name 'storage-*.tar.gz' \) -mtime +"$keep_days" -delete
find "$dest" -maxdepth 1 -name '*.partial' -mtime +1 -delete

if [ -n "${OFFSITE_RSYNC_TARGET:-}" ]; then
  log "off-site copy to $OFFSITE_RSYNC_TARGET"
  rsync -a --delete --exclude '*.partial' --exclude '*.log' "$dest/" "$OFFSITE_RSYNC_TARGET/"
fi

log "done: db-$stamp.dump, storage-$stamp.tar.gz"
