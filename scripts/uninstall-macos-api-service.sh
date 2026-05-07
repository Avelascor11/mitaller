#!/bin/zsh
set -euo pipefail

LABEL="com.mitaller.api"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_VALUE="$(id -u)"

launchctl bootout "gui/$UID_VALUE" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"

echo "Servicio $LABEL parado y eliminado."
