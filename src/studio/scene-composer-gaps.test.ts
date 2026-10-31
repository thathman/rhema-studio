import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SceneFrame, SceneLayerFrame, VerseRenderData } from "@/types"

const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...args: unknown[]) => emitTo(...args) }))

import { FADES, newLayer, newScene, normalizeScene, SCENE_PRESETS, sceneFrame } from "@/lib/scenes"
import { drawScene, LayerFader } from "@/lib/scene-renderer"
import { syncSceneVideos, videosPlaying } from "@/lib/scene-videos"
import { cameraOfUrl } from "@/lib/cameras"
import { basicOf, NEW_BASIC, withBasic } from "@/lib/basic-scene"
import { safeArea, safeAreaWords } from "@/lib/theme-look"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { mediaUsedHere } from "@/stores/media-store"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"

/**
 * Scene composer gaps (#243 G6, G8): a video background layer, a language per layer, a
 * transition per layer, a camera chosen by name, and the basic scene Present's sheet makes.
 */
const sent = () => emitTo.mock.calls.filter((c) => c[0] === "broadcast-main").map((c) => c[2] as { scene?: SceneFrame; sound?: boolean }).at(-1)
const FILE = `${"a".repeat(64)}.mp4`
const bilingual: VerseRenderData = { reference: "John 3:16", content: "bible", segments: [{ text: "For God so loved the world" }], translationLines: ["For God so loved the world", "Nítorí Ọlọ́run fẹ́ aráyé"] }

/** A drawing context that records every call and the alpha each drawImage was made at. */
function recorder() {
  const calls: { m: string; a: unknown[]; alpha: number; op: string }[] = []
  const state = { globalAlpha: 1, globalCompositeOperation: "source-over" }
  const ctx = new Proxy(state as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : k === "measureText" ? () => ({ width: 100 }) : (...a: unknown[]) => { calls.push({ m: String(k), a, alpha: state.globalAlpha, op: state.globalCompositeOperation }) }),
    set: (t, k, v) => { t[k as string] = v; return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls, draws: () => calls.filter((c) => c.m === "drawImage") }
}

/** A canvas whose context records into its own list. */
function fakeCanvas() {
  const r = recorder()
  return Object.assign({ width: 0, height: 0, getContext: () => r.ctx }, { rec: r }) as unknown as HTMLCanvasElement & { rec: ReturnType<typeof recorder> }
}

let themes: { id: string }[]
beforeEach(() => {
  emitTo.mockClear()
  themes = useBroadcastStore.getState().themes
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, heldLive: null, cleared: false, rehearsal: false, rehearsalReturn: null, sources: {}, scenes: [], sceneReturn: {}, ticker: null, lowerThird: null,
    outputs: [{ id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId: themes[0].id, monitorIndex: 0, ndi: defaultNdiSettings(), language: "both" }],
  })
})

