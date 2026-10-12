#!/bin/zsh
# Installs a launchd agent that runs refresh-device.sh when you log in and every 3 hours after that.
# Undo with: launchctl bootout gui/$(id -u)/com.ryanfitzgerald.comeback.refresh && rm ~/Library/LaunchAgents/com.ryanfitzgerald.comeback.refresh.plist
HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.ryanfitzgerald.comeback.refresh.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ryanfitzgerald.comeback.refresh</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$HERE/refresh-device.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>10800</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/come-back-refresh.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/come-back-refresh.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.ryanfitzgerald.comeback.refresh" 2>/dev/null
launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "Auto-refresh installed."
