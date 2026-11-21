#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
RUNTIME_DIR="${2:-/home/m8apps/openclaw-live}"
BACKUP_ROOT="${BACKUP_ROOT:-${RUNTIME_DIR}-backups}"
PROCESS_PATTERN="node ${RUNTIME_DIR}/proxy.mjs$"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
LATEST_LINK="$BACKUP_ROOT/latest"

if [ ! -f "$SRC_DIR/package.json" ]; then
  echo "Source package.json not found: $SRC_DIR" >&2
  exit 1
fi

if [ ! -f "$RUNTIME_DIR/.env" ]; then
  echo "Runtime .env not found: $RUNTIME_DIR/.env" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

restart_runtime() {
  local old_pids
  old_pids="$(ps -eo pid=,args= | awk -v pat="$PROCESS_PATTERN" '$0 ~ pat {print $1}')"
  for pid in $old_pids; do
    kill "$pid"
  done
  sleep 2
  nohup node "$RUNTIME_DIR/proxy.mjs" >> "$RUNTIME_DIR/proxy.log" 2>&1 &
  sleep 3
  ps -eo pid=,args= | awk -v pat="$PROCESS_PATTERN" '$0 ~ pat {print}'
}

smoke_check() {
  curl -fsS http://127.0.0.1:7300/api/health | sed -n '1,120p'
}

echo "== backup runtime =="
cp -a "$RUNTIME_DIR/proxy.mjs" "$BACKUP_DIR/"
cp -a "$RUNTIME_DIR/package.json" "$BACKUP_DIR/"
cp -a "$RUNTIME_DIR/package-lock.json" "$BACKUP_DIR/"
cp -a "$RUNTIME_DIR/.env" "$BACKUP_DIR/.env.backup"
cp -a "$RUNTIME_DIR/.gitignore" "$BACKUP_DIR/.gitignore.backup" 2>/dev/null || true
cp -a "$RUNTIME_DIR/dist" "$BACKUP_DIR/dist"
printf '%s\n' "$STAMP" > "$BACKUP_DIR/backup-id.txt"
ln -sfn "$BACKUP_DIR" "$LATEST_LINK"
printf 'backup_dir=%s\n' "$BACKUP_DIR"

echo "== build web =="
cd "$SRC_DIR"
npm run build:web

echo "== sync runtime files =="
cp "$SRC_DIR/proxy.mjs" "$RUNTIME_DIR/proxy.mjs"
cp "$SRC_DIR/package.json" "$RUNTIME_DIR/package.json"
cp "$SRC_DIR/package-lock.json" "$RUNTIME_DIR/package-lock.json"
rm -rf "$RUNTIME_DIR/dist"
cp -a "$SRC_DIR/dist" "$RUNTIME_DIR/dist"

echo "== install runtime deps =="
cd "$RUNTIME_DIR"
npm install --omit=dev
node --check "$RUNTIME_DIR/proxy.mjs"

echo "== restart runtime =="
restart_runtime

echo "== smoke =="
smoke_check
