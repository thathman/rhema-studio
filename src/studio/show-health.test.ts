import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { attention, cameraHealth, cameraPathOf, cameraStateWords, capacityAttention, cpuWords, feedSummary, heatWords, memoryWords, ndiRate, ndiRateWords, networkWords, rememberTv, showing, tvCheckWords } = await import("@/lib/show-health")
const { defaultNdiSettings } = await import("@/types")

const out = (id: string, type: "display" | "ndi" | "browser", extra = {}) => ({ id, name: id, type, themeId: "t", monitorIndex: 0, ndi: defaultNdiSettings(id), ...extra })

/** Show health (#213): real signals only, the serious ones first. */
describe("show health", () => {
  it("lists what needs attention, most serious first, and only for outputs on air", () => {
    const outputs = [out("obs", "ndi"), out("foyer", "browser"), out("tv", "browser"), out("spare", "ndi"), out("main", "display")]
    const a = attention(outputs, {
      obs: { previewOpen: false, ndiActive: true, ndiReceivers: 0 },
      foyer: { previewOpen: false, ndiActive: false, feedActive: true },
      tv: { previewOpen: false, ndiActive: false, feedActive: true },
      spare: { previewOpen: false, ndiActive: false, ndiError: "send failed" },
      main: { previewOpen: true, ndiActive: false },
    }, { foyer: { watching: 0, current: false, behind: false }, tv: { watching: 1, current: false, behind: true } })
    expect(a.map((x) => [x.level, x.outputId])).toEqual([["high", "tv"], ["medium", "obs"], ["medium", "foyer"]])
  })

  it("says what each output shows", () => {
    const theme = {} as never
    expect(showing(out("main", "display"), undefined, [], false)).toBe("Off")
    expect(showing(out("s", "display", { role: "stage" }), undefined, [], true)).toBe("Stage display")
    expect(showing(out("main", "display"), { theme, verse: { reference: "Romans 8:28", segments: [] }, overlay: null }, [], true)).toBe("Romans 8:28")
    expect(showing(out("main", "display"), { theme, verse: { reference: "", segments: [], screen: "black" }, overlay: null }, [], true)).toBe("Black")
    expect(showing(out("main", "display"), { theme, verse: null, overlay: null, scene: { sceneId: "s1", background: "#000", layers: [] } }, [{ id: "s1", name: "Sermon split" } as never], true)).toBe("Scene: Sermon split")
  })

  const PORTS = { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 }
  const router = (paths: Array<{ name: string; live: boolean; readers?: number; tracks?: string[] }>, running = true) => ({
    installed: true, running, wanted: running, lanAddress: "192.168.1.20", ports: PORTS, restarts: 0, error: null,
    paths: paths.map((p) => ({ source: p.live ? "webRTCSession" : null, readers: 0, tracks: [], ...p })),
  })
  const cameras = [{ name: "pulpit", label: "Pulpit", token: "p".repeat(32) }, { name: "choir", label: "Choir", token: "c".repeat(32) }]
  const cam = (id: string, url: string, extra = {}) => ({ id, name: `${id} layer`, kind: "camera" as const, cameraUrl: url, box: { x: 0, y: 0, w: 1, h: 1 }, ...extra })
  const scenes = [
    { id: "s1", name: "Sermon split", background: "#000", layers: [cam("a", "http://192.168.1.20:8889/pulpit/whep", { cameraFallback: "We'll be right back", noSignal: "words" }), cam("b", "http://192.168.1.20:8889/choir/whep")] },
    { id: "s2", name: "Wide", background: "#000", layers: [cam("c", "http://10.0.0.9:8080/stream")] },
  ] as never[]

  it("reads the router's camera name from a scene's camera address", () => {
    expect(cameraPathOf("http://192.168.1.20:8889/pulpit/whep")).toBe("pulpit")
    expect(cameraPathOf("http://192.168.1.20:8889/pulpit-2/whep/")).toBe("pulpit-2")
    expect(cameraPathOf("http://10.0.0.9:8080/stream")).toBeNull()
    expect(cameraPathOf("not a link")).toBeNull()
  })

  it("says how each camera is doing from the router, and where it is used", () => {
    const outputs = [out("main", "display", { sceneId: "s1" }), out("foyer", "browser", { sceneId: "s1" })]
    const status = { main: { previewOpen: true, ndiActive: false } }
    const rows = cameraHealth(cameras, scenes, outputs, status, router([{ name: "pulpit", live: true, readers: 2, tracks: ["H264"] }, { name: "choir", live: false }]))
    const by = (k: string) => rows.find((r) => r.key === k)!
    expect(by("pulpit")).toMatchObject({ label: "Pulpit", state: "sending", tracks: ["H264"], readers: 2, scenes: ["Sermon split"], assigned: ["main", "foyer"], onAir: ["main"] })
    expect(cameraStateWords(by("pulpit"))).toBe("Sending (H264) · watched by 2 screens or programs")
    expect(by("choir").state).toBe("not-sending")
    expect(cameraStateWords(by("choir"))).toBe("Not sending")
    // An address that is not Rhema's router: Rhema cannot tell, and says so.
    expect(by("http://10.0.0.9:8080/stream")).toMatchObject({ state: "elsewhere", label: "c layer" })
    // Router off, and before the first answer.
    expect(cameraHealth(cameras, [], [], {}, router([], false)).map((r) => r.state)).toEqual(["router-off", "router-off"])
    expect(cameraHealth(cameras, [], [], {}, null).map((r) => r.state)).toEqual(["router-off", "router-off"])
    expect(cameraHealth(cameras, [], [], {}, undefined).map((r) => r.state)).toEqual(["checking", "checking"])
  })

  it("a scene on air whose camera is not sending needs attention: what the screen shows instead", () => {
    const outputs = [out("main", "display", { name: "Main", sceneId: "s1" }), out("spare", "display", { sceneId: "s1" })]
    const status = { main: { previewOpen: true, ndiActive: false } }
    const rows = cameraHealth(cameras, scenes, outputs, status, router([{ name: "pulpit", live: false }, { name: "choir", live: true }]))
    const a = attention(outputs, status, {}, { cameras: rows, scenes })
    expect(a).toEqual([{ level: "high", outputId: "main", text: 'Pulpit camera is not sending; "Sermon split" on Main shows its fallback words there' }])
    // The choir camera stops too: it says nothing, so its box shows colour bars (the default).
    const off = cameraHealth(cameras, scenes, outputs, status, router([], false))
    expect(attention(outputs, status, {}, { cameras: off, scenes }).map((x) => x.text)).toEqual([
      'Pulpit camera is not sending (the camera router is not running); "Sermon split" on Main shows its fallback words there',
      'Choir camera is not sending (the camera router is not running); "Sermon split" on Main shows colour bars there',
    ])
  })

  it("says how many screens show each feed", () => {
    expect(feedSummary(null, false)).toEqual({ text: "Off", tone: "off" })
    expect(feedSummary(null, true).text).toBe("Checking…")
    expect(feedSummary({ watching: 0, current: false, behind: false }, true)).toEqual({ text: "No screen watching", tone: "warn" })
    expect(feedSummary({ watching: 2, current: true, behind: false }, true)).toEqual({ text: "2 screens showing the latest", tone: "ok" })
    expect(feedSummary({ watching: 1, current: false, behind: true }, true)).toEqual({ text: "Behind: 1 screen, not showing the latest", tone: "warn" })
  })

  it("remembers each TV a feed was sent to once, newest first, and reads what a TV says", () => {
    const a = rememberTv(undefined, { name: "Foyer TV", address: " 192.168.1.40 ", sentAt: 1 })
    const b = rememberTv(a, { name: "Hall TV", address: "192.168.1.41", sentAt: 2 })
    expect(rememberTv(b, { name: "Foyer TV", address: "192.168.1.40", sentAt: 3 }).map((t) => [t.address, t.sentAt])).toEqual([["192.168.1.40", 3], ["192.168.1.41", 2]])
    const outputs = [out("foyer", "browser", { name: "Foyer" }), out("hall", "browser", { name: "Hall" })]
    expect(tvCheckWords({ name: "TV", feed: "foyer", problem: null }, "foyer", outputs)).toEqual({ ok: true, text: "Showing this feed" })
    expect(tvCheckWords({ name: "TV", feed: "foyer", problem: "Looking for Rhema at 192.168.1.20:8080…" }, "foyer", outputs).ok).toBe(false)
    expect(tvCheckWords({ name: "TV", feed: "hall", problem: null }, "foyer", outputs).text).toBe("Showing another feed (Hall)")
    expect(tvCheckWords({ name: "TV", feed: null, problem: null }, "foyer", outputs).text).toContain("Not showing a feed")
  })
})

