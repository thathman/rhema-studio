import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SceneFrame, VerseRenderData } from "@/types"

const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...args: unknown[]) => emitTo(...args) }))

import { presentActions } from "./present-actions"
import { newLayer, newScene, normalizeScene, SCENE_PRESETS, copyScene } from "@/lib/scenes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"

/**
 * Congregation scenes (ADR 0001, ARCH-002): a scene on the sanctuary output places live sources,
 * each following its own source in its own look; taking it changes no other output; Black still
 * covers it; a verse change never changes which scene is up.
 */
const romans: VerseRenderData = { reference: "Romans 8:28 (KJV)", segments: [{ text: "And we know" }], content: "bible" }
const hymn: VerseRenderData = { kind: "lyric", content: "hymn", reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace"] }
const sent = (label: string) => emitTo.mock.calls.filter((c) => c[0] === label).map((c) => c[2] as { verse: VerseRenderData | null; scene?: SceneFrame }).at(-1)

let themes: { id: string }[]
beforeEach(() => {
  emitTo.mockClear()
  themes = useBroadcastStore.getState().themes
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, heldLive: null, cleared: false, rehearsal: false, rehearsalReturn: null, sources: {}, scenes: [], sceneReturn: {},
    outputs: [
      { id: MAIN_OUTPUT_ID, name: "Sanctuary", type: "display", themeId: themes[0].id, monitorIndex: 0, ndi: defaultNdiSettings() },
      { id: "obs", name: "Rhema Bible | Lower Third", type: "ndi", themeId: themes[0].id, monitorIndex: 0, ndi: defaultNdiSettings("Rhema Bible | Lower Third"), shows: ["bible"] },
    ],
  })
})

function sideBySide() {
  const scene = newScene("Sermon split", SCENE_PRESETS.find((p) => p.id === "bible-lyrics"))
  scene.layers[1].themeId = themes[1].id
  useBroadcastStore.getState().saveScene(scene)
  return scene
}

describe("congregation scenes (ARCH-002)", () => {
  it("a taken scene shows each layer's own source in its own look, and follows them as they change", () => {
    const scene = sideBySide()
    const b = useBroadcastStore.getState()
    b.takeScene(MAIN_OUTPUT_ID, scene.id)
    b.setLiveVerse(romans, null, { goLive: true })
    b.setLiveVerse(hymn, null, { goLive: true })
    const frame = sent("broadcast-main")?.scene
    expect(frame?.sceneId).toBe(scene.id)
    const [, bible, lyrics] = frame!.layers
    expect(bible.verse?.reference).toBe("Romans 8:28 (KJV)")
    expect(bible.theme?.id).toBe(themes[1].id)
    expect(lyrics.verse?.reference).toBe("Amazing Grace · Verse 1")
    expect(bible.box).toEqual({ x: 2, y: 10, w: 47, h: 80 })
  })

  it("taking a scene changes no other output, and a verse change never changes which scene is up", () => {
    const scene = sideBySide()
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    expect(sent("broadcast-obs")).toBeUndefined()
    useBroadcastStore.getState().setLiveVerse(romans, null, { goLive: true })
    expect(sent("broadcast-obs")?.scene).toBeUndefined()
    expect(sent("broadcast-obs")?.verse?.reference).toBe("Romans 8:28 (KJV)")
    expect(useBroadcastStore.getState().outputs[0].sceneId).toBe(scene.id)
  })

  it("Hold keeps a layer on its copy while the source moves on; following again catches up", () => {
    const scene = sideBySide()
    const b = useBroadcastStore.getState()
    b.takeScene(MAIN_OUTPUT_ID, scene.id)
    b.setLiveVerse(romans, null, { goLive: true })
    const held = { ...scene, layers: scene.layers.map((l, i) => (i === 1 ? { ...l, held: romans } : l)) }
    b.saveScene(held)
    b.setLiveVerse({ ...romans, reference: "Romans 8:29 (KJV)" }, null, { goLive: true })
    expect(sent("broadcast-main")?.scene?.layers[1].verse?.reference).toBe("Romans 8:28 (KJV)")
    b.saveScene({ ...held, layers: held.layers.map((l, i) => (i === 1 ? { ...l, held: null } : l)) })
    expect(sent("broadcast-main")?.scene?.layers[1].verse?.reference).toBe("Romans 8:29 (KJV)")
  })

  it("Black covers a scene; Back returns to it", () => {
    const scene = sideBySide()
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    useBroadcastStore.getState().setLiveVerse(romans, null, { goLive: true })
    presentActions.quickScreen("black")
    expect(sent("broadcast-main")?.scene).toBeUndefined()
    expect(sent("broadcast-main")?.verse?.screen).toBe("black")
    presentActions.back()
    expect(sent("broadcast-main")?.scene?.sceneId).toBe(scene.id)
  })

  it("release goes back to the output's own feed; Restore takes the scene again; deleting it releases", () => {
    const scene = sideBySide()
    const b = useBroadcastStore.getState()
    b.takeScene(MAIN_OUTPUT_ID, scene.id)
    b.releaseScene(MAIN_OUTPUT_ID)
    expect(useBroadcastStore.getState().outputs[0].sceneId).toBeUndefined()
    expect(useBroadcastStore.getState().sceneReturn[MAIN_OUTPUT_ID]).toBe(scene.id)
    b.takeScene(MAIN_OUTPUT_ID, useBroadcastStore.getState().sceneReturn[MAIN_OUTPUT_ID])
    b.deleteScene(scene.id)
    expect(useBroadcastStore.getState().outputs[0].sceneId).toBeUndefined()
  })

  it("a damaged or newer scene file is made safe; copies get new ids", () => {
    expect(normalizeScene({ name: "no id" })).toBeNull()
    const s = normalizeScene({ id: "s", name: "x", layers: [{ id: "a", kind: "feed", shows: ["bible", "comet"], box: { x: 90, y: -5, w: 50, h: 300 }, opacity: 7 }, { id: "b", kind: "hologram" }] })!
    expect(s.layers).toHaveLength(1)
    expect(s.layers[0]).toMatchObject({ shows: ["bible"], box: { x: 90, y: 0, w: 10, h: 100 }, opacity: 1, visible: true })
    const c = copyScene(newScene("A"), "")
    expect(c.name).toBe("A copy")
    expect(newLayer("color").color).toBeTruthy()
  })
})
