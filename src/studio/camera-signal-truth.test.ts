// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { syncCameras, playerKey } = await import("@/lib/whep")
const { newLayer, newScene, sceneFrame, cameraPlay, SCENE_PRESETS } = await import("@/lib/scenes")
const { withCameraPath, cameraSourceId } = await import("@/lib/live-sources")
const { cameraDownState, cameraSending } = await import("@/lib/cameras")
const { attention, cameraHealth, cameraStateWords } = await import("@/lib/show-health")
const { screenPlayback, playbackWords, playbackTrouble, measuredFps } = await import("@/lib/camera-playback")
const { cameraControlled } = await import("@/stores/broadcast-store")
const { cameraOfObsInput, programCameras } = await import("@/lib/obs-companion")
const { defaultNdiSettings } = await import("@/types")

const URL_P = "http://192.168.1.20:8889/pulpit/whep"
const cameras = [{ name: "pulpit", label: "Pulpit", token: "p".repeat(32), backup: "choir" }, { name: "choir", label: "Choir", token: "c".repeat(32) }, { name: "wide", label: "Wide", token: "w".repeat(32) }]
const PORTS = { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 }
const routerOf = (paths: Array<{ name: string; live: boolean; frozen?: boolean; dataAgeMs?: number; kbps?: number; width?: number; height?: number }>, running = true) => ({
  installed: true, running, wanted: running, lanAddress: "192.168.1.20", ports: PORTS, restarts: 0, error: null,
  paths: paths.map((p) => ({ source: p.live ? "rtspSession" : null, readers: 1, tracks: ["H264"], ...p })),
})
const out = (id: string, type: "display" | "ndi" | "browser", extra = {}) => ({ id, name: id, type, themeId: "t", monitorIndex: 0, ndi: defaultNdiSettings(id), ...extra })
const playback = (extra = {}) => ({ camera: "pulpit", playing: true, fps: 29.8, decoded: 900, dropped: 2, droppedPct: 0.2, frameAgeMs: 30, width: 1920, height: 1080, held: false, ...extra })

function sceneWithCamera() {
  const scene = newScene("Sermon", SCENE_PRESETS[0])
  scene.layers = [newLayer("camera", { name: "Camera", cameraUrl: URL_P, noSignal: "static" })]
  return scene
}
const live = (extra = {}) => ({ isLive: false, liveVerse: null, sources: {}, themes: [{ id: "t" } as never], ...extra })

