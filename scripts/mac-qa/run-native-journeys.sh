#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QA_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/rhema-native-qa.XXXXXX")"
QA_RUN="$QA_SCRATCH/qa-run"
QA_HOME="$QA_SCRATCH/home"
APP_BIN="${CARGO_TARGET_DIR:-$ROOT/src-tauri/target}/debug/Rhema"
CREATED_BIBLE_DB=0
BACKED_UP_BIBLE_SIDECARS=0
HAD_BIBLE_SHM=0
HAD_BIBLE_WAL=0
APP_PID=""

mkdir -p "$QA_RUN/in" "$QA_RUN/out" "$QA_HOME"

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [[ "$CREATED_BIBLE_DB" == 1 ]]; then
    rm -f "$ROOT/data/rhema.db"
    if [[ "$BACKED_UP_BIBLE_SIDECARS" == 1 ]]; then
      rm -f "$ROOT/data/rhema.db-shm" "$ROOT/data/rhema.db-wal"
      if [[ "$HAD_BIBLE_SHM" == 1 ]]; then cp -p "$QA_SCRATCH/original-rhema.db-shm" "$ROOT/data/rhema.db-shm"; fi
      if [[ "$HAD_BIBLE_WAL" == 1 ]]; then cp -p "$QA_SCRATCH/original-rhema.db-wal" "$ROOT/data/rhema.db-wal"; fi
    fi
  fi
  if [[ "${KEEP_QA_SCRATCH:-0}" == 1 ]]; then
    mkdir -p "$QA_SCRATCH/artifacts"
    for artifact in \
      "$QA_RUN/out/hymn-journey.json" \
      "$QA_RUN/out/scene-save-journey.json" \
      "$QA_RUN/out/take-failure-journey.json" \
      "$QA_RUN/out/setup-recording-output.json" \
      "$QA_RUN/out/recording-output-ready.json" \
      "$QA_RUN/out/native-recording-journey.json" \
      "$QA_RUN/out/live-empty-service.json" \
      "$QA_RUN/out/live-configured-service.json" \
      "$QA_RUN/out/live-find-drawer.json" \
      "$QA_SCRATCH/result.json" \
      "$QA_SCRATCH/scene-result.json" \
      "$QA_SCRATCH/take-failure-result.json" \
      "$QA_SCRATCH/recording-setup-result.json" \
      "$QA_SCRATCH/recording-output-result.json" \
      "$QA_SCRATCH/recording-result.json" \
      "$QA_SCRATCH/recording-probe.json" \
      "$QA_SCRATCH/app.log"; do
      if [[ -f "$artifact" ]]; then cp "$artifact" "$QA_SCRATCH/artifacts/"; fi
    done
    if [[ -d "$QA_SCRATCH/recording-probe" ]]; then cp -R "$QA_SCRATCH/recording-probe" "$QA_SCRATCH/artifacts/"; fi
  fi
  rm -f "$QA_SCRATCH/original-rhema.db-shm" "$QA_SCRATCH/original-rhema.db-wal"
  if [[ "${KEEP_QA_SCRATCH:-0}" == 1 ]]; then
    printf 'QA scratch retained at %s\n' "$QA_SCRATCH"
  else
    rm -rf "$QA_SCRATCH"
  fi
}
trap cleanup EXIT

if [[ ! -f "$ROOT/data/rhema.db" ]]; then
  CREATED_BIBLE_DB=1
  if [[ -e "$ROOT/data/rhema.db-shm" ]]; then
    cp -p "$ROOT/data/rhema.db-shm" "$QA_SCRATCH/original-rhema.db-shm"
    HAD_BIBLE_SHM=1
  fi
  if [[ -e "$ROOT/data/rhema.db-wal" ]]; then
    cp -p "$ROOT/data/rhema.db-wal" "$QA_SCRATCH/original-rhema.db-wal"
    HAD_BIBLE_WAL=1
  fi
  BACKED_UP_BIBLE_SIDECARS=1
  rm -f "$ROOT/data/rhema.db-shm" "$ROOT/data/rhema.db-wal"
  python3 - "$ROOT/data/rhema.db" "$ROOT/data/schema.sql" <<'PY'
