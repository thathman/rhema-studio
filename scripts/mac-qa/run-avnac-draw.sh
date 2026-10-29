#!/bin/bash
# Draw a 1920x1080, 101-layer Avnac scene (a picture and 100 text layers) in a running QA build's main
# window and time ten full redraws. Needs a build with the qa-bridge feature running (RHEMA_QA_DIR set).
# usage: scripts/mac-qa/run-avnac-draw.sh [qa.py path] [out.png]
set -e
cd "$(dirname "$0")/../.."
QA="${1:-$HOME/RhemaQA/scripts/qa.py}"; OUT="${2:-qa-screenshots/avnac/100-layers-native.png}"
TMP=$(mktemp -d)
node_modules/.bin/esbuild scripts/mac-qa/avnac-draw-entry.ts --bundle --format=iife --global-name=AvnacQA --outfile="$TMP/bundle.js" --log-level=warning
cat "$TMP/bundle.js" scripts/mac-qa/avnac-draw.qa.js > "$TMP/test.js"
python3 "$QA" main avnac-draw "$TMP/test.js" 60 > "$TMP/out.json"
python3 - "$TMP/out.json" "$OUT" <<'PY'
import base64, json, os, sys
r = json.load(open(sys.argv[1]))
if not r.get("ok"): sys.exit(f"failed: {r}")
res = r["result"]; png = res.pop("png")
os.makedirs(os.path.dirname(sys.argv[2]) or ".", exist_ok=True)
open(sys.argv[2], "wb").write(base64.b64decode(png.split(",", 1)[1]))
print(json.dumps(res))
PY
