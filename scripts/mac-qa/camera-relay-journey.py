#!/usr/bin/env python3
"""The camera relay inside the running QA app, with its real router, a real publisher and headless Chrome
as readers (simulated devices). Each reader loses its right in its own way while the others keep playing.
Usage: QA_DIR=<qa run> camera-relay-journey.py <port of the app's server>   Prints a JSON report; exit 1 on failure."""
import base64, hashlib, http.server, json, os, socket, struct, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request

PORT = int(sys.argv[1])
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = "0123456789abcdef0123456789abcdef"
FEED_KEY = "fedcba9876543210fedcba9876543210"
READERS = ["revoked", "demoted", "paused", "steady"]
SCENE = json.dumps({"scene": {"layers": [{"cameraUrl": "http://127.0.0.1:8889/pulpit/whep"}]}})
OTHER = json.dumps({"scene": {"layers": [{"cameraUrl": "http://127.0.0.1:8889/choir/whep"}]}})


def app(name, body, timeout=20):
    r = subprocess.run([os.path.join(HERE, "qa.py"), "main", name, "-", str(timeout)], input=body, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"{name}: {r.stdout} {r.stderr}")
    return r.stdout


def entry(token, role="present", paused=False):
    return {"hash": hashlib.sha256(token.encode()).hexdigest(), "name": token, "role": role, "paused": paused}


def set_keys(devices):
    app("keys", f'await window.__TAURI_INTERNALS__.invoke("remote_set_keys", {{ devices: {json.dumps(devices)} }}); return 1')


