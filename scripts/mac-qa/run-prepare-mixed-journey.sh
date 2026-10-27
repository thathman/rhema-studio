#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QA_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/rhema-prepare-qa.XXXXXX")"
QA_RUN="$QA_SCRATCH/qa-run"
QA_HOME="$QA_SCRATCH/home"
APP_BIN="$ROOT/src-tauri/target/debug/Rhema"
APP_PID=""
CREATED_BIBLE_DB=0
BACKED_UP_BIBLE_SIDECARS=0
HAD_BIBLE_SHM=0
HAD_BIBLE_WAL=0

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
    for artifact in "$QA_RUN/out/prepare-mixed-journey.json" "$QA_SCRATCH/result.json" "$QA_SCRATCH/app.log"; do
      if [[ -f "$artifact" ]]; then cp "$artifact" "$QA_SCRATCH/artifacts/"; fi
    done
    printf 'QA scratch retained at %s\n' "$QA_SCRATCH"
  else
    rm -rf "$QA_SCRATCH"
  fi
}
trap cleanup EXIT

# Never run this journey against an installed Bible database or church profile.
# The app needs only a schema-valid empty Bible DB to boot; the journey uses synthetic hymn data.
if [[ -L "$ROOT/data" || -e "$ROOT/data/rhema.db" || -L "$ROOT/data/rhema.db" ]]; then
  echo "Refusing to use existing Bible data at $ROOT/data/rhema.db; run this in a clean QA checkout." >&2
  exit 2
fi

if [[ "${SKIP_QA_BUILD:-0}" != 1 ]]; then
  if command -v brew >/dev/null 2>&1 && brew list --versions onnxruntime >/dev/null 2>&1 && [[ -z "${ORT_LIB_LOCATION:-}" ]]; then
    ORT_LIB_LOCATION="$(brew --prefix onnxruntime)/lib"
    export ORT_LIB_LOCATION
  fi
  export ORT_PREFER_DYNAMIC_LINK=1
  cd "$ROOT"
  bun run tauri build --debug --no-bundle --features qa-bridge --config src-tauri/tauri.prepare-qa.conf.json
fi

if [[ ! -x "$APP_BIN" ]]; then
  echo "QA app binary not found: $APP_BIN" >&2
  exit 1
fi

# The repo normally ships this Bible database as a build resource, but source QA runs
# deliberately skip bundling. Build a temporary empty schema and restore tracked WAL sidecars.
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

export QA_DIR="$QA_RUN"
HOME="$QA_HOME" RHEMA_QA_DIR="$QA_RUN" "$APP_BIN" >"$QA_SCRATCH/app.log" 2>&1 &
APP_PID=$!
set +e
"$ROOT/scripts/mac-qa/qa.py" main prepare-mixed-journey "$ROOT/scripts/mac-qa/prepare-mixed-journey.js" 120 >"$QA_SCRATCH/result.json"
QA_STATUS=$?
set -e

if [[ "$QA_STATUS" != 0 ]]; then
  cat "$QA_SCRATCH/result.json" >&2
  cat "$QA_SCRATCH/app.log" >&2
  exit "$QA_STATUS"
fi

python3 - "$QA_RUN/out/prepare-mixed-journey.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
if not report.get("ok"):
    print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)
print(json.dumps(report.get("result"), ensure_ascii=False, indent=2))
PY