describe("signal truth: connected is not working (#213)", () => {
  it("the router's answer: frozen (connected, nothing arriving) is down, unlike sending", () => {
    const health = { checked: true, status: routerOf([{ name: "pulpit", live: true, frozen: true }, { name: "choir", live: true }]) }
    expect(cameraDownState(health, "pulpit", cameras)).toBe("frozen")
    expect(cameraDownState(health, "choir", cameras)).toBeUndefined()
    expect(cameraDownState(health, "wide", cameras)).toBe("not-sending")
    expect(cameraDownState(health, "elsewhere", cameras)).toBeUndefined()
    expect(cameraDownState({ checked: false, status: null }, "pulpit", cameras)).toBeUndefined()
    expect(cameraDownState({ checked: true, status: routerOf([], false) }, "pulpit", cameras)).toBe("router-off")
    expect(cameraSending(health, "pulpit")).toBe("frozen")
    expect(cameraSending(health, "choir")).toBe("sending")
  })

  it("Show health names a frozen camera with how long nothing arrived, and its measures when it sends", () => {
    const scene = sceneWithCamera()
    const outputs = [out("main", "display", { sceneId: scene.id })]
    const status = { main: { previewOpen: true, ndiActive: false } }
    const frozen = cameraHealth(cameras, [scene], outputs, status, routerOf([{ name: "pulpit", live: true, frozen: true, dataAgeMs: 6200 }]))
    const p = frozen.find((c) => c.key === "pulpit")!
    expect(p.state).toBe("frozen")
    expect(cameraStateWords(p)).toBe("Frozen: connected, but nothing has arrived for 6 s")
    const a = attention(outputs, status, {}, { cameras: frozen, scenes: [scene] })
    expect(a[0]).toMatchObject({ level: "high", text: `Pulpit camera is frozen (connected, but nothing arriving); "Sermon" on main shows TV static there` })

    const sending = cameraHealth(cameras, [scene], outputs, {}, routerOf([{ name: "pulpit", live: true, kbps: 2100, width: 1920, height: 1080 }]), { screens: [{ ...playback(), outputId: "main", where: "main (this computer)" }] })
    expect(cameraStateWords(sending[0])).toBe("Sending (H264) · 1920×1080 · 2.1 Mbit/s · 29.8 fps on the screens · watched by 1 screen or program")
    const none = cameraHealth(cameras, [scene], outputs, {}, routerOf([{ name: "pulpit", live: true }]), { screens: [] })
    expect(cameraStateWords(none[0])).toContain("fps: no Rhema screen plays it now")
  })

  it("each screen's measured playback, named by the TV it was sent to, with trouble said plainly", () => {
    const outputs = [out("foyer", "browser", { tvs: [{ name: "Foyer TV", address: "192.168.1.40", sentAt: 0 }] }), out("main", "display")]
    const now = 100_000
    const s = screenPlayback(outputs, { main: { at: now - 1000, cameras: [playback()] }, foyer: { at: now - 60_000, cameras: [playback()] } }, { foyer: [{ from: "192.168.1.40", agoMs: 500, cameras: [playback({ fps: 12, droppedPct: 8 })] }, { from: "192.168.1.41", agoMs: 20_000, cameras: [playback()] }] }, now)
    expect(s.map((x) => x.where)).toEqual(["Foyer TV (foyer)", "main (this computer)"])
    expect(playbackWords(s[1])).toEqual({ text: "29.8 fps, 0.2% dropped, 1920×1080", tone: "ok" })
    expect(playbackWords(s[0]).tone).toBe("warn")
    expect(playbackTrouble(playback({ frameAgeMs: 5200 }))).toBe("no new frame for 5 s")
    expect(playbackTrouble(playback({ fps: 9 }))).toBe("only 9 frames a second")
    expect(playbackTrouble(playback({ held: true, frameAgeMs: 99_000 }))).toBeNull()
    expect(playbackWords(playback({ held: true })).text).toMatch(/Frozen by the operator/)
    expect(measuredFps("pulpit", s)).toBe(29.8)
    // A screen playing badly while the router says the camera sends is worth a line.
    const scene = sceneWithCamera()
    const on = [{ ...outputs[0], sceneId: scene.id }]
    const cams = cameraHealth(cameras, [scene], on, {}, routerOf([{ name: "pulpit", live: true }]))
    const a = attention(on, { foyer: { previewOpen: false, ndiActive: false, feedActive: true } }, { foyer: { watching: 1, current: true, behind: false } }, { cameras: cams, scenes: [scene], screens: s })
    expect(a.map((x) => x.text)).toContain("Foyer TV (foyer): Pulpit camera 8% of frames dropped")
  })
})

