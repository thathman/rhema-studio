import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SceneFrame, SceneLayerFrame, Ticker } from "@/types"

const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...args: unknown[]) => emitTo(...args) }))

import { newLayer, newScene, normalizeScene, ownPreset, SCENE_PRESETS, sceneFrame, sceneOwns } from "@/lib/scenes"
import { drawScene, sceneMoving } from "@/lib/scene-renderer"
import { DEFAULT_TICKER_STYLE } from "@/lib/ticker"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"

/**
 * Scene layers for the ticker, the lower third and the church logo (#243), the presets the
 * composer starts from, and the church's own presets.
 */
const sent = (label: string) => emitTo.mock.calls.filter((c) => c[0] === label).map((c) => c[2] as { ticker?: Ticker | null; overlay?: unknown; scene?: SceneFrame }).at(-1)

/** A drawing context that records every call (and answers measureText). */
function recorder() {
  const calls: { m: string; a: unknown[] }[] = []
  const assignments: { m: string; v: unknown }[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (k === "measureText" ? () => ({ width: 100 }) : k === "canvas" ? { width: 1920, height: 1080 } : (...a: unknown[]) => { calls.push({ m: String(k), a }) }),
    set: (_t, k, v) => { assignments.push({ m: String(k), v }); return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls, assignments, of: (m: string) => calls.filter((c) => c.m === m).map((c) => c.a) }
}

const ticker: Ticker = { items: ["Youth meeting Friday"], style: DEFAULT_TICKER_STYLE, startedAt: 1_000 }
const frameOf = (...layers: Partial<SceneLayerFrame>[]): SceneFrame => ({ sceneId: "s", background: "transparent", layers: layers.map((l, i) => ({ id: `l${i}`, kind: "feed", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, ...l })) })
const noImages = { image: () => null, layerCanvas: () => { throw new Error("not this way") } }

let themes: { id: string }[]
beforeEach(() => {
  emitTo.mockClear()
  themes = useBroadcastStore.getState().themes
  useSettingsStore.setState({ brandKit: { ...useSettingsStore.getState().brandKit, logoUrl: null } })
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, heldLive: null, cleared: false, rehearsal: false, rehearsalReturn: null, sources: {}, scenes: [], sceneReturn: {}, scenePresets: [], ticker: null, lowerThird: null, tickerItems: [],
    outputs: [{ id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId: themes[0].id, monitorIndex: 0, ndi: defaultNdiSettings(), ticker: true, lowerThirds: true }],
  })
})

