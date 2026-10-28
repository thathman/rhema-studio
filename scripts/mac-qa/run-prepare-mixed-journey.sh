#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QA_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/rhema-prepare-qa.XXXXXX")"
QA_RUN="$QA_SCRATCH/qa-run"
QA_HOME="$QA_SCRATCH/home"
QA_SOURCE="$QA_SCRATCH/prepare-mixed-journey-source.js"
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
    for artifact in \
      "$QA_RUN/out/prepare-six-event-journey.json" \
      "$QA_RUN/out/program-output-baseline.json" \
      "$QA_RUN/out/program-output-before-take.json" \
      "$QA_RUN/out/program-output-after-take.json" \
      "$QA_SCRATCH/result.json" \
      "$QA_SCRATCH/app.log"; do
      if [[ -f "$artifact" ]]; then cp "$artifact" "$QA_SCRATCH/artifacts/"; fi
    done
    printf 'QA scratch retained at %s\n' "$QA_SCRATCH"
  else
    rm -rf "$QA_SCRATCH"
  fi
}
trap cleanup EXIT

# Never run this journey against an installed Bible database or church profile.
# The runner creates synthetic Scripture rows, one synthetic audio fixture and no church profile data.
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
python3 - "$ROOT/data/rhema.db" "$ROOT/data/schema.sql" "$QA_RUN/in/rhema-qa-audio.wav" <<'PY'
import sqlite3
import sys
import wave
import struct
from pathlib import Path

database_path, schema_path, audio_path = sys.argv[1:]
with sqlite3.connect(database_path) as connection:
    connection.executescript(Path(schema_path).read_text(encoding="utf-8"))
    for abbreviation, title, language in (
        ("QAEN", "QA English (synthetic)", "en"),
        ("QAYO", "QA Yorùbá (synthetic)", "yo"),
    ):
        cursor = connection.execute(
            "INSERT INTO translations (abbreviation, title, language, license, is_copyrighted, is_downloaded) "
            "VALUES (?, ?, ?, 'Synthetic QA data', 0, 1)",
            (abbreviation, title, language),
        )
        translation_id = cursor.lastrowid
        connection.execute(
            "INSERT INTO books (translation_id, book_number, name, abbreviation, testament) "
            "VALUES (?, 43, 'John', 'John', 'NT')",
            (translation_id,),
        )
        book_id = connection.execute(
            "SELECT id FROM books WHERE translation_id = ? AND book_number = 43",
            (translation_id,),
        ).fetchone()[0]
        text = (
            "Synthetic English Scripture for the isolated six-event QA journey."
            if language == "en"
            else "Ìdánwò Ìwé Mímọ́ Yorùbá fún ìrìn-àjò QA tó ya sọ́tọ̀."
        )
        connection.execute(
            "INSERT INTO verses (translation_id, book_id, book_number, book_name, book_abbreviation, chapter, verse, text) "
            "VALUES (?, ?, 43, 'John', 'John', 3, 16, ?)",
            (translation_id, book_id, text),
        )

with wave.open(audio_path, "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(8000)
    audio.writeframes(struct.pack("<h", 0) * 800)
PY

python3 - "$ROOT/scripts/mac-qa/prepare-mixed-journey.js" "$QA_SOURCE" "$QA_RUN/in/rhema-qa-audio.wav" <<'PY'
import json
import sys
from pathlib import Path

source_path, output_path, audio_path = map(Path, sys.argv[1:])
source = source_path.read_text(encoding="utf-8")
token = '"__QA_AUDIO_FIXTURE_PATH__"'
if token not in source:
    raise SystemExit(f"The native journey is missing its {token} template token")
source = source.replace(token, json.dumps(str(audio_path)))
output_path.write_text(source, encoding="utf-8")
PY

export QA_DIR="$QA_RUN"
HOME="$QA_HOME" RHEMA_QA_DIR="$QA_RUN" "$APP_BIN" >"$QA_SCRATCH/app.log" 2>&1 &
APP_PID=$!
set +e
"$ROOT/scripts/mac-qa/qa.py" main open-program-window "$ROOT/scripts/mac-qa/open-program-window.js" 30 >"$QA_SCRATCH/open-program-window.json"
OPEN_STATUS=$?
if [[ "$OPEN_STATUS" == 0 ]]; then
  "$ROOT/scripts/mac-qa/qa.py" broadcast-main watch-program-output "$ROOT/scripts/mac-qa/watch-program-output.js" 30 >"$QA_SCRATCH/watch-program-output.json"
  WATCH_STATUS=$?
else
  WATCH_STATUS=1
fi
if [[ "$OPEN_STATUS" == 0 && "$WATCH_STATUS" == 0 ]]; then
  "$ROOT/scripts/mac-qa/qa.py" main prepare-six-event-journey "$QA_SOURCE" 180 >"$QA_SCRATCH/result.json"
  QA_STATUS=$?
else
  QA_STATUS=1
fi
set -e

if [[ "$QA_STATUS" != 0 ]]; then
  cat "$QA_SCRATCH/open-program-window.json" >&2 || true
  cat "$QA_SCRATCH/watch-program-output.json" >&2 || true
  cat "$QA_SCRATCH/result.json" >&2 || true
  cat "$QA_SCRATCH/app.log" >&2
  exit "$QA_STATUS"
fi

python3 - "$QA_RUN/out/prepare-six-event-journey.json" "$QA_RUN/out" <<'PY'
import json
import sys
from pathlib import Path

with open(sys.argv[1], encoding="utf-8") as report_file:
    report = json.load(report_file)
if not report.get("ok"):
    print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(1)
captures = {}
for name in ("baseline", "before-take", "after-take"):
    capture_path = Path(sys.argv[2]) / f"program-output-{name}.json"
    if not capture_path.is_file():
        raise SystemExit(f"Missing rendered Program capture: {capture_path.name}")
    capture = json.loads(capture_path.read_text(encoding="utf-8"))
    if capture.get("width", 0) <= 0 or capture.get("height", 0) <= 0 or not capture.get("hash"):
        raise SystemExit(f"Invalid rendered Program capture: {capture_path.name}")
    captures[name] = capture
if captures["baseline"]["hash"] != captures["before-take"]["hash"]:
    raise SystemExit("Rendered Program changed before explicit Take")
if captures["baseline"]["hash"] == captures["after-take"]["hash"]:
    raise SystemExit("Rendered Program did not change after explicit Take")
print(json.dumps({"journey": report.get("result"), "programOutputCaptures": captures}, ensure_ascii=False, indent=2))
PY