describe("operator controls per camera (#213)", () => {
  it("Retry, backup and Freeze are kept across one another", () => {
    const at = (x: object) => ({ revision: 1, activatedAt: 0, on: true, ...x })
    let st = cameraControlled(undefined, "retry")
    expect(st).toEqual({ retry: 1 })
    st = cameraControlled(at(st), "backup")
    st = cameraControlled(at(st), "freeze")
    expect(st).toEqual({ retry: 1, backup: true, hold: true })
    st = cameraControlled(at(st), "unbackup")
    expect(st).toEqual({ retry: 1, hold: true })
    expect(cameraControlled(at(st), "unfreeze")).toEqual({ retry: 1 })
  })

  it("the scene frame follows them: backup plays in its place, Freeze holds, Retry restarts, frozen shows the fallback", () => {
    const scene = sceneWithCamera()
    const backup = (n: string) => cameras.find((c) => c.name === n)?.backup
    const label = (u: string) => cameras.find((c) => withCameraPath(URL_P, c.name) === u)?.label
    const ctl = (x: object) => ({ [cameraSourceId("pulpit")]: { revision: 1, activatedAt: 0, on: true, ...x } })
    const f = (extra: object) => sceneFrame(live({ cameraBackup: backup, cameraLabel: label, ...extra }), { themeId: "t" }, scene, true).layers[0]
    expect(f({})).toMatchObject({ cameraUrl: URL_P, noSignal: "static" })
    expect(f({ stateSources: ctl({ backup: true }) })).toMatchObject({ cameraUrl: "http://192.168.1.20:8889/choir/whep", label: "Camera · on its backup (Choir)" })
    expect(f({ stateSources: ctl({ hold: true, retry: 2 }) })).toMatchObject({ cameraUrl: URL_P, hold: true, retry: 2 })
    expect(f({ cameraDown: (n: string) => (n === "pulpit" ? "frozen" : undefined) })).toMatchObject({ cameraUrl: URL_P, stale: true })
    expect(f({ stateSources: ctl({ on: false }) }).cameraUrl).toBeUndefined()
  })

  it("each output may choose its own fallback, another camera included (only while that one sends)", () => {
    const scene = sceneWithCamera()
    const bars = sceneFrame(live(), { themeId: "t", cameraFallback: { mode: "bars", name: true } }, scene).layers[0]
    expect(bars).toMatchObject({ noSignal: "bars", ident: "Camera" })
    const words = sceneFrame(live(), { themeId: "t", cameraFallback: { mode: "words", words: "  Back shortly " } }, scene).layers[0]
    expect(words).toMatchObject({ noSignal: "words", fallback: "Back shortly" })
    const other = { cameraFallback: { mode: "camera" as const, camera: "wide" } }
    expect(cameraPlay({ cameraDown: () => undefined }, other, { cameraUrl: URL_P }).url).toBe(URL_P)
    expect(cameraPlay({ cameraDown: (n) => (n === "pulpit" ? "not-sending" : undefined) }, other, { cameraUrl: URL_P }).url).toBe("http://192.168.1.20:8889/wide/whep")
    expect(cameraPlay({ cameraDown: () => "not-sending" }, other, { cameraUrl: URL_P }).url).toBe(URL_P)
    const hidden = { [cameraSourceId("pulpit")]: { revision: 1, activatedAt: 0, on: false } }
    expect(cameraPlay({ stateSources: hidden }, other, { cameraUrl: URL_P }).url).toBe("http://192.168.1.20:8889/wide/whep")
    // Other outputs keep the scene's own choice.
    expect(sceneFrame(live(), { themeId: "t" }, scene).layers[0].noSignal).toBe("static")
  })

  it("screens restart a reader on Retry, hold on Freeze, and take a stale camera as not ready", () => {
    type P = { url: string; key: string; held: boolean; stale: boolean; closed: boolean; hold: (on: boolean) => void; close: () => void }
    const made: P[] = []
    const make = (url: string, _s: unknown, _c: unknown, key: string) => {
      const p: P = { url, key, held: false, stale: false, closed: false, hold(on) { this.held = on }, close() { this.closed = true } }
      made.push(p)
      return p as never
    }
    const players = new Map()
    const changed = vi.fn()
    const layer = { id: "a", kind: "camera", cameraUrl: URL_P }
    syncCameras(players, [layer], vi.fn(), changed, make)
    syncCameras(players, [{ ...layer, hold: true, stale: true }], vi.fn(), changed, make)
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ held: true, stale: true })
    expect(changed).toHaveBeenCalled()
    syncCameras(players, [{ ...layer, retry: 1 }], vi.fn(), changed, make)
    expect(made).toHaveLength(2)
    expect(made[0].closed).toBe(true)
    expect(made[1].key).toBe(playerKey({ cameraUrl: URL_P, retry: 1 }))
    expect(withCameraPath("http://h:8889/a/whep", "b")).toBe("http://h:8889/b/whep")
    expect(withCameraPath("http://h:8889/other", "b")).toBe("http://h:8889/other")
  })
})

describe("Camera follows OBS (#208): information from OBS's own inputs", () => {
  it("knows the church's cameras in OBS's addresses, here (RTSP) or as a companion (SRT)", () => {
    expect(cameraOfObsInput("rtsp://192.168.1.20:8554/pulpit")).toBe("pulpit")
    expect(cameraOfObsInput("srt://h:8890?streamid=read:companion/choir:read-a1:x&passphrase=y")).toBe("choir")
    expect(cameraOfObsInput("rtsp://192.168.1.20:8554/a/b")).toBeNull()
    expect(cameraOfObsInput("/Users/x/video.mp4")).toBeNull()
  })

  it("lists the cameras visible on OBS's program", async () => {
    const request = vi.fn(async (type: string, data?: Record<string, unknown>) => {
      if (type === "GetInputList") return { inputs: [{ inputName: "Pulpit cam" }, { inputName: "Choir cam" }] }
      if (type === "GetInputSettings") return { inputSettings: { input: data?.inputName === "Pulpit cam" ? "rtsp://h:8554/pulpit" : "rtsp://h:8554/choir" } }
      if (type === "GetSceneItemList") return { sceneItems: [{ sourceName: "Pulpit cam", sceneItemEnabled: true }, { sourceName: "Choir cam", sceneItemEnabled: false }] }
      return {}
    }) as never
    expect(await programCameras(request, "Sermon")).toEqual(["pulpit"])
    expect(await programCameras(request, null)).toEqual([])
  })
})
