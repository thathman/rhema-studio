#!/usr/bin/env python3
"""Run one acceptance script inside a window of the running QA app and print its report.
Usage: qa.py <window-label> <name> <js-body-file-or-'-'> [timeout]
The body runs inside `async (qa) => { ... }` where qa = window.__rhemaQa(); return a JSON-able value."""
import json, os, sys, time
d = os.environ["QA_DIR"]; label, name, src = sys.argv[1], sys.argv[2], sys.argv[3]
timeout = float(sys.argv[4]) if len(sys.argv) > 4 else 30
body = sys.stdin.read() if src == "-" else open(src).read()
out = os.path.join(d, "out", name + ".json")
if os.path.exists(out): os.remove(out)
js = f"""(async () => {{
  const report = (b) => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {{ event: "qa:report", payload: {{ name: {json.dumps(name)}, body: b }} }});
  try {{
    const qa = window.__rhemaQa ? window.__rhemaQa() : undefined;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const result = await (async (qa, sleep) => {{ {body} }})(qa, sleep);
    await report({{ ok: true, result }});
  }} catch (e) {{
    await report({{ ok: false, error: String(e && e.stack || e) }});
  }}
}})();"""
tmp = os.path.join(d, "in", f".{label}__{name}.tmp")
open(tmp, "w").write(js); os.rename(tmp, os.path.join(d, "in", f"{label}__{name}.js"))
end = time.time() + timeout
while time.time() < end:
    if os.path.exists(out):
        time.sleep(0.05); print(open(out).read()); sys.exit(0)
    time.sleep(0.1)
print(json.dumps({"ok": False, "error": "timeout: no report"})); sys.exit(1)
