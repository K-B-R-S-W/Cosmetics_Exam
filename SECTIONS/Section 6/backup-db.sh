#!/usr/bin/env bash
# infra/ec2/backup-db.sh -- dump the exam database and (optionally) copy it to Google Drive with rclone.
# Needs SUPABASE_DB_URL (use the SESSION POOLER connection string from the Supabase dashboard; the direct
# connection can be IPv6-only and EC2 may not reach it) and a pg_dump at least as new as the Supabase server (verify).
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL}"
OUT_DIR="${OUT_DIR:-/var/backups/exam}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT_DIR}/exam-${STAMP}.dump"
umask 077
mkdir -p "$OUT_DIR"
pg_dump "$SUPABASE_DB_URL" --schema=public --format=custom --no-owner --no-privileges --file "$FILE"
echo "Wrote $FILE ($(du -h "$FILE" | cut -f1))"
# Keep the last 14 dumps locally
find "$OUT_DIR" -name 'exam-*.dump' -type f -printf '%T@ %p\n' | sort -rn | tail -n +15 | cut -d' ' -f2- | xargs -r rm -f
# Optional: copy to Google Drive. One-time setup: rclone config  (remote name below)
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  rclone copy "$FILE" "${RCLONE_REMOTE}" && echo "Copied to ${RCLONE_REMOTE}"
fi