import sqlite3
import sys
from pathlib import Path

database_path, schema_path = sys.argv[1:]
with sqlite3.connect(database_path) as connection:
    connection.executescript(Path(schema_path).read_text(encoding="utf-8"))
    connection.execute(
        "INSERT INTO translations (abbreviation, title, language, license, is_copyrighted, is_downloaded) "
        "VALUES ('QA', 'QA fixture (no Bible text)', 'en', 'Synthetic QA data', 0, 0)"
    )
PY
fi

if [[ "${SKIP_QA_BUILD:-0}" != 1 ]]; then
  if command -v brew >/dev/null 2>&1 && [[ -z "${ORT_LIB_LOCATION:-}" ]]; then
    ORT_LIB_LOCATION="$(brew --prefix onnxruntime)/lib"
    export ORT_LIB_LOCATION
  fi
  export ORT_PREFER_DYNAMIC_LINK=1
  cd "$ROOT"
  bun run tauri build --debug --no-bundle --features qa-bridge --config src-tauri/tauri.qa.conf.json
fi

if [[ ! -x "$APP_BIN" ]]; then
  echo "QA app binary not found: $APP_BIN" >&2
  exit 1
fi

export QA_DIR="$QA_RUN"
HOME="$QA_HOME" RHEMA_QA_DIR="$QA_RUN" "$APP_BIN" >"$QA_SCRATCH/app.log" 2>&1 &
APP_PID=$!
# A second copy with this identifier exits 0 at once, whatever its HOME: the lock is /tmp/<identifier>_si.sock.
sleep 2
if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "The QA app exited at launch: another Rhema QA app is probably running on this computer. Wait for it, then run this again." >&2
  exit 3
fi

capture_live_state() {
  local name="$1"
  local scenario="$2"
  "$ROOT/scripts/mac-qa/qa.py" main "live-${name}" "$ROOT/scripts/mac-qa/${scenario}" 60 > "$QA_SCRATCH/live-${name}.json"
  mkdir -p "$QA_SCRATCH/artifacts"
  cp "$QA_RUN/out/live-${name}.json" "$QA_SCRATCH/artifacts/live-${name}-state.json"
  sleep 1
  capture_live_window "live-${name}"
}

