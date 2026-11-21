#!/usr/bin/env bash
# backup.sh — بکاپ روزانه رمزگذاری‌شده (F1-T8 — Disaster Recovery)
# pg_dump | gzip | AES-256-CBC (openssl) — نگهداری BACKUP_KEEP_DAYS روز
# cron پیشنهادی: 0 2 * * *  /app/infrastructure/backup/backup.sh >> /var/log/hotel-erp-backup.log 2>&1
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

# پارامترهای اضافه (مثل ?schema=public مخصوص Prisma) برای ابزارهای libpq نامعتبرند
LIBPQ_URL="${DATABASE_URL%%\?*}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/hotel_erp_${STAMP}.sql.gz.enc"

pg_dump "$LIBPQ_URL" --no-owner --no-privileges | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "pass:${BACKUP_PASSPHRASE}" \
  -out "$TARGET"

# صحت‌سنجی بسته: رمزگشایی + تست فشرده (بدون آن، بکاپ ناقص = بدون بکاپ)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "pass:${BACKUP_PASSPHRASE}" -in "$TARGET" \
  | gzip -t
SHA="$(openssl dgst -sha256 "$TARGET" | awk '{print $2}')"
printf '%s  %s\n' "$SHA" "$(basename "$TARGET")" > "$TARGET.sha256"

# پاکسازی نسخه‌های قدیمی‌تر از KEEP_DAYS
find "$BACKUP_DIR" -name 'hotel_erp_*.sql.gz.enc' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'hotel_erp_*.sql.gz.enc.sha256' -mtime +"$KEEP_DAYS" -delete

echo "backup ok: $TARGET ($(du -h "$TARGET" | cut -f1)) sha256=${SHA:0:16}…"
