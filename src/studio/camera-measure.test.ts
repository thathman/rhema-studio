// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { rtcSample, rtcReading } = await import("@/lib/rtc-stats")
const { playbackWords, playbackTrouble, sixtyVerdict, SIXTY_HINT } = await import("@/lib/camera-playback")
const { readClock, lagMs, clockParts, withMeasure, latencyWords, isLatencyMeasure, withSixty, sixtyWords, sixtyKey, measuresOf } = await import("@/lib/glass-latency")
const { phoneWords, cameraAppLink } = await import("@/lib/cameras")
const { attention, cameraHealth } = await import("@/lib/show-health")
const { testCamera, cameraTestWords } = await import("@/lib/camera-test")
const { latencyClockFrame } = await import("@/lib/test-pattern")
const { newLayer, newScene, SCENE_PRESETS } = await import("@/lib/scenes")
const { defaultNdiSettings } = await import("@/types")

const playback = (extra = {}) => ({ camera: "pulpit", playing: true, fps: 29.8, decoded: 900, dropped: 2, droppedPct: 0.2, frameAgeMs: 30, width: 1920, height: 1080, held: false, ...extra })
const cameras = [{ name: "pulpit", label: "Pulpit", token: "p".repeat(32) }]
const outputs = [{ id: "main", name: "Main Display" }]

describe("WebRTC's own counters per camera (#213)", () => {
  const stats = (packets: number, lost: number, decoded: number, received: number) => [
    { type: "inbound-rtp", kind: "video", id: "v", jitter: 0.0042, packetsReceived: packets, packetsLost: lost, framesDecoded: decoded, framesReceived: received },
    { type: "inbound-rtp", kind: "audio", id: "a", jitter: 0.5 },
    { type: "transport", id: "t", selectedCandidatePairId: "p2" },
    { type: "candidate-pair", id: "p1", state: "succeeded", nominated: true, currentRoundTripTime: 0.9 },
    { type: "candidate-pair", id: "p2", state: "succeeded", currentRoundTripTime: 0.0031 },
  ]

  it("reads jitter, loss, round trip and the frame rates between two samples", () => {
    const a = rtcSample(stats(1000, 0, 300, 300), 0)!
    const b = rtcSample(new Map(stats(1990, 10, 420, 360).map((s) => [s.id, s])), 2000)!
    expect(a.rtt).toBe(0.0031)
    const first = rtcReading(null, a)
    expect(first).toEqual({ jitterMs: 4.2, lossPct: null, rttMs: 3.1, recvFps: null, decodeFps: null })
    expect(rtcReading(a, b)).toEqual({ jitterMs: 4.2, lossPct: 1, rttMs: 3.1, recvFps: 30, decodeFps: 60 })
    // No video in the report (audio only, or not connected yet): nothing to read.
    expect(rtcSample([{ type: "inbound-rtp", kind: "audio" }], 0)).toBeNull()
    // Counters that went back (a new connection) give no rate.
    expect(rtcReading(b, { ...a, at: 4000 }).decodeFps).toBeNull()
  })

  it("Show health says them with the frame rate, and too much loss or jitter is trouble", () => {
    expect(playbackWords(playback({ jitterMs: 4.2, lossPct: 0.1, rttMs: 3.1 })).text).toBe("29.8 fps, 0.2% dropped, 1920×1080, jitter 4 ms, 0.1% lost, round trip 3 ms")
    expect(playbackTrouble(playback({ lossPct: 3.5 }))).toBe("3.5% of its packets lost on the network")
    expect(playbackTrouble(playback({ jitterMs: 85 }))).toBe("jitter of 85 ms (an unsteady network)")
    expect(playbackWords(playback({ decodeFps: 24, fps: 29.8 })).text).toContain("24 decoded a second")
  })
})