capture_live_window() {
  local name="$1"
  local screenshot="$QA_SCRATCH/artifacts/${name}.png"
  mkdir -p "$QA_SCRATCH/artifacts"
  local window_id
  window_id="$(swift "$ROOT/scripts/mac-qa/rhema-window-id.swift" "$APP_PID")"
  screencapture -x -l "$window_id" "$screenshot"
  python3 - "$screenshot" <<'PY'
import struct
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = path.read_bytes()
if len(data) < 8000 or data[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit(f"Native Live screenshot is missing, empty, or not PNG: {path}")
width, height = struct.unpack(">II", data[16:24])
if width < 640 or height < 400:
    raise SystemExit(f"Native Live screenshot is too small ({width}x{height}): {path}")
print(f"Captured {path.name}: {width}x{height}, {len(data)} bytes")
PY
}

resize_live_window() {
  local name="$1"
  local width="$2"
  local height="$3"
  if ! "$ROOT/scripts/mac-qa/qa.py" main "$name" - 20 > "$QA_SCRATCH/$name.json" <<EOF
const label = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label
if (!label) throw new Error("The current native window label is unavailable")
const fullscreen = () => window.__TAURI_INTERNALS__.invoke("plugin:window|is_fullscreen", { label })
const maximized = () => window.__TAURI_INTERNALS__.invoke("plugin:window|is_maximized", { label })
const startedFullscreen = await fullscreen()
const startedMaximized = await maximized()
await window.__TAURI_INTERNALS__.invoke("plugin:window|set_fullscreen", { label, value: false })
if (startedFullscreen || startedMaximized) {
  let stableWindowSamples = 0
  for (let attempt = 0; stableWindowSamples < 10 && attempt < 60; attempt += 1) {
    const isFullscreen = await fullscreen()
    const isMaximized = await maximized()
    if (isFullscreen) {
      await window.__TAURI_INTERNALS__.invoke("plugin:window|set_fullscreen", { label, value: false })
      stableWindowSamples = 0
    } else if (isMaximized) {
      await window.__TAURI_INTERNALS__.invoke("plugin:window|unmaximize", { label })
      stableWindowSamples = 0
    } else {
      stableWindowSamples += 1
    }
    await sleep(100)
  }
  if (stableWindowSamples < 10) {
    throw new Error("Native window did not settle out of fullscreen/maximized state before resize: " + JSON.stringify({ fullscreen: await fullscreen(), maximized: await maximized() }))
  }
}
const currentSize = () => ({ width: window.innerWidth, height: window.innerHeight })
let previousSize = currentSize()
let stableSamples = 0
for (let attempt = 0; stableSamples < 2 && attempt < 30; attempt += 1) {
  await sleep(100)
  const observedSize = currentSize()
  if (observedSize.width === previousSize.width && observedSize.height === previousSize.height) {
    stableSamples += 1
  } else {
    stableSamples = 0
  }
  previousSize = observedSize
}
if (stableSamples < 2) throw new Error("Native window size did not settle after fullscreen exit: " + JSON.stringify(previousSize))
const resize = (width, height) => window.__TAURI_INTERNALS__.invoke("plugin:window|set_size", {
  label,
  value: { Logical: { width, height } },
})
await resize($width, $height)
await sleep(500)
let actual = currentSize()
for (let correction = 0; correction < 2 && (actual.width !== $width || actual.height !== $height); correction += 1) {
  await resize($width + ($width - actual.width), $height + ($height - actual.height))
  await sleep(500)
  actual = currentSize()
}
if ((actual.width !== $width || actual.height !== $height) && $width >= 1920 && $height >= 1080) {
  await window.__TAURI_INTERNALS__.invoke("plugin:window|set_fullscreen", { label, value: true })
  await sleep(1000)
  actual = { width: window.innerWidth, height: window.innerHeight }
}
if (actual.width !== $width || actual.height !== $height) {
  throw new Error("Requested " + $width + "x" + $height + ", native content area is " + actual.width + "x" + actual.height + ", fullscreen=" + await fullscreen() + ", maximized=" + await maximized())
}
const transport = document.querySelector('[role="toolbar"][aria-label="Presentation controls"]')
const previewPanel = document.querySelector('[data-slot="preview-panel"]')
const preview = previewPanel?.parentElement
const program = document.querySelector('[data-studio-live]')?.parentElement
const quickScreens = document.querySelector('[role="group"][aria-label="Quick screens"]')
if (!transport || !preview || !program || !quickScreens) {
  throw new Error("Live layout is missing Preview, Program, transport, or quick screens")
}
const scrollRegion = transport.parentElement
if (scrollRegion && getComputedStyle(scrollRegion).overflowY === "auto") {
  scrollRegion.scrollTop = 0
  await sleep(50)
}
const rect = (element) => {
  const { top, right, bottom, left } = element.getBoundingClientRect()
  return { top, right, bottom, left }
}
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
const transportRect = rect(transport)
const previewRect = rect(preview)
const programRect = rect(program)
const quickScreensRect = rect(quickScreens)
if (transportRect.top < 0 || transportRect.bottom > actual.height) {
  throw new Error("Presentation controls are outside the viewport: " + JSON.stringify({ viewport: actual, transport: transportRect }))
}
for (const [name, panelRect] of [["Preview", previewRect], ["Program and scenes", programRect], ["Quick screens", quickScreensRect]]) {
  if (overlaps(transportRect, panelRect)) {
    throw new Error("Presentation controls overlap " + name + ": " + JSON.stringify({ viewport: actual, transport: transportRect, panel: panelRect }))
  }
}
return {
  ...actual,
  devicePixelRatio: window.devicePixelRatio,
  transport: transportRect,
  preview: previewRect,
  programAndScenes: programRect,
  quickScreens: quickScreensRect,
}
EOF
  then
    mkdir -p "$QA_SCRATCH/artifacts"
    cp "$QA_SCRATCH/$name.json" "$QA_SCRATCH/artifacts/$name-result.json"
    cat "$QA_SCRATCH/$name.json" >&2
    return 1
  fi
  mkdir -p "$QA_SCRATCH/artifacts"
  cp "$QA_RUN/out/$name.json" "$QA_SCRATCH/artifacts/$name.json"
}

capture_live_viewports() {
  local state="$1"
  local viewport width height
  for viewport in 1024x700 1366x768 1702x895 1920x1080; do
    width="${viewport%x*}"
    height="${viewport#*x}"
    resize_live_window "live-${state}-${viewport}-viewport" "$width" "$height"
    sleep 1
    capture_live_window "live-${state}-${viewport}"
  done
  # Return to the QA window's configured size for the next scenario.
  resize_live_window "live-${state}-viewport-reset" 1280 800
}

# Capture both states from the built Tauri window. These PNGs come from the
# native app window, not the browser shim or an illustrative mockup.
capture_live_state empty-service live-empty-service.js
capture_live_viewports empty-service
capture_live_state configured-service live-configured-service.js
capture_live_viewports configured-service
capture_live_state find-drawer live-find-drawer.js
if [[ "${LIVE_SCREENSHOTS_ONLY:-0}" == 1 ]]; then
  echo "Native Live screenshots captured; LIVE_SCREENSHOTS_ONLY=1 skips the longer recorder and scene journeys."
  exit 0
fi

set +e
{
  cat "$ROOT/scripts/mac-qa/hymn-journey.js"
  printf '\nreturn await runScenario()\n'
} | "$ROOT/scripts/mac-qa/qa.py" main hymn-journey - 60 >"$QA_SCRATCH/result.json"
QA_STATUS=$?
set -e

if [[ "$QA_STATUS" != 0 ]]; then
  cat "$QA_SCRATCH/result.json" >&2
  cat "$QA_SCRATCH/app.log" >&2
  exit "$QA_STATUS"
fi

python3 - "$QA_RUN/out/hymn-journey.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
if not report.get("ok"):
    print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)