describe("ticker, lower-third and logo layers (#243)", () => {
  it("old saved scenes load unchanged; the new kinds load; an unknown kind is still dropped", () => {
    const old = {
      id: "s1", name: "Sunday", background: "#000000", fadeMs: 500, createdAt: 1, updatedAt: 2,
      layers: [
        { id: "a", name: "Background", kind: "color", color: "#101820", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true },
        { id: "b", name: "Bible", kind: "feed", shows: ["bible"], themeId: "t", box: { x: 2, y: 10, w: 47, h: 80 }, opacity: 0.8, visible: true },
        { id: "c", name: "Pulpit", kind: "camera", cameraUrl: "http://10.0.0.5:8889/pulpit/whep", box: { x: 0, y: 0, w: 50, h: 50 }, crop: { l: 5, t: 0, r: 5, b: 0 }, opacity: 1, visible: false },
        { id: "d", name: "Clock", kind: "clock", clockShows: "until", until: "10:00", box: { x: 30, y: 40, w: 40, h: 20 }, opacity: 1, visible: true },
      ],
    }
    const back = JSON.parse(JSON.stringify(normalizeScene(JSON.parse(JSON.stringify(old)))))
    expect(back).toEqual(old)
    const withNew = normalizeScene({ ...old, layers: [newLayer("ticker"), newLayer("lowerThird"), newLayer("logo"), newLayer("ellipse"), { id: "x", kind: "hologram" }] })!
    expect(withNew.layers.map((l) => [l.kind, l.box])).toEqual([
      ["ticker", { x: 0, y: 92, w: 100, h: 8 }],
      ["lowerThird", { x: 0, y: 0, w: 100, h: 100 }],
      ["logo", { x: 84, y: 4, w: 12, h: 12 }],
      ["ellipse", { x: 32, y: 30, w: 36, h: 40 }],
    ])
    expect(withNew.layers.at(-1)).toMatchObject({ kind: "ellipse", color: "#3157a4" })
  })

  it("carries an ellipse through the scene frame and paints its solid fill inside its box", () => {
    const ellipse = newLayer("ellipse", { color: "#d14c62", opacity: 0.65 })
    const scene = newScene("Ellipse", undefined)
    scene.layers = [ellipse]
    const live = { isLive: false, liveVerse: null, sources: {}, themes: useBroadcastStore.getState().themes }
    const frame = sceneFrame(live, { themeId: themes[0].id }, scene)
    expect(frame.layers[0]).toMatchObject({ kind: "ellipse", color: "#d14c62", box: ellipse.box, opacity: 0.65 })

    const r = recorder()
    drawScene(r.ctx, 1920, 1080, frame, noImages)
    expect(r.of("ellipse")).toEqual([[960, 540, 345.6, 216, 0, 0, Math.PI * 2]])
    expect(r.of("fill")).toHaveLength(1)
    expect(r.assignments).toContainEqual({ m: "globalAlpha", v: 0.65 })
  })

  it("the ticker draws as a band filling its box, moving at its whole-frame speed", () => {
    const r = recorder()
    drawScene(r.ctx, 1920, 1080, frameOf({ kind: "ticker", ticker, box: { x: 0, y: 90, w: 100, h: 10 } }), { ...noImages, now: 5_000 })
    expect(r.of("translate")).toContainEqual([0, 972])
    expect(r.of("rect")).toContainEqual([0, 972, 1920, 108])
    // The band, drawn from the top of its box.
    expect(r.of("fillRect")).toContainEqual([0, 0, 1920, 108])
    expect(r.of("fillText").some((a) => String(a[0]).includes("Youth meeting Friday"))).toBe(true)
    // No ticker running: nothing in its box.
    const empty = recorder()
    drawScene(empty.ctx, 1920, 1080, frameOf({ kind: "ticker", ticker: null }), noImages)
    expect(empty.of("fillText")).toEqual([])
  })

  it("the lower third is laid out in its box; a see-through layer goes through its own canvas", () => {
    const r = recorder()
    const overlay = { line1: "Pastor Ade", line2: "Senior pastor" }
    drawScene(r.ctx, 1920, 1080, frameOf({ kind: "lowerThird", overlay, box: { x: 50, y: 50, w: 50, h: 50 } }), noImages)
    expect(r.of("translate")).toContainEqual([960, 540])
    expect(r.of("fillText").map((a) => a[0])).toEqual(expect.arrayContaining(["Pastor Ade", "Senior pastor"]))
    const outer = recorder(), inner = recorder()
    const lc = { width: 0, height: 0, getContext: () => inner.ctx }
    drawScene(outer.ctx, 1920, 1080, frameOf({ kind: "lowerThird", overlay, opacity: 0.5, box: { x: 50, y: 50, w: 50, h: 50 } }), { image: () => null, layerCanvas: () => lc as never })
    expect(inner.of("fillText").map((a) => a[0])).toContain("Pastor Ade")
    expect(outer.of("drawImage")).toEqual([[lc, 960, 540, 960, 540]])
  })

  it("the logo is fitted whole and centred in its box", () => {
    const r = recorder()
    const img = { naturalWidth: 200, naturalHeight: 100 }
    drawScene(r.ctx, 1000, 1000, frameOf({ kind: "logo", imageUrl: "data:image/png;base64,AA", box: { x: 80, y: 0, w: 20, h: 20 } }), { image: () => img as never, layerCanvas: () => { throw new Error("no") } })
    expect(r.of("drawImage")).toEqual([[img, 0, 0, 200, 100, 800, 50, 200, 100]])
  })

  it("the frame carries the live ticker, the lower third and the Brand Kit logo; the preview says what is missing", () => {
    const scene = newScene("Welcome", SCENE_PRESETS.find((p) => p.id === "welcome"))
    const live = { isLive: false, liveVerse: null, sources: {}, themes: useBroadcastStore.getState().themes }
    const out = { themeId: themes[0].id }
    const on = sceneFrame({ ...live, ticker, logoUrl: "data:image/png;base64,AA" }, out, scene)
    expect(on.layers.find((l) => l.kind === "ticker")?.ticker).toBe(ticker)
    expect(on.layers.find((l) => l.kind === "logo")?.imageUrl).toBe("data:image/png;base64,AA")
    expect(sceneMoving(on, 2_000)).toBe(true)
    expect(sceneMoving({ ...on, layers: on.layers.map((l) => (l.ticker ? { ...l, ticker: { ...ticker, pausedAt: 2_000 } } : l)) }, 2_000)).toBe(false)
    const off = sceneFrame(live, out, scene, true)
    expect(off.layers.find((l) => l.kind === "logo")?.label).toMatch(/Brand Kit/)
    expect(off.layers.find((l) => l.kind === "ticker")?.label).toMatch(/when the ticker runs/)
  })
})

