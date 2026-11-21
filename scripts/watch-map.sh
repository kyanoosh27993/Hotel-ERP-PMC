#!/bin/bash
# watch-map.sh — ناظر نقشه Graphify (قانون ۵ مالک)
# هر تغییر فایلی در مخزن، نقشه graphify-out را دوباره می‌سازد.
# اجرا: bash scripts/watch-map.sh   (پس‌زمینه: nohup bash scripts/watch-map.sh >/tmp/watch-map.log 2>&1 &)
set -u
cd "$(dirname "$0")/.."
LAST=$(find . -type f -not -path './.git/*' -not -path './graphify-out/*' -not -name '*.pyc' -printf '%T@ %p\n' | sort | tail -1)
while true; do
  sleep 3
  CUR=$(find . -type f -not -path './.git/*' -not -path './graphify-out/*' -not -name '*.pyc' -printf '%T@ %p\n' | sort | tail -1)
  if [ "$CUR" != "$LAST" ]; then
    LAST=$CUR
    python3 scripts/generate-map.py
    echo "$(date '+%H:%M:%S') map regenerated"
  fi
done
