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
