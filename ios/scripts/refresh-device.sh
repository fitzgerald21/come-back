#!/bin/zsh
# Re-signs and reinstalls the app on the iPhone. A free Apple ID signs apps for only 7 days, and reinstalling restarts that clock.
# Run by launchd (see scripts/install-auto-refresh.sh). Skips quietly if the phone isn't reachable and tries again at the next run.
export PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin
cd "$(dirname "$0")/.." || exit 1
DEVICE="31392DC2-BBDC-57C8-BDB0-61618D21E296"      # iPhone (186); see `xcrun devicectl list devices`
STAMP="$HOME/.come-back-last-refresh"
MAX_AGE_DAYS=${1:-3}                                # reinstall once the last one is this old (signing lasts 7)
now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || echo 0)
age_days=$(( (now - last) / 86400 ))

if (( age_days < MAX_AGE_DAYS )); then exit 0; fi
echo "$(date) refreshing (last install ${age_days}d ago)"

state=$(xcrun devicectl list devices 2>/dev/null | grep "$DEVICE")
if [[ "$state" != *connected* && "$state" != *available* ]]; then
  echo "phone not reachable, will retry"
  (( age_days >= 5 )) && osascript -e 'display notification "Plug in your iPhone or join the same Wi-Fi so Come back can be refreshed before it expires." with title "Come back needs a refresh"'
  exit 0
fi

xcodebuild -project ComeBack.xcodeproj -scheme ComeBack -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath build-device -allowProvisioningUpdates build 2>&1 | grep -E "error:|BUILD S|BUILD F"
if xcrun devicectl device install app --device "$DEVICE" "build-device/Build/Products/Release-iphoneos/Come back.app" 2>&1 | grep -q "App installed"; then
  echo "$now" > "$STAMP"
  echo "installed ok"
else
  echo "install failed"
  (( age_days >= 5 )) && osascript -e 'display notification "The automatic refresh is failing. Open Xcode and run the app once." with title "Come back needs a refresh"'
fi
