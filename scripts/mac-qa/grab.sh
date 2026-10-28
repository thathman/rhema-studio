#!/usr/bin/env bash
# grab.sh <output-window-label> <name>: save what that output window draws (its canvas) as
# $QA_SCRATCH/qa-shots/<name>.png, and print the stage text when it is a stage output.
# Needs a QA build (cargo feature qa-bridge) started with RHEMA_QA_DIR=$QA_SCRATCH/qa-run.
set -euo pipefail
S="${QA_SCRATCH:?set QA_SCRATCH}"; export QA_DIR="$S/qa-run"; mkdir -p "$S/qa-shots"
here="$(cd "$(dirname "$0")" && pwd)"
echo 'const c = document.querySelector("canvas"); const shown = c && getComputedStyle(c).display !== "none"; return { w: c && c.width, h: c && c.height, png: shown ? c.toDataURL("image/png") : null, stage: document.body.innerText.trim().slice(0, 600) }' \
  | "$here/qa.py" "$1" "grab-$2" - 30 > "$S/qa-run/grab.json"
python3 - "$S" "$2" <<'PY'
import json, sys, base64
S, name = sys.argv[1], sys.argv[2]
d = json.load(open(f"{S}/qa-run/grab.json")); r = d.get("result") or {}
if r.get("png"):
    open(f"{S}/qa-shots/{name}.png", "wb").write(base64.b64decode(r["png"].split(",", 1)[1]))
print(name, {k: v for k, v in r.items() if k != "png"} if d.get("ok") else d)
PY