describe("a scene with a ticker or lower-third layer owns it (#243)", () => {
  function take(...kinds: ("ticker" | "lowerThird")[]) {
    const scene = newScene("Sermon", SCENE_PRESETS[0])
    scene.layers = [newLayer("feed"), ...kinds.map((k) => newLayer(k))]
    useBroadcastStore.getState().saveScene(scene)
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    return scene
  }

  it("the output gets no full-frame ticker or lower third; the scene's boxes have them", () => {
    take("ticker", "lowerThird")
    const b = useBroadcastStore.getState()
    b.setTickerItems(["Choir Saturday"])
    b.setTicker({ backing: null })
    b.setLowerThird({ line1: "Pastor Ade", line2: "" })
    const p = sent("broadcast-main")!
    expect(p.ticker).toBeNull()
    expect(p.overlay).toBeNull()
    expect(p.scene?.layers.find((l) => l.kind === "ticker")?.ticker?.items).toEqual(["Choir Saturday"])
    expect(p.scene?.layers.find((l) => l.kind === "lowerThird")?.overlay).toMatchObject({ line1: "Pastor Ade" })
  })

  it("a hidden ticker layer still owns the ticker; a scene without one leaves it to the output", () => {
    const scene = take("ticker")
    useBroadcastStore.getState().saveScene({ ...scene, layers: scene.layers.map((l) => ({ ...l, visible: l.kind !== "ticker" })) })
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    useBroadcastStore.getState().setTickerItems(["Choir Saturday"])
    useBroadcastStore.getState().setTicker({ backing: null })
    expect(sent("broadcast-main")!.ticker).toBeNull()
    expect(sent("broadcast-main")!.scene?.layers.some((l) => l.kind === "ticker")).toBe(false)
    take()
    expect(sent("broadcast-main")!.ticker?.items).toEqual(["Choir Saturday"])
    expect(sceneOwns(undefined)).toEqual({ ticker: false, lowerThird: false })
  })

  it("an output with its own ticker switched off still shows the scene's ticker layer", () => {
    useBroadcastStore.setState({ outputs: useBroadcastStore.getState().outputs.map((o) => ({ ...o, ticker: false, lowerThirds: false })) })
    take("ticker")
    useBroadcastStore.getState().setTickerItems(["Choir Saturday"])
    useBroadcastStore.getState().setTicker({ backing: null })
    expect(sent("broadcast-main")!.scene?.layers.find((l) => l.kind === "ticker")?.ticker?.items).toEqual(["Choir Saturday"])
    useBroadcastStore.getState().setTicker(null)
    expect(sent("broadcast-main")!.scene?.layers.find((l) => l.kind === "ticker")?.ticker).toBeNull()
  })

  it("a new Brand Kit logo waits for an explicit scene Take", () => {
    const scene = newScene("Logo", SCENE_PRESETS[0])
    scene.layers = [newLayer("logo")]
    useBroadcastStore.getState().saveScene(scene)
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    useSettingsStore.setState({ brandKit: { ...useSettingsStore.getState().brandKit, logoUrl: "data:image/png;base64,BB" } })
    expect(sent("broadcast-main")!.scene?.layers[0].imageUrl).toBeNull()
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    expect(sent("broadcast-main")!.scene?.layers[0].imageUrl).toBe("data:image/png;base64,BB")
  })
})

