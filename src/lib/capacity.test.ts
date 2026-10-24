import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))

const { capacityLimits, capacityUse, defaultLimits, hasLiveVideo, overLimits, physicalCores, startWarning, suits60fps, validLimit, withOutputOn, UNKNOWN_MACHINE } = await import("@/lib/capacity")
const { defaultNdiSettings } = await import("@/types")
type Scene = import("@/types").Scene

const mac = { cores: 8, physicalCores: 4, memoryTotalMb: 16384, os: "macos", arch: "x86_64" }
const out = (id: string, type: "display" | "ndi" | "browser", extra = {}) => ({ id, name: id, type, themeId: "t", monitorIndex: 0, ndi: defaultNdiSettings(id), ...extra })
const camScene = { id: "pulpit", name: "Pulpit", layers: [{ id: "c", name: "Cam", kind: "camera", cameraUrl: "http://127.0.0.1:8889/pulpit/whep", box: { x: 0, y: 0, w: 100, h: 100 } }] } as unknown as Scene
const words = { id: "words", name: "Words", layers: [{ id: "f", name: "Feed", kind: "feed", box: { x: 0, y: 0, w: 100, h: 100 } }] } as unknown as Scene

/** Capacity limits (#243 G13): soft limits from the computer's cores and memory. */
describe("capacity limits", () => {
  it("work the limits out from the computer", () => {
    // The owner's Intel Mac: 4 physical cores, 16 GB.
    expect(defaultLimits(mac)).toEqual({ outputs: 8, ndiSenders: 4, browserFeeds: 8, cameras: 4, videoScenes: 3 })
    // A small laptop: 2 cores, 8 GB.
    expect(defaultLimits({ ...mac, cores: 4, physicalCores: 2, memoryTotalMb: 8192 })).toEqual({ outputs: 4, ndiSenders: 2, browserFeeds: 4, cameras: 2, videoScenes: 1 })
    // Under 8 GB holds NDI and cameras at 2 whatever the cores.
    expect(defaultLimits({ ...mac, cores: 16, physicalCores: 8, memoryTotalMb: 4096 })).toMatchObject({ ndiSenders: 2, cameras: 2, outputs: 16 })
    // A big desktop is capped.
    expect(defaultLimits({ ...mac, cores: 64, physicalCores: 32, memoryTotalMb: 131072 })).toEqual({ outputs: 16, ndiSenders: 8, browserFeeds: 16, cameras: 8, videoScenes: 6 })
  })

  it("take half the logical cores when the physical ones are not known", () => {
    expect(physicalCores({ ...mac, physicalCores: null })).toBe(4)
    expect(physicalCores({ ...mac, cores: 1, physicalCores: null })).toBe(1)
    expect(defaultLimits(UNKNOWN_MACHINE).ndiSenders).toBe(2)
  })

  it("use the operator's own limits where set, and only sensible ones", () => {
    expect(capacityLimits(mac, { ndiSenders: 6, cameras: 0, outputs: 2.5, browserFeeds: 99 })).toEqual({ outputs: 8, ndiSenders: 6, browserFeeds: 8, cameras: 4, videoScenes: 3 })
    expect(capacityLimits(mac, undefined)).toEqual(defaultLimits(mac))
    expect([validLimit(1), validLimit(64), validLimit(0), validLimit(65), validLimit("3")]).toEqual([true, true, false, false, false])
  })

  it("allow 60 fps NDI without asking only on 6 cores and 16 GB", () => {
    expect(suits60fps(mac)).toBe(false)
    expect(suits60fps({ ...mac, physicalCores: 6 })).toBe(true)
    expect(suits60fps({ ...mac, physicalCores: 8, memoryTotalMb: 8192 })).toBe(false)
  })

  it("count what is on, by kind, and outputs on a scene with live video", () => {
    const outputs = [out("main", "display"), out("obs", "ndi", { sceneId: "pulpit" }), out("l3", "ndi"), out("tv", "browser", { sceneId: "words" }), out("off", "ndi")]
    const status = { main: { previewOpen: true, ndiActive: false }, obs: { previewOpen: false, ndiActive: true }, l3: { previewOpen: false, ndiActive: true }, tv: { previewOpen: false, ndiActive: false, feedActive: true } }
    expect(capacityUse(outputs, status, [camScene, words], 3)).toEqual({ outputs: 4, ndiSenders: 2, browserFeeds: 1, cameras: 3, videoScenes: 1 })
    expect(hasLiveVideo(camScene)).toBe(true)
    expect(hasLiveVideo(words)).toBe(false)
    expect(withOutputOn({ outputs: 0, ndiSenders: 0, browserFeeds: 0, cameras: 0, videoScenes: 0 }, out("x", "ndi", { sceneId: "pulpit" }), [camScene])).toEqual({ outputs: 1, ndiSenders: 1, browserFeeds: 0, cameras: 0, videoScenes: 1 })
  })

  it("say which limits are passed, in words", () => {
    const limits = defaultLimits(mac)
    expect(overLimits({ outputs: 8, ndiSenders: 5, browserFeeds: 0, cameras: 5, videoScenes: 0 }, limits).map((o) => o.text)).toEqual(["5 NDI senders (it suits about 4)", "5 cameras (it suits about 4)"])
  })

  it("warn before turning on an output only about the limits it adds to", () => {
    const limits = defaultLimits(mac)
    const four = { outputs: 4, ndiSenders: 4, browserFeeds: 0, cameras: 6, videoScenes: 0 }
    // A fifth NDI sender passes the NDI limit; the cameras already over are not its doing.
    const w = startWarning(out("Side NDI", "ndi"), four, [], limits, mac)
    expect(w?.over).toBe("This computer may drop frames: with Side NDI on it runs 5 NDI senders (it suits about 4). Turn another output off, or lower a frame rate.")
    expect(w?.fps60).toBeNull()
    // A browser feed does not add to NDI.
    expect(startWarning(out("Foyer", "browser"), four, [], limits, mac)).toBeNull()
    // A display showing a camera scene past the live-video limit.
    expect(startWarning(out("Overflow", "display", { sceneId: "pulpit" }), { ...four, videoScenes: 3 }, [camScene], limits, mac)?.over).toContain("4 outputs showing live video (it suits about 3)")
  })

  it("ask about 60 fps NDI on a computer below what it needs", () => {
    const limits = defaultLimits(mac)
    const none = { outputs: 0, ndiSenders: 0, browserFeeds: 0, cameras: 0, videoScenes: 0 }
    const obs = out("OBS", "ndi", { ndi: { ...defaultNdiSettings("OBS"), frameRate: "fps60" } })
    const w = startWarning(obs, none, [], limits, mac)
    expect(w?.over).toBeNull()
    expect(w?.fps60).toBe("OBS is set to 60 fps. This computer (4 cores, 16 GB) is below what 60 fps NDI needs (6 cores and 16 GB) and may drop frames; 30 fps is smooth for words and most video.")
    expect(startWarning(obs, none, [], limits, { ...mac, physicalCores: 8 })).toBeNull()
    expect(startWarning(out("OBS", "ndi"), none, [], limits, mac)).toBeNull()
  })
})
