#!/bin/zsh
set -euo pipefail

ROOT="/Users/angelvelasco/Desktop/Mitaller"
LABEL="com.mitaller.api"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$ROOT/logs"
APP_CONFIG_DIR="$HOME/Library/Application Support/Mitaller"
SERVICE_ENV="$APP_CONFIG_DIR/.env"
UID_VALUE="$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$APP_CONFIG_DIR"
chmod +x "$ROOT/scripts/start-api-service.sh"

if [[ -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env" "$SERVICE_ENV"
  chmod 600 "$SERVICE_ENV"
fi

cd "$ROOT"
/opt/homebrew/bin/npm run build:api

launchctl bootout "gui/$UID_VALUE" "$PLIST" >/dev/null 2>&1 || true

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "$ROOT" || exit 1; if [[ -f "$SERVICE_ENV" ]]; then set -a; source "$SERVICE_ENV"; set +a; elif [[ -f ./.env ]]; then set -a; source ./.env; set +a; fi; export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"; export NODE_ENV="\${NODE_ENV:-production}"; export PORT="\${PORT:-3001}"; exec /opt/homebrew/bin/npm run start:api</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/api.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/api.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

plutil -lint "$PLIST"
launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
launchctl enable "gui/$UID_VALUE/$LABEL"
launchctl kickstart -k "gui/$UID_VALUE/$LABEL"

echo "Servicio $LABEL instalado y arrancado."
echo "Config privada copiada a $SERVICE_ENV"
echo "Logs:"
echo "  $LOG_DIR/api.out.log"
echo "  $LOG_DIR/api.err.log"