describe("1080p60 only where a screen keeps up (#213)", () => {
  it("a camera at 60: kept up, or not (use 1080p30); a camera at 30 says nothing", () => {
    expect(sixtyVerdict(playback({ recvFps: 60, decodeFps: 59.8, fps: 59.6, droppedPct: 0.1 }))).toBe("keeps-up")
    expect(sixtyVerdict(playback({ recvFps: 60, decodeFps: 41, fps: 40, droppedPct: 0 }))).toBe("short")
    expect(sixtyVerdict(playback({ recvFps: 60, decodeFps: 60, fps: 58, droppedPct: 6 }))).toBe("short")
    expect(sixtyVerdict(playback({ recvFps: 30, decodeFps: 30, fps: 29.9 }))).toBeNull()
    expect(sixtyVerdict(playback({ recvFps: 60, held: true }))).toBeNull()
    expect(playbackTrouble(playback({ recvFps: 60, decodeFps: 44, fps: 44, droppedPct: 0.5 }))).toBe(SIXTY_HINT)
    expect(SIXTY_HINT).toContain("use 1080p30 for this screen")
  })

  it("each screen's flag is kept, saved again only when it changes (or a day on)", () => {
    const k = sixtyKey("main", "Google TV (Main)")
    const a = withSixty({}, k, "Google TV (Main)", false, 41.26, 1000)
    expect(a[k]).toEqual({ where: "Google TV (Main)", keepsUp: false, fps: 41.3, at: 1000 })
    expect(withSixty(a, k, "Google TV (Main)", false, 40, 5000)).toBe(a)
    expect(withSixty(a, k, "Google TV (Main)", true, 59.9, 5000)[k].keepsUp).toBe(true)
    expect(withSixty(a, k, "Google TV (Main)", false, 40, 1000 + 86_400_000)).not.toBe(a)
    expect(sixtyWords(a[k], 1000)).toMatchObject({ tone: "warn" })
    expect(sixtyWords(a[k], 1000).text).toMatch(/use 1080p30 for this screen$/)
  })
})

describe("camera lag, measured with the screen test's clock (#213 glass-to-glass)", () => {
  it("the output's clock and the operator's reading of the camera's picture", () => {
    const t = new Date(2026, 9, 25, 10, 31, 47, 215).getTime()
    expect(clockParts(t)).toEqual({ minutes: "10:31", seconds: "47.215" })
    expect(readClock("47.215")).toBe(47_215)
    expect(readClock(" 47,2 ")).toBe(47_200)
    expect(readClock("47215")).toBe(47_215)
    expect(readClock("75.000")).toBeNull()
    expect(readClock("abc")).toBeNull()
    // Frozen at :47.455 while the picture showed :47.215: 240 ms behind.
    expect(lagMs(t + 240, 47_215)).toBe(240)
    // Across the minute: frozen at :00.120, the picture still showed :59.900.
    expect(lagMs(new Date(2026, 9, 25, 10, 32, 0, 120).getTime(), 59_900)).toBe(220)
    // Digits mistyped (the picture "ahead" of this computer): no measurement.
    expect(lagMs(t, 48_000)).toBeNull()
  })

  it("saved per camera and output, newest kept, said as Show health says it", () => {
    const now = new Date(2026, 9, 25, 12).getTime()
    let list = withMeasure([], { camera: "pulpit", outputId: "main", ms: 260, at: now - 1000 })
    list = withMeasure(list, { camera: "pulpit", outputId: "main", ms: 240, at: now })
    list = withMeasure(list, { camera: "pulpit", outputId: "tv", ms: 410, at: now - 5000 })
    expect(list).toHaveLength(2)
    expect(latencyWords(list[1], cameras, outputs, now)).toBe("Pulpit → Main Display ≈ 240 ms (measured 25 Oct)")
    expect(latencyWords(list[0], cameras, outputs, now)).toBe("Pulpit → a screen since removed ≈ 410 ms (measured 25 Oct)")
    expect(measuresOf(list, "pulpit").map((m) => m.ms)).toEqual([240, 410])
    expect(isLatencyMeasure(list[0])).toBe(true)
    expect(isLatencyMeasure({ camera: "../x", outputId: "main", ms: 1, at: 1 })).toBe(false)
    expect(isLatencyMeasure({ camera: "pulpit", outputId: "main", ms: -5, at: 1 })).toBe(false)
  })

  it("the output's test frame asks for the clock over the test pattern", () => {
    expect(latencyClockFrame("data:x", { width: 1920, height: 1080, name: "Main" })).toMatchObject({ latencyClock: true, verse: null, overlay: null, ticker: null })
  })
})

