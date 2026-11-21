#!/usr/bin/env bash
# restore.sh — بازیابی از بکاپ رمزشده (فقط با تأیید دو نفره در عملیات واقعی — DR runbook)
# استفاده: BACKUP_PASSPHRASE=... DATABASE_URL=... restore.sh backups/hotel_erp_YYYYMMDDTHHMMSSZ.sql.gz.enc
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
TARGET="${1:?usage: restore.sh <file.sql.gz.enc>}"

# پارامترهای اضافه (مثل ?schema=public مخصوص Prisma) برای psql نامعتبرند
LIBPQ_URL="${DATABASE_URL%%\?*}"

[ -f "$TARGET" ] || { echo "file not found: $TARGET"; exit 1; }

# صحت‌سنجی checksum اگر موجود باشد
if [ -f "$TARGET.sha256" ]; then
  (cd "$(dirname "$TARGET")" && openssl dgst -sha256 "$(basename "$TARGET")")
  grep -q "$(basename "$TARGET")" "$TARGET.sha256" || { echo "checksum file mismatch — verify manually"; exit 1; }
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "pass:${BACKUP_PASSPHRASE}" -in "$TARGET" \
  | gunzip | psql "$LIBPQ_URL" --single-transaction --set ON_ERROR_STOP=1

echo "restore ok: $TARGET"