describe("scene presets (#243)", () => {
  it("the built-in presets keep stable ids, old ones first", () => {
    expect(SCENE_PRESETS.map((p) => p.id)).toEqual(["full", "bible-lyrics", "picture-lyrics", "camera-bible", "full-camera", "pip-camera", "sermon-split", "welcome", "lyrics-video", "closing-announcements", "countdown-camera"])
    const kinds = (id: string) => SCENE_PRESETS.find((p) => p.id === id)!.layers().map((l) => l.kind)
    expect(kinds("full-camera")).toEqual(["camera"])
    expect(kinds("pip-camera")).toEqual(["feed", "camera"])
    expect(kinds("sermon-split")).toEqual(["color", "camera", "feed"])
    expect(kinds("welcome")).toEqual(["color", "logo", "clock", "ticker"])
    expect(kinds("lyrics-video")).toEqual(["video", "feed"])
    // Each is a valid scene as saved.
    for (const p of SCENE_PRESETS) expect(normalizeScene(JSON.parse(JSON.stringify(newScene(p.name, p))))!.layers).toHaveLength(p.layers().length)
  })

  it("save as preset: an arrangement without held copies, replaced by name, renamed and deleted", () => {
    const scene = newScene("Sunday split", SCENE_PRESETS.find((p) => p.id === "sermon-split"))
    scene.background = "transparent"
    scene.fadeMs = 500
    scene.layers[2].held = { reference: "Romans 8:28", segments: [] }
    const b = useBroadcastStore.getState()
    b.saveScenePreset(scene, " Sunday ")
    b.saveScenePreset(scene, "  ")
    const [p] = useBroadcastStore.getState().scenePresets
    expect(useBroadcastStore.getState().scenePresets).toHaveLength(1)
    expect(p).toMatchObject({ name: "Sunday", background: "transparent", fadeMs: 500 })
    expect(p.id).not.toBe(scene.id)
    expect(p.layers.every((l, i) => l.id !== scene.layers[i].id && !l.held)).toBe(true)
    b.saveScenePreset({ ...scene, layers: scene.layers.slice(0, 1) }, "sunday")
    expect(useBroadcastStore.getState().scenePresets.map((x) => [x.id, x.name, x.layers.length])).toEqual([[p.id, "sunday", 1]])
    // A new scene from it: the arrangement, with ids of its own.
    const made = newScene("", ownPreset(useBroadcastStore.getState().scenePresets[0]))
    expect(made).toMatchObject({ name: "sunday", background: "transparent", fadeMs: 500 })
    expect(made.layers[0].id).not.toBe(useBroadcastStore.getState().scenePresets[0].layers[0].id)
    b.renameScenePreset(p.id, "Communion")
    expect(useBroadcastStore.getState().scenePresets[0].name).toBe("Communion")
    b.deleteScenePreset(p.id)
    expect(useBroadcastStore.getState().scenePresets).toEqual([])
  })

  it("presets are saved with the scenes and load again (a damaged one is dropped)", async () => {
    const saved = new Map<string, unknown>()
    vi.resetModules()
    vi.doMock("@tauri-apps/plugin-store", () => ({
      load: async () => ({ get: async (k: string) => saved.get(k), set: async (k: string, v: unknown) => { saved.set(k, v) }, save: async () => {} }),
    }))
    try {
      const first = await import("@/stores/broadcast-store")
      await first.hydrateBroadcastThemes()
      first.useBroadcastStore.getState().saveScenePreset(newScene("Welcome", SCENE_PRESETS.find((p) => p.id === "welcome")), "Welcome loop")
      await first.flushThemeSave()
      const stored = JSON.parse(JSON.stringify(saved.get("scenePresets"))) as unknown[]
      expect(stored).toHaveLength(1)
      saved.set("scenePresets", [...stored, { name: "no id" }])
      vi.resetModules()
      const second = await import("@/stores/broadcast-store")
      await second.hydrateBroadcastThemes()
      const presets = second.useBroadcastStore.getState().scenePresets
      expect(presets.map((p) => p.name)).toEqual(["Welcome loop"])
      expect(presets[0].layers.map((l) => l.kind)).toEqual(["color", "logo", "clock", "ticker"])
    } finally {
      vi.doUnmock("@tauri-apps/plugin-store")
    }
  })
})