describe("Test camera (#209)", () => {
  const fake = (readyAfter: number | null) => {
    let t = 0
    const p = {
      closed: false,
      get ready() { return readyAfter !== null && t >= readyAfter },
      meter: { read: () => ({}) },
      readStats: vi.fn(async () => ({})),
      report: () => playback({ fps: 30, jitterMs: 3, lossPct: 0, rttMs: 2, firstFrameMs: 640 }),
      close() { this.closed = true },
    }
    return { p, wait: async (ms: number) => { t += ms } }
  }

  it("measures the first frame, the rate and the network, then stops playing", async () => {
    const { p, wait } = fake(600)
    const r = await testCamera("http://x/pulpit/whep", vi.fn(), { make: () => p as never, wait })
    expect(r).toMatchObject({ ok: true, firstFrameMs: 640, fps: 30, jitterMs: 3, lossPct: 0, rttMs: 2 })
    expect(p.closed).toBe(true)
    expect(cameraTestWords(r, "to Main Display ≈ 240 ms (measured 25 Oct)").text).toBe("First picture after 0.6 s · 30 fps here · 1920×1080 · jitter 3 ms · 0% lost · round trip 2 ms · lag to Main Display ≈ 240 ms (measured 25 Oct)")
    expect(cameraTestWords(r, null).text).toContain("lag not measured yet")
  })

  it("no picture within 10 s is said plainly", async () => {
    const { p, wait } = fake(null)
    const r = await testCamera("http://x/pulpit/whep", vi.fn(), { make: () => p as never, wait })
    expect(r.ok).toBe(false)
    expect(p.closed).toBe(true)
    expect(cameraTestWords(r, null)).toMatchObject({ tone: "warn" })
  })
})

describe("the phone's battery and heat on the host (#213)", () => {
  const phone = (extra = {}) => ({ battery: 54, charging: true, temperature: 33.5, thermal: 0, cooling: false, agoMs: 1000, ...extra })

  it("in words, warning on a low battery not charging and on heat", () => {
    expect(phoneWords(phone())).toEqual({ text: "Battery 54%, charging · 33.5 °C · heat: normal", warnings: [] })
    expect(phoneWords(phone({ battery: 18, charging: false })).warnings).toEqual(["Battery low (18%) and not charging: plug the phone in"])
    expect(phoneWords(phone({ battery: 18, charging: true })).warnings).toEqual([])
    expect(phoneWords(phone({ thermal: 3 })).warnings[0]).toMatch(/^The phone is hot/)
    expect(phoneWords(phone({ thermal: 1, cooling: true })).warnings[0]).toMatch(/^The phone is hot/)
    expect(phoneWords(phone({ thermal: 4 })).warnings[0]).toMatch(/critically hot/)
    expect(phoneWords(phone({ battery: null, temperature: null, thermal: null, charging: false })).text).toBe("Reporting")
  })

  it("Show health lists the warnings, high while the camera is on air", () => {
    const scene = newScene("Sermon", SCENE_PRESETS[0])
    scene.layers = [newLayer("camera", { name: "Camera", cameraUrl: "http://192.168.1.20:8889/pulpit/whep" })]
    const outs = [{ id: "main", name: "main", type: "display" as const, themeId: "t", monitorIndex: 0, ndi: defaultNdiSettings("main"), sceneId: scene.id }]
    const router = { installed: true, running: true, wanted: true, lanAddress: "192.168.1.20", ports: { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 }, restarts: 0, error: null, paths: [{ name: "pulpit", live: true, source: "rtspSession", readers: 1, tracks: ["H264"], phone: phone({ battery: 12, charging: false }) }] }
    const status = { main: { previewOpen: true, ndiActive: false } }
    const cams = cameraHealth(cameras, [scene], outs, status, router)
    expect(cams[0].phone?.battery).toBe(12)
    const a = attention(outs, status, {}, { cameras: cams, scenes: [scene] })
    expect(a).toContainEqual({ level: "high", outputId: "cameras", text: "Pulpit camera: Battery low (12%) and not charging: plug the phone in" })
  })

  it("the Cam app's link carries the secure listener's port to report to", () => {
    const ports = { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtsps: 8322, rtmp: 1935, srt: 8890, api: 9997 }
    const fp = "a".repeat(64)
    expect(cameraAppLink("192.168.1.20", ports, cameras[0], fp, 8081)).toContain("&api=8081")
    expect(cameraAppLink("192.168.1.20", ports, cameras[0], fp, null)).not.toContain("api=")
    expect(cameraAppLink("192.168.1.20", ports, cameras[0], fp, 70000)).not.toContain("api=")
  })
})