describe("video background layer (#243 SC.9, SC.14)", () => {
  it("loads with its video, drops a file name that is not a media folder name, and old scenes load unchanged", () => {
    const raw = { id: "s", name: "Lyrics", background: "#000000", createdAt: 1, updatedAt: 2, layers: [
      { id: "v", name: "Video", kind: "video", mediaId: "m1", videoUrl: "asset://localhost/media/x.mp4", mediaFile: FILE, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true },
      { id: "w", name: "Bad", kind: "video", mediaFile: "../../secret.mp4", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true },
    ] }
    const s = normalizeScene(raw)!
    expect(s.layers[0]).toMatchObject({ kind: "video", mediaId: "m1", videoUrl: "asset://localhost/media/x.mp4", mediaFile: FILE })
    expect(s.layers[1].mediaFile).toBeUndefined()
    const old = { id: "o", name: "Old", background: "#000000", createdAt: 1, updatedAt: 2, layers: [{ id: "f", name: "Bible", kind: "feed", shows: ["bible"], box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true }] }
    expect(JSON.parse(JSON.stringify(normalizeScene(old)))).toEqual(old)
  })

  it("the Lyrics on video preset: a looping video under the words in the lower third", () => {
    const p = SCENE_PRESETS.find((x) => x.id === "lyrics-video")!
    const [video, words] = p.layers()
    expect(video).toMatchObject({ kind: "video", box: { x: 0, y: 0, w: 100, h: 100 } })
    expect(words).toMatchObject({ kind: "feed", shows: ["song", "hymn"], box: { y: 66, h: 34 } })
  })

  it("goes out with the scene to the output window (no sound) and names its file for a browser feed", () => {
    const scene = newScene("Video", SCENE_PRESETS[0])
    scene.layers = [newLayer("video", { mediaId: "m1", videoUrl: "asset://localhost/x.mp4", mediaFile: FILE })]
    useBroadcastStore.getState().saveScene(scene)
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    const out = sent()!
    expect(out.sound).toBe(false)
    expect(out.scene!.layers[0]).toMatchObject({ kind: "video", videoUrl: "asset://localhost/x.mp4", mediaFile: FILE })
    // Its file cannot be removed from the Library while a scene plays it.
    expect(mediaUsedHere("m1")).toContain("the scene Video")
  })

  it("draws its video covering its box, or leaves the box see-through when the page shows it under the canvas", () => {
    const r = recorder()
    const v = { videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement
    const frame: SceneFrame = { sceneId: "s", background: "transparent", layers: [{ id: "v", kind: "video", box: { x: 0, y: 0, w: 50, h: 50 }, opacity: 1, videoUrl: "x" }] }
    drawScene(r.ctx, 1920, 1080, frame, { image: () => null, layerCanvas: () => fakeCanvas(), video: () => v })
    expect(r.draws()).toHaveLength(1)
    expect(r.draws()[0].a[0]).toBe(v)
    const below = recorder()
    drawScene(below.ctx, 1920, 1080, frame, { image: () => null, layerCanvas: () => fakeCanvas(), video: () => v, cameraBelow: () => true })
    expect(below.draws()).toHaveLength(0)
    expect(below.calls.some((c) => c.m === "fillRect" && c.op === "destination-out")).toBe(true)
  })

  it("plays each video layer looped and muted, and lets go of it when the layer goes", () => {
    const players = new Map<string, HTMLVideoElement>()
    const made: Record<string, unknown>[] = []
    const create = () => {
      const v = { dataset: {} as Record<string, string>, readyState: 4, videoWidth: 640, paused: false, error: null, addEventListener: () => {}, play: () => Promise.resolve(), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(), remove: vi.fn() } as Record<string, unknown>
      made.push(v)
      return v as unknown as HTMLVideoElement
    }
    const onChange = vi.fn()
    syncSceneVideos(players, [{ id: "a", kind: "video", videoUrl: "one.mp4" }, { id: "b", kind: "feed" }], (l) => l.videoUrl, onChange, create)
    expect([...players.keys()]).toEqual(["a"])
    expect(made[0]).toMatchObject({ muted: true, loop: true, src: "one.mp4" })
    expect(videosPlaying(players)).toBe(true)
    syncSceneVideos(players, [{ id: "a", kind: "video", videoUrl: "two.mp4" }], (l) => l.videoUrl, onChange, create)
    expect(made[0].pause).toHaveBeenCalled()
    expect(players.get("a")!.src).toBe("two.mp4")
    syncSceneVideos(players, [], (l) => l.videoUrl, onChange, create)
    expect(players.size).toBe(0)
  })
})

describe("language per layer (#243 SC.12)", () => {
  it("a layer shows both languages, the first or the second, whatever the output is set to", () => {
    useBroadcastStore.setState({ isLive: true, liveVerse: bilingual, sources: { bible: { value: bilingual, on: true, revision: 1, activatedAt: 1 } } as never })
    const scene = newScene("Two boxes", SCENE_PRESETS[0])
    scene.layers = [newLayer("feed", { id: "both", shows: ["bible"] }), newLayer("feed", { id: "first", shows: ["bible"], language: "first" }), newLayer("feed", { id: "second", shows: ["bible"], language: "second" })]
    const s = useBroadcastStore.getState()
    const f = sceneFrame(s, { themeId: themes[0].id, language: "both" }, scene)
    const words = (id: string) => f.layers.find((l) => l.id === id)!.verse
    expect(words("both")?.translationLines).toHaveLength(2)
    expect(words("first")?.translationLines).toBeUndefined()
    expect(words("second")?.segments[0].text).toBe("Nítorí Ọlọ́run fẹ́ aráyé")
    // Without its own setting a layer follows the output's.
    expect(sceneFrame(s, { themeId: themes[0].id, language: "first" }, scene).layers[0].verse?.translationLines).toBeUndefined()
    expect(normalizeScene({ ...scene, layers: [{ ...scene.layers[1] }, { ...scene.layers[0], language: "klingon" }] })!.layers.map((l) => l.language)).toEqual(["first", undefined])
  })
})

describe("transition per layer (#243 SC.13)", () => {
  it("a layer with a fade carries its time and a key that changes only when its content does", () => {
    const one = { ...bilingual, translationLines: undefined }
    const two = { ...one, reference: "Romans 8:28", segments: [{ text: "And we know" }] }
    const scene = newScene("Fade", SCENE_PRESETS[0])
    scene.layers = [newLayer("feed", { fadeMs: 500 }), newLayer("ticker", { fadeMs: 500 }), newLayer("color")]
    const at = (v: VerseRenderData) => sceneFrame({ isLive: true, liveVerse: v, sources: {}, themes: BUILTIN_THEMES }, { themeId: BUILTIN_THEMES[0].id }, scene)
    const a = at(one).layers[0], b = at(two).layers[0]
    expect(a.fadeMs).toBe(500)
    expect(a.key).toBe(at({ ...one }).layers[0].key)
    expect(a.key).not.toBe(b.key)
    // The ticker moves by itself: no layer fade there; a cut layer carries nothing.
    expect(FADES("ticker")).toBe(false)
    expect(at(one).layers[1].fadeMs).toBeUndefined()
    expect(at(one).layers[2].key).toBeUndefined()
    expect(normalizeScene({ ...scene, layers: [{ ...scene.layers[0], fadeMs: 99_999 }] })!.layers[0].fadeMs).toBe(3000)
  })

  it("cross-fades from what the layer showed to the new content over its time; the first sight cuts", () => {
    let now = 0
    const fader = new LayerFader(() => fakeCanvas(), () => now)
    const layer = (key: string): SceneLayerFrame => ({ id: "c", kind: "color", color: key, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, fadeMs: 1000, key })
    const draw = (key: string) => {
      const r = recorder()
      drawScene(r.ctx, 1920, 1080, { sceneId: "s", background: "transparent", layers: [layer(key)] }, { image: () => null, layerCanvas: () => fakeCanvas(), fader })
      return r.draws().map((d) => d.alpha)
    }
    expect(draw("#000000")).toEqual([1])
    expect(fader.busy()).toBe(false)
    now = 100
    expect(draw("#ffffff")).toEqual([1, 0])
    now = 600
    expect(draw("#ffffff")).toEqual([0.5, 0.5])
    expect(fader.busy()).toBe(true)
    now = 1200
    expect(draw("#ffffff")).toEqual([1])
    expect(fader.busy()).toBe(false)
    // Another scene came up: coming back later starts without a fade from old content.
    const r = recorder()
    drawScene(r.ctx, 1920, 1080, { sceneId: "t", background: "transparent", layers: [] }, { image: () => null, layerCanvas: () => fakeCanvas(), fader })
    expect(draw("#123456")).toEqual([1])
  })
})

describe("a camera chosen by name (#243 SC.10)", () => {
  it("knows which of the church's cameras a stream address plays", () => {
    const cams = [{ name: "pulpit" }, { name: "choir" }]
    expect(cameraOfUrl("http://192.168.1.10:8889/pulpit/whep", cams)).toBe("pulpit")
    expect(cameraOfUrl("http://192.168.1.10:8889/wide/whep", cams)).toBeNull()
    expect(cameraOfUrl("not an address", cams)).toBeNull()
    expect(cameraOfUrl(undefined, cams)).toBeNull()
  })
})

describe("a basic scene from Present (#243 SC.18)", () => {
  it("a new one: the background video at the bottom, the camera over it, the words, then the lower third", () => {
    const s = withBasic(null, { ...NEW_BASIC, name: "Sermon", background: { kind: "video", mediaId: "m1", videoUrl: "u", mediaFile: FILE }, content: { shows: ["bible"], place: "lower" }, lowerThird: true, camera: "http://10.0.0.5:8889/pulpit/whep" })
    expect(s.name).toBe("Sermon")
    expect(s.layers.map((l) => l.kind)).toEqual(["video", "camera", "feed", "lowerThird"])
    expect(s.layers[2]).toMatchObject({ shows: ["bible"], box: { x: 0, y: 66, w: 100, h: 34 } })
    expect(basicOf(s)).toMatchObject({ name: "Sermon", background: { kind: "video", mediaId: "m1" }, content: { shows: ["bible"], place: "lower" }, lowerThird: true, camera: "http://10.0.0.5:8889/pulpit/whep" })
    expect(normalizeScene(JSON.parse(JSON.stringify(s)))!.layers).toHaveLength(4)
  })

  it("editing a fuller scene changes only its basic parts and keeps the rest where it is", () => {
    const welcome = newScene("Welcome", SCENE_PRESETS.find((p) => p.id === "welcome"))
    const b = basicOf(welcome)
    expect(b).toMatchObject({ content: null, camera: null, lowerThird: false })
    const edited = withBasic(welcome, { ...b, background: { kind: "colour", color: "#223344" }, lowerThird: true })
    expect(edited.id).toBe(welcome.id)
    expect(edited.background).toBe("#223344")
    expect(edited.layers.slice(0, 4)).toEqual(welcome.layers)
    expect(edited.layers.at(-1)!.kind).toBe("lowerThird")
    // A camera place with no camera yet stays a camera place; "no camera" removes it.
    const cam = newScene("Camera", SCENE_PRESETS.find((p) => p.id === "camera-bible"))
    expect(basicOf(cam).camera).toBe("")
    expect(withBasic(cam, basicOf(cam)).layers).toEqual(cam.layers)
    expect(withBasic(cam, { ...basicOf(cam), camera: null }).layers.map((l) => l.kind)).toEqual(["feed"])
    // A box arranged in the composer keeps its place.
    expect(basicOf(cam).content?.place).toBe("custom")
    expect(withBasic(cam, { ...basicOf(cam), content: { place: "custom", shows: ["song"] } }).layers[1]).toMatchObject({ shows: ["song"], box: cam.layers[1].box })
  })
})

describe("safe area on the output card (#299 4.9)", () => {
  it("reads the look's safe area at each edge", () => {
    const t = BUILTIN_THEMES[0]
    const a = safeArea(t)
    expect(a.left).toBe(Math.round((t.layout.padding.left / t.resolution.width) * 100))
    const even = { ...t, resolution: { width: 1000, height: 1000 }, layout: { ...t.layout, padding: { top: 50, right: 50, bottom: 50, left: 50 } } }
    expect(safeAreaWords(even)).toBe("5% at each edge")
    expect(safeAreaWords({ ...even, layout: { ...even.layout, padding: { top: 80, right: 50, bottom: 80, left: 50 } } })).toBe("5% left and right, 8% top and bottom")
  })
})

describe("static text in scene output", () => {
  it("normalizes and bounds literal text and its saved style", () => {
    const scene = normalizeScene({
      id: "static-text",
      layers: [{
        id: "words", name: "Welcome", kind: "text", box: { x: 10, y: 20, w: 80, h: 35 },
        text: "w".repeat(2500), fontFamily: "Arial;url", fontSize: 700, fontWeight: "1000",
        fontStyle: "oblique", textAlign: "justify", lineHeight: 8, textColor: "red", underline: "yes",
      }],
    })!

    expect(scene.layers[0]).toMatchObject({
      kind: "text", text: "w".repeat(2000), fontFamily: "Arialurl", fontSize: 400,
      fontWeight: "600", fontStyle: "normal", textAlign: "center", lineHeight: 3,
      textColor: "#ffffff", underline: false,
    })
  })

  it("carries an Avnac static-text layer into the shared output renderer", () => {
    const scene = newScene("Welcome", SCENE_PRESETS[0])
    scene.layers = [newLayer("text", {
      id: "welcome", text: "Welcome to worship", fontFamily: "Geist Variable", fontSize: 64,
      fontWeight: "700", textColor: "#fefefe", box: { x: 10, y: 20, w: 80, h: 35 },
    })]
    const state = useBroadcastStore.getState()
    const frame = sceneFrame(
      { isLive: false, liveVerse: null, sources: {}, themes: state.themes },
      state.outputs[0]!,
      scene,
    )
    expect(frame.layers[0]).toMatchObject({ kind: "text", text: "Welcome to worship", fontFamily: "Geist Variable", fontSize: 64 })

    const drawing = recorder()
    drawScene(drawing.ctx, 1920, 1080, frame, { image: () => null, layerCanvas: () => fakeCanvas() })
    expect(drawing.calls.some((call) => call.m === "fillText" && call.a[0] === "Welcome to worship")).toBe(true)
  })
})
