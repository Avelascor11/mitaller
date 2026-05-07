#!/bin/zsh
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.mitaller.print-agent.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Agente de impresion eliminado"
