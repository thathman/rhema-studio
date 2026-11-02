#!/usr/bin/env bash
# The camera relay in the running QA app (isolated HOME, separate identifier); see camera-relay-journey.py.
# Needs a QA build (run-native-journeys.sh makes one) and the router: scripts/fetch-mediamtx.sh, or ~/.local/mediamtx.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_BIN="$ROOT/src-tauri/target/debug/Rhema"
QA_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/rhema-relay-qa.XXXXXX")"
# The app's router outlives it when the app is stopped by a signal (#597); it is this run's by its
# settings file, inside this run's scratch folder, so no other MediaMTX is touched.
trap 'kill "${APP_PID:-}" 2>/dev/null || true; pkill -TERM -f "^[^ ]*mediamtx $QA_SCRATCH/" 2>/dev/null || true; [[ "${KEEP_QA_SCRATCH:-0}" == 1 ]] || rm -rf "$QA_SCRATCH"' EXIT
mkdir -p "$QA_SCRATCH/run/in" "$QA_SCRATCH/run/out" "$QA_SCRATCH/home"
# Beside the program, as in a release: HOME is the isolated one here.
[[ -x "$ROOT/src-tauri/target/debug/mediamtx" ]] || cp "${RHEMA_MEDIAMTX:-$HOME/.local/mediamtx/mediamtx}" "$ROOT/src-tauri/target/debug/mediamtx"
export QA_DIR="$QA_SCRATCH/run"
HOME="$QA_SCRATCH/home" RHEMA_QA_DIR="$QA_DIR" "$APP_BIN" >"$QA_SCRATCH/app.log" 2>&1 &
APP_PID=$!
sleep 4
kill -0 "$APP_PID" 2>/dev/null || { echo "The QA app exited at launch: another Rhema QA app is probably running." >&2; exit 3; }
status=0
"$ROOT/scripts/mac-qa/camera-relay-journey.py" 18080 || status=$?
grep -E "camera router: |Remote access|Remote device role" "$QA_SCRATCH/app.log" | cut -c1-140 || true
exit "$status"