/** This computer in Show health (#243 G13, AC.5) and what NDI really sends (#246 C15). */
describe("computer health", () => {
  const h = { cpuPercent: 37.4, memoryUsedMb: 9 * 1024, memoryTotalMb: 16 * 1024, cpuSpeedLimit: 100, network: [] }

  it("puts load, memory and heat in words, warning when busy, full or hot", () => {
    expect(cpuWords(h)).toEqual({ text: "37%", tone: "ok" })
    expect(cpuWords({ ...h, cpuPercent: 96 })).toEqual({ text: "96%: very busy, screens may drop frames", tone: "warn" })
    expect(memoryWords(h)).toEqual({ text: "9.0 of 16 GB in use", tone: "ok" })
    expect(memoryWords({ ...h, memoryUsedMb: 15 * 1024 }).tone).toBe("warn")
    expect(memoryWords({ ...h, memoryUsedMb: 3584, memoryTotalMb: 8192 }).text).toBe("3.5 of 8.0 GB in use")
    expect(heatWords(h)).toEqual({ text: "Normal: running at full speed", tone: "ok" })
    expect(heatWords({ ...h, cpuSpeedLimit: 70 }).text).toBe("Hot: slowed to 70% of full speed to keep cool. Give it air, or turn an output off")
    expect(heatWords({ ...h, cpuSpeedLimit: null })).toEqual({ text: "Not reported by this computer", tone: "off" })
  })

  it("lists the network links, and says when there is none or only Wi-Fi", () => {
    expect(networkWords({ ...h, network: null })).toEqual([{ text: "Not reported on this system", tone: "off" }])
    expect(networkWords(h)[0].tone).toBe("warn")
    expect(networkWords({ ...h, network: [{ name: "Wi-Fi", kind: "wifi", speedMbps: 228, hasAddress: true }] })).toEqual([
      { text: "Wi-Fi: Wi-Fi · 228 Mbit/s", tone: "ok" },
      { text: "Wi-Fi only: a network cable is steadier for cameras, NDI and TVs", tone: "warn" },
    ])
    expect(networkWords({ ...h, network: [{ name: "USB LAN", kind: "wired", speedMbps: 1000, hasAddress: true }, { name: "Wi-Fi", kind: "wifi", speedMbps: null, hasAddress: true }] })).toEqual([
      { text: "USB LAN: cable · 1 Gbit/s", tone: "ok" },
      { text: "Wi-Fi: Wi-Fi", tone: "ok" },
    ])
  })

  it("measures NDI frames a second from two readings, apart from who watches", () => {
    expect(ndiRate(undefined, 100, 1000)).toBeNull()
    expect(ndiRate({ frames: 100, at: 1000 }, 190, 4000)).toBe(30)
    // A restarted sender counts from 0 again: no figure until the next reading.
    expect(ndiRate({ frames: 900, at: 1000 }, 10, 4000)).toBeNull()
    expect(ndiRateWords(29.6, 30, 1)).toEqual({ text: "30 of 30 frames a second sent · 1 receiver watching", tone: "ok" })
    expect(ndiRateWords(0.4, 30, 0).text).toBe("0 of 30 frames a second sent · no receiver watching")
    expect(ndiRateWords(null, 30, null)).toEqual({ text: "Measuring…", tone: "off" })
  })

  it("adds one attention line when more runs than the computer suits", () => {
    const limits = { outputs: 8, ndiSenders: 4, browserFeeds: 8, cameras: 4, videoScenes: 3 }
    expect(capacityAttention({ outputs: 3, ndiSenders: 2, browserFeeds: 1, cameras: 4, videoScenes: 0 }, limits)).toEqual([])
    expect(capacityAttention({ outputs: 6, ndiSenders: 6, browserFeeds: 0, cameras: 4, videoScenes: 0 }, limits)).toEqual([
      { level: "medium", outputId: "capacity", text: "This computer may drop frames: it runs 6 NDI senders (it suits about 4)" },
    ])
  })
})