print(json.dumps(report.get("result"), ensure_ascii=False, indent=2))
PY

set +e
{
  cat "$ROOT/scripts/mac-qa/scene-save-journey.js"
  printf '\nreturn await runScenario()\n'
} | "$ROOT/scripts/mac-qa/qa.py" main scene-save-journey - 60 >"$QA_SCRATCH/scene-result.json"
SCENE_STATUS=$?
set -e

if [[ "$SCENE_STATUS" != 0 ]]; then
  cat "$QA_SCRATCH/scene-result.json" >&2
  cat "$QA_SCRATCH/app.log" >&2
  exit "$SCENE_STATUS"
fi

python3 - "$QA_RUN/out/scene-save-journey.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
if not report.get("ok"):
    print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)
print(json.dumps(report.get("result"), ensure_ascii=False, indent=2))
PY

set +e
{
  cat "$ROOT/scripts/mac-qa/take-failure-journey.js"
  printf '\nreturn await runScenario()\n'
} | "$ROOT/scripts/mac-qa/qa.py" main take-failure-journey - 60 >"$QA_SCRATCH/take-failure-result.json"
TAKE_FAILURE_STATUS=$?
set -e

if [[ "$TAKE_FAILURE_STATUS" != 0 ]]; then
  cat "$QA_SCRATCH/take-failure-result.json" >&2
  cat "$QA_SCRATCH/app.log" >&2
  exit "$TAKE_FAILURE_STATUS"
fi

python3 - "$QA_RUN/out/take-failure-journey.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
if not report.get("ok"):
    print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)
print(json.dumps(report.get("result"), ensure_ascii=False, indent=2))
PY

