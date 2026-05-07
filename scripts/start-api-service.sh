#!/bin/zsh
set -euo pipefail

ROOT="/Users/angelvelasco/Desktop/Mitaller"
LOG_DIR="$ROOT/logs"
APP_CONFIG_DIR="$HOME/Library/Application Support/Mitaller"
SERVICE_ENV="$APP_CONFIG_DIR/.env"

mkdir -p "$LOG_DIR"
cd "$ROOT"

if [[ -f "$SERVICE_ENV" ]]; then
  set -a
  source "$SERVICE_ENV"
  set +a
elif [[ -f "$ROOT/.env" ]]; then
  set -a
  source "$ROOT/.env"
  set +a
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3001}"

exec /opt/homebrew/bin/npm run start:api