def valid_sps():
    """A real H.264 parameter set (baseline, 320x240): SRT and RTMP read it, unlike RTSP and WebRTC."""
    bits = ""

    def ue(v):
        code = bin(v + 1)[2:]
        return "0" * (len(code) - 1) + code

    for field in (ue(0), ue(0), ue(2), ue(1), "0", ue(19), ue(14), "1", "0", "0", "0", "1"):
        bits += field
    bits += "0" * (-len(bits) % 8)
    return bytes([0x67, 66, 0xC0, 30]) + int(bits, 2).to_bytes(len(bits) // 8, "big")


SPS, PPS = valid_sps(), bytes([0x68, 0xCE, 0x3C, 0x80])


def publish(F):
    s = socket.create_connection(("127.0.0.1", 8554))
    url = "rtsp://127.0.0.1:8554/pulpit"
    auth = "Authorization: Basic " + base64.b64encode(f"cam-pulpit:{TOKEN}".encode()).decode() + "\r\n"

    def ask(line, head, body=""):
        length = f"Content-Length: {len(body)}\r\n" if body else ""
        s.sendall(f"{line} RTSP/1.0\r\nCSeq: 1\r\n{auth}{head}{length}\r\n{body}".encode())
        got = b""
        while b"\r\n\r\n" not in got:
            got += s.recv(4096)
        text = got.decode(errors="ignore")
        if not text.startswith("RTSP/1.0 200"):
            raise SystemExit(text)
        return text

    sdp = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=x\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1;sprop-parameter-sets=" + base64.b64encode(SPS).decode() + "," + base64.b64encode(PPS).decode() + "\r\na=control:trackID=0\r\n"
    ask(f"ANNOUNCE {url}", "Content-Type: application/sdp\r\n", sdp)
    setup = ask(f"SETUP {url}/trackID=0", "Transport: RTP/AVP/TCP;unicast;interleaved=0-1;mode=record\r\n")
    session = [l for l in setup.split("\r\n") if l.startswith("Session")][0].split(":")[1].split(";")[0].strip()
    ask(f"RECORD {url}", f"Session: {session}\r\n")
    t0, seq = time.time(), 0
    while not F.is_set():
        seq += 1
        rtp = struct.pack(">BBHII", 0x80, 0xE0, seq & 0xFFFF, int((time.time() - t0) * 90000) & 0xFFFFFFFF, 1234) + b"\x65" + b"\x88" * 50
        s.sendall(b"$\x00" + struct.pack(">H", len(rtp)) + rtp)
        time.sleep(0.05)


PAGE = """<script>
const names = %s, pcs = {};
const post = (p, b) => fetch(p, { method: "POST", body: b });
async function open(k) {
  const pc = new RTCPeerConnection(); pc.addTransceiver("video", { direction: "recvonly" });
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState == "complete") r(); pc.onicegatheringstatechange = () => pc.iceGatheringState == "complete" && r(); setTimeout(r, 3000) });
  const a = await post("/offer/" + k, pc.localDescription.sdp);
  if (a.status != 201) throw new Error(k + " offer " + a.status);
  await pc.setRemoteDescription({ type: "answer", sdp: await a.text() }); pcs[k] = pc;
}
async function bytes(pc) { let b = 0; (await pc.getStats()).forEach((s) => { if (s.type == "inbound-rtp") b += s.bytesReceived || 0 }); return b }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(k, others) {
  const seen = {}, others0 = {}; const t = performance.now(); let last = t, was = await bytes(pcs[k]);
  for (const o of others) others0[o] = await bytes(pcs[o]);
  await post("/cut/" + k);
  const asked = performance.now() - t; const start = performance.now(); last = start;
  while (performance.now() - last < 2500 && performance.now() - start < 8000) { const b = await bytes(pcs[k]); if (b != was) { was = b; last = performance.now() } await sleep(50) }
  const stopped = performance.now() - last >= 2500;
  for (const o of others) seen[o] = (await bytes(pcs[o])) - others0[o];
  const again = (await post("/offer/" + k, "v=0")).status;
  return { reader: k, stopped, picture_stopped_ms: Math.round(last - start), others_bytes_during: seen, reconnect_status: again };
}
(async () => { try {
  for (const k of names) await open(k);
  for (let i = 0; i < 60 && !names.every((k) => pcs[k].connectionState == "connected"); i++) await sleep(200);
  const up = names.map((k) => pcs[k].connectionState);
  await sleep(1500);
  const steps = []; let left = [...names];
  for (const k of names.filter((n) => n != "steady")) { left = left.filter((n) => n != k); steps.push(await step(k, left)) }
  await post("/report", JSON.stringify({ up, steps }));
} catch (e) { await post("/report", JSON.stringify({ error: String(e) })) } })();
</script>""" % json.dumps(READERS + ["tv"])

done, report = threading.Event(), {}


class Page(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200); self.send_header("content-type", "text/html"); self.end_headers(); self.wfile.write(PAGE.encode())

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        code, out = 200, b""
        if self.path == "/report":
            report.update(json.loads(body)); done.set()
        elif self.path.startswith("/cut/"):
            cut(self.path[5:])
        elif self.path.startswith("/offer/"):
            who = self.path[7:]
            url = f"http://127.0.0.1:{PORT}/api/v1/feed/tv/camera/pulpit/whep?k={FEED_KEY}" if who == "tv" else f"http://127.0.0.1:{PORT}/api/v1/cameras/pulpit/whep"
            q = urllib.request.Request(url, data=body, method="POST", headers={"content-type": "application/sdp", "x-rhema-key": who})
            try:
                r = urllib.request.urlopen(q); code, out = r.status, r.read()
            except urllib.error.HTTPError as e:
                code, out = e.code, e.read()
        self.send_response(code); self.end_headers(); self.wfile.write(out)


state = {k: entry(k) for k in READERS}


def cut(who):
    if who == "tv":
        app("scene", f'await window.__TAURI_INTERNALS__.invoke("feed_publish", {{ id: "tv", json: {json.dumps(OTHER)} }}); return 1')
        return
    if who == "revoked":
        del state[who]
    elif who == "demoted":
        state[who] = entry(who, "viewer")
    elif who == "paused":
        state[who] = entry(who, paused=True)
    set_keys(list(state.values()))


def other_clients():
    """A second router as a real SRT, RTSPS and RTMPS client of the app's router (not a real OBS, phone or app)."""
    state["companion"] = entry("companion", "obs-companion")
    set_keys(list(state.values()))
    time.sleep(2.5)
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/v1/cameras/watch", headers={"x-rhema-key": "companion"})
    srt = json.load(urllib.request.urlopen(req))["srt"]
    status = json.loads(app("status", 'return await window.__TAURI_INTERNALS__.invoke("camera_router_status")'))
    status = status.get("result", status)
    fp = status["rtspsFingerprint"]
    read = f"srt://127.0.0.1:{srt['port']}?streamid=read:companion/pulpit:{srt['user']}:{srt['pass']}&passphrase="
    d = tempfile.mkdtemp()
    open(os.path.join(d, "m.yml"), "w").write(f"""logLevel: info
logDestinations: [stdout]
api: true
apiAddress: 127.0.0.1:29997
authInternalUsers:
  - user: any
    pass:
    ips: []
    permissions:
      - action: api
rtsp: false
rtmp: false
hls: false
webrtc: false
srt: false
moq: false
paths:
  srtgood:
    source: "{read}{srt['passphrase']}"
  srtbad:
    source: "{read}wrongwrongwrongwrong"
  rtsps:
    source: rtsps://127.0.0.1:8322/pulpit
    sourceFingerprint: {fp}
  rtmps:
    source: rtmps://127.0.0.1:1936/pulpit
    sourceFingerprint: {fp}
""")
    log = open(os.path.join(d, "log"), "w")
    router = os.environ.get("RHEMA_MEDIAMTX") or os.path.expanduser("~/.local/mediamtx/mediamtx")
    puller = subprocess.Popen([router, "m.yml"], cwd=d, stdout=log, stderr=log)

    def ready():
        items = json.load(urllib.request.urlopen("http://127.0.0.1:29997/v3/paths/list"))["items"]
        return {i["name"]: bool(i["ready"]) and i.get("inboundBytes", i.get("bytesReceived", 0)) > 0 for i in items}

    try:
        now = {}
        for _ in range(40):
            time.sleep(0.5)
            try:
                now = ready()
            except OSError:
                continue
            if now.get("srtgood") and now.get("rtsps") and now.get("rtmps"):
                break
        out = {"srt_companion": bool(now.get("srtgood")), "rtsps": bool(now.get("rtsps")), "rtmps": bool(now.get("rtmps")), "srt_wrong_passphrase_refused": not now.get("srtbad")}
        t = time.time()
        del state["companion"]
        set_keys(list(state.values()))
        cut = False
        while time.time() - t < 8 and not cut:
            time.sleep(0.2)
            cut = not ready().get("srtgood")
        out["srt_cut_when_unpaired"] = cut
        out["srt_cut_s"] = round(time.time() - t, 1)
        out["rtsps_rtmps_unaffected"] = (lambda r: bool(r.get("rtsps") and r.get("rtmps")))(ready())
        return out
    finally:
        puller.terminate()
        log.close()
        print("".join(l for l in open(os.path.join(d, "log")) if "[path" in l)[-2500:], file=sys.stderr)


app("start", f"""const i = window.__TAURI_INTERNALS__.invoke;
await i("feeds_set", {{ feeds: [{{ id: "tv", token: {json.dumps(FEED_KEY)} }}] }});
await i("feed_publish", {{ id: "tv", json: {json.dumps(SCENE)} }});
await i("start_http", {{ port: {PORT}, lan: false, https: true }});
await i("remote_set_keys", {{ devices: {json.dumps(list(state.values()))} }});
await i("cameras_set", {{ cameras: [{{ name: "pulpit", token: {json.dumps(TOKEN)} }}] }});
await i("camera_router_start");
return 1""", 30)
time.sleep(2)
stop = threading.Event()
threading.Thread(target=publish, args=(stop,), daemon=True).start()
time.sleep(1.5)
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
threading.Thread(target=server.serve_forever, daemon=True).start()
profile = tempfile.mkdtemp()
chrome = subprocess.Popen(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "--headless=new", "--no-first-run", "--user-data-dir=" + profile, "--disable-features=WebRtcHideLocalIpsWithMdns", f"http://127.0.0.1:{server.server_address[1]}/"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
finished = done.wait(120)
chrome.terminate()
report["protocols"] = other_clients()
stop.set()
print(json.dumps(report, indent=1))
ok = finished and "error" not in report and all(report["protocols"][k] for k in ("srt_companion", "rtsps", "rtmps", "srt_cut_when_unpaired", "srt_wrong_passphrase_refused")) and all(s["stopped"] and s["reconnect_status"] in (401, 403) and all(v > 0 for v in s["others_bytes_during"].values()) for s in report["steps"])
sys.exit(0 if ok else 1)
