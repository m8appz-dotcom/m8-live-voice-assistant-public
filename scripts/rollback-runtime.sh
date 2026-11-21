#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${1:-/home/m8apps/openclaw-live}"
BACKUP_ROOT="${BACKUP_ROOT:-${RUNTIME_DIR}-backups}"
TARGET_INPUT="${2:-latest}"
PROCESS_PATTERN="node ${RUNTIME_DIR}/proxy.mjs$"

if [ "$TARGET_INPUT" = "latest" ]; then
  TARGET_DIR="$BACKUP_ROOT/latest"
else
  TARGET_DIR="$BACKUP_ROOT/$TARGET_INPUT"
fi

if [ ! -e "$TARGET_DIR" ]; then
  echo "Backup not found: $TARGET_DIR" >&2
  exit 1
fi

TARGET_DIR="$(readlink -f "$TARGET_DIR")"

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

echo "== rollback from =="
echo "$TARGET_DIR"

cp "$TARGET_DIR/proxy.mjs" "$RUNTIME_DIR/proxy.mjs"
cp "$TARGET_DIR/package.json" "$RUNTIME_DIR/package.json"
cp "$TARGET_DIR/package-lock.json" "$RUNTIME_DIR/package-lock.json"
rm -rf "$RUNTIME_DIR/dist"
cp -a "$TARGET_DIR/dist" "$RUNTIME_DIR/dist"
if [ -f "$TARGET_DIR/.gitignore.backup" ]; then
  cp "$TARGET_DIR/.gitignore.backup" "$RUNTIME_DIR/.gitignore"
fi
if [ -f "$TARGET_DIR/.env.backup" ]; then
  cp "$TARGET_DIR/.env.backup" "$RUNTIME_DIR/.env"
fi

cd "$RUNTIME_DIR"
npm install --omit=dev
node --check "$RUNTIME_DIR/proxy.mjs"
restart_runtime
curl -fsS http://127.0.0.1:7300/api/health | sed -n '1,120p'