set +e
"$ROOT/scripts/mac-qa/qa.py" main setup-recording-output "$ROOT/scripts/mac-qa/setup-recording-output.js" 30 >"$QA_SCRATCH/recording-setup-result.json"
RECORDING_SETUP_STATUS=$?
if [[ "$RECORDING_SETUP_STATUS" == 0 ]]; then
  "$ROOT/scripts/mac-qa/qa.py" broadcast-main recording-output-ready "$ROOT/scripts/mac-qa/recording-output-ready.js" 30 >"$QA_SCRATCH/recording-output-result.json"
  RECORDING_OUTPUT_STATUS=$?
else
  RECORDING_OUTPUT_STATUS=1
fi
if [[ "$RECORDING_SETUP_STATUS" == 0 && "$RECORDING_OUTPUT_STATUS" == 0 ]]; then
  "$ROOT/scripts/mac-qa/qa.py" main native-recording-journey "$ROOT/scripts/mac-qa/recording-journey.js" 60 >"$QA_SCRATCH/recording-result.json"
  RECORDING_STATUS=$?
else
  RECORDING_STATUS=1
fi
set -e

if [[ "$RECORDING_STATUS" != 0 ]]; then
  cat "$QA_SCRATCH/recording-setup-result.json" >&2 || true
  cat "$QA_SCRATCH/recording-output-result.json" >&2 || true
  cat "$QA_SCRATCH/recording-result.json" >&2 || true
  cat "$QA_SCRATCH/app.log" >&2
  exit "$RECORDING_STATUS"
fi

python3 - "$QA_RUN/out/native-recording-journey.json" "$QA_SCRATCH/recording-path.txt" "$QA_HOME" <<'PY'
import json
import sys
from pathlib import Path

report_path, recording_path_file, qa_home = sys.argv[1:]
with open(report_path, encoding="utf-8") as report_file:
    report = json.load(report_file)
if not report.get("ok"):
    print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)
result = report.get("result") or {}
recording = Path(result.get("file", {}).get("path", "")).resolve()
home = Path(qa_home).resolve()
if home not in recording.parents or recording.name != "recording.mp4":
    raise SystemExit(f"Recording escaped the isolated QA home or has an unexpected name: {recording}")
if recording.parent.name != result.get("sessionId"):
    raise SystemExit(f"Recording is outside its session folder: {recording}")
Path(recording_path_file).write_text(str(recording) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
PY

IFS= read -r RECORDING_FILE < "$QA_SCRATCH/recording-path.txt"
mkdir -p "$QA_SCRATCH/recording-probe"
swift "$ROOT/scripts/mac-qa/probe-recording.swift" "$RECORDING_FILE" "$QA_SCRATCH/recording-probe" 0.05 > "$QA_SCRATCH/recording-probe.json"
python3 - "$QA_SCRATCH/recording-probe.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as probe_file:
    probe = json.load(probe_file)
if probe.get("videoTracks") != 1:
    raise SystemExit(f"Expected one playable video track: {json.dumps(probe, indent=2)}")
if probe.get("audioTracks") != 0:
    raise SystemExit(f"Explicit silent QA unexpectedly produced audio: {json.dumps(probe, indent=2)}")
if probe.get("durationS", 0) < 1.5 or probe.get("videoFrames", 0) < 45:
    raise SystemExit(f"Finalized MP4 has no usable duration/frames: {json.dumps(probe, indent=2)}")
if probe.get("size") != [1280, 720]:
    raise SystemExit(f"Unexpected final MP4 dimensions: {json.dumps(probe, indent=2)}")
if not probe.get("stills"):
    raise SystemExit(f"AVFoundation could not decode a still frame: {json.dumps(probe, indent=2)}")
print(json.dumps(probe, ensure_ascii=False, indent=2))
PY

if grep -Eq 'database error: no such table: (translations|books)' "$QA_SCRATCH/app.log"; then
  echo "QA Bible fixture is missing tables used during app startup:" >&2
  grep -E 'database error: no such table: (translations|books)' "$QA_SCRATCH/app.log" >&2
  exit 1
fi
