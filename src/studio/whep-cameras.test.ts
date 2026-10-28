// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { syncCameras } = await import("@/lib/whep")
const { newLayer, newScene, normalizeScene, sceneFrame, SCENE_PRESETS } = await import("@/lib/scenes")

/** A stand-in peer connection: records what it was asked to do. */
class FakePC {
  static made = 0
  closed = false
  iceGatheringState = "complete"
  localDescription: { sdp: string } | null = null
  constructor() { FakePC.made++ }
  addTransceiver() {}
  addEventListener() {}
  async createOffer() { return { type: "offer", sdp: "v=0 offer" } }
  async setLocalDescription(d: { sdp: string }) { this.localDescription = d }
  async setRemoteDescription() {}
  close() { this.closed = true }
}

describe("cameras on the church network (OP-009)", () => {
  it("keep their stream address in the scene and its frame; a bad one is dropped", () => {
    const scene = newScene("Camera", SCENE_PRESETS[0])
    scene.layers = [newLayer("camera", { cameraUrl: " http://192.168.1.10:8889/pulpit/whep " }), newLayer("camera", { cameraUrl: "javascript:alert(1)" })]
    const back = normalizeScene(JSON.parse(JSON.stringify(scene)))!
    expect(back.layers.map((l) => l.cameraUrl)).toEqual(["http://192.168.1.10:8889/pulpit/whep", undefined])
    const frame = sceneFrame({ isLive: false, liveVerse: null, sources: {}, themes: [] }, { themeId: "x" }, back)
    expect(frame.layers[0].cameraUrl).toBe("http://192.168.1.10:8889/pulpit/whep")
  })

  it("a camera that is not playing shows its fallback words when it is set to Words (#213), on outputs only", async () => {
    const { drawScene } = await import("@/lib/scene-renderer")
    const scene = newScene("Camera", SCENE_PRESETS[0])
    scene.layers = [newLayer("camera", { cameraUrl: "http://10.0.0.5:8889/a/whep", cameraFallback: "  Camera back shortly  ", noSignal: "words" })]
    const back = normalizeScene(JSON.parse(JSON.stringify(scene)))!
    expect(back.layers[0].cameraFallback).toBe("Camera back shortly")
    const theme = { id: "t", verseText: { color: "#fafafa", fontFamily: "Inter", fontWeight: 700 } } as never
    const frame = sceneFrame({ isLive: false, liveVerse: null, sources: {}, themes: [theme] }, { themeId: "t" }, back)
    expect(frame.layers[0]).toMatchObject({ fallback: "Camera back shortly", theme })
    const said: string[] = []
    const ctx = new Proxy({}, { get: (_t, k) => (k === "fillText" ? (t: string) => said.push(t) : k === "measureText" ? () => ({ width: 100 }) : () => {}), set: () => true }) as never
    const opts = { image: () => null, layerCanvas: () => document.createElement("canvas"), imageCache: new Map() } as never
    drawScene(ctx, 1920, 1080, frame, { ...(opts as object), camera: () => null } as never)
    expect(said).toEqual(["Camera back shortly"])
    said.length = 0
    drawScene(ctx, 1920, 1080, frame, { ...(opts as object), camera: () => ({ videoWidth: 640, videoHeight: 360 }) } as never)
    expect(said).toEqual([])
  })

  it("a camera the page shows under the canvas is cut out, not copied in (#198)", async () => {
    const { drawScene } = await import("@/lib/scene-renderer")
    const scene = newScene("Camera", SCENE_PRESETS[0])
    scene.layers = [newLayer("camera", { cameraUrl: "http://10.0.0.5:8889/a/whep" })]
    const frame = sceneFrame({ isLive: false, liveVerse: null, sources: {}, themes: [] }, {} as never, normalizeScene(JSON.parse(JSON.stringify(scene)))!)
    const calls: string[] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (...a: unknown[]) => calls.push(`${String(k)}${k === "fillRect" ? `:${t.globalCompositeOperation ?? "source-over"}:${a.join(",")}` : ""}`)),
      set: (t, k, v) => { t[k as string] = v; return true },
    }) as never
    const opts = { image: () => null, layerCanvas: () => document.createElement("canvas"), camera: () => ({ videoWidth: 640, videoHeight: 360 }) }
    drawScene(ctx, 1920, 1080, frame, { ...opts, cameraBelow: () => true } as never)
    expect(calls.filter((c) => c.startsWith("fillRect:destination-out"))).toEqual(["fillRect:destination-out:0,0,1920,1080"])
    expect(calls).not.toContain("drawImage")
    calls.length = 0
    drawScene(ctx, 1920, 1080, frame, opts as never)
    expect(calls).toContain("drawImage")
  })

  it("one player per camera layer: started, kept, restarted when its address changes, stopped when gone", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePC)
    const offers: string[] = []
    const signal = vi.fn(async (url: string) => { offers.push(url); return "v=0 answer" })
    const players = new Map()
    syncCameras(players, [{ id: "a", kind: "camera", cameraUrl: "http://10.0.0.5:8889/a/whep" }, { id: "b", kind: "feed" }], signal, () => {})
    await vi.waitFor(() => expect(offers).toEqual(["http://10.0.0.5:8889/a/whep"]))
    const first = players.get("a")
    syncCameras(players, [{ id: "a", kind: "camera", cameraUrl: "http://10.0.0.5:8889/a/whep" }], signal, () => {})
    expect(players.get("a")).toBe(first)
    syncCameras(players, [{ id: "a", kind: "camera", cameraUrl: "http://10.0.0.6:8889/a/whep" }], signal, () => {})
    expect(players.get("a")).not.toBe(first)
    await vi.waitFor(() => expect(offers).toHaveLength(2))
    syncCameras(players, [], signal, () => {})
    expect(players.size).toBe(0)
    expect(FakePC.made).toBe(2)
    vi.unstubAllGlobals()
  })
})
