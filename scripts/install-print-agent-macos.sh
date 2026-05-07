#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.mitaller.print-agent.plist"
NODE_BIN="$(command -v node)"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "No existe $ROOT_DIR/.env"
  exit 1
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mitaller.print-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>set -a; source "$ROOT_DIR/.env"; set +a; export MITALLER_API_URL="\${MITALLER_API_URL:-https://mitaller-production-4755.up.railway.app}"; "$NODE_BIN" "$ROOT_DIR/scripts/print-agent.mjs"</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>StandardOutPath</key>
  <string>$ROOT_DIR/logs/print-agent.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT_DIR/logs/print-agent.err.log</string>
</dict>
</plist>
PLIST

mkdir -p "$ROOT_DIR/logs"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
launchctl start com.mitaller.print-agent
echo "Agente de impresion instalado: com.mitaller.print-agent"
