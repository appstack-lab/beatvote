#!/usr/bin/env bash
# Runs a JavaScript expression in the BeatVote host page on the connected Android device (debug builds only) and
# prints the result. Uses the WebView remote debugging socket of the app process.
#
#   scripts/android/page.sh "document.title"
#   scripts/android/page.sh --restart "localStorage.getItem('dj.party')"   # force-stop + relaunch the app first
#
# With several devices connected, set ANDROID_SERIAL (e.g. ANDROID_SERIAL=<device-ip>:<port>).
set -euo pipefail
cd "$(dirname "$0")"
PKG=com.beatvote.app
PORT=9333

if [ "${1:-}" = "--restart" ]; then
  shift
  adb shell am force-stop $PKG
  adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi
EXPR=${1:?usage: page.sh [--restart] '<js expression>'}

pid=""
for _ in $(seq 1 30); do
  pid=$(adb shell pidof $PKG || true)
  [ -n "$pid" ] && adb shell cat /proc/net/unix | grep -q "webview_devtools_remote_$pid" && break
  sleep 0.5
done
[ -n "$pid" ] || { echo "app not running" >&2; exit 1; }
adb forward --remove tcp:$PORT >/dev/null 2>&1 || true
adb forward tcp:$PORT "localabstract:webview_devtools_remote_$pid" >/dev/null

ws=""
for _ in $(seq 1 30); do
  ws=$(curl -s -m 2 "http://127.0.0.1:$PORT/json" |
    python3 -c "import json,sys;p=[x for x in json.load(sys.stdin) if ':4173' in x['url']];print(p[0]['webSocketDebuggerUrl'] if p else '')" 2>/dev/null || true)
  [ -n "$ws" ] && break
  sleep 0.5
done
[ -n "$ws" ] || { echo "host page (127.0.0.1:4173) not found" >&2; exit 1; }
node cdp.mjs "$ws" "$EXPR"
