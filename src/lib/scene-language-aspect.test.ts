import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => undefined) }))

import { newLayer, newScene, sceneFrame, sceneHasLanguageFallback, staticText, staticTextFallsBack } from "@/lib/scenes"
import { drawScene, sceneArea } from "@/lib/scene-renderer"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { SceneLayer } from "@/types"

/** #448: a design's static text in each output's language, and its shape kept on other outputs. */

const words: Pick<SceneLayer, "text" | "textSecond"> = { text: "Welcome", textSecond: "Ẹ káàbọ̀" }

describe("static text by output language", () => {
  it("shows the language the output asks for, both stacked, and the first when the second is missing", () => {
    expect(staticText(words, "first")).toBe("Welcome")
    expect(staticText(words, "second")).toBe("Ẹ káàbọ̀")
    expect(staticText(words, "both")).toBe("Welcome\nẸ káàbọ̀")
    expect(staticText(words, undefined)).toBe("Welcome")
    expect(staticText({ text: "Welcome" }, "second")).toBe("Welcome")
    expect(staticText({ text: "Welcome", textSecond: "  " }, "both")).toBe("Welcome")
  })

  it("says when it falls back, and not when there is nothing to translate", () => {
    expect(staticTextFallsBack({ text: "Welcome" }, "second")).toBe(true)
    expect(staticTextFallsBack({ text: "Welcome" }, "both")).toBe(true)
    expect(staticTextFallsBack({ text: "Welcome" }, "first")).toBe(false)
    expect(staticTextFallsBack(words, "second")).toBe(false)
    expect(staticTextFallsBack({ text: " " }, "second")).toBe(false)
  })

  it("a taken scene's frame and fallback warning follow the output's language", () => {
    const live = { isLive: false, liveVerse: null, sources: {}, themes: useBroadcastStore.getState().themes }
    const text = { ...newLayer("text"), text: "Welcome", textSecond: "Ẹ káàbọ̀" }
    const scene = { ...newScene("Welcome"), layers: [text] }
    const output = { themeId: live.themes[0].id, language: "second" as const }
    expect(sceneFrame(live as never, output, scene).layers[0].text).toBe("Ẹ káàbọ̀")
    expect(sceneFrame(live as never, { ...output, language: "first" }, scene).layers[0].text).toBe("Welcome")
    // A layer may name its own language over the output's.
    expect(sceneFrame(live as never, output, { ...scene, layers: [{ ...text, language: "first" }] }).layers[0].text).toBe("Welcome")
    const untranslated = { ...scene, layers: [{ ...text, textSecond: undefined }] }
    expect(sceneHasLanguageFallback(live, output, untranslated, null, null, false)).toBe(true)
    expect(sceneHasLanguageFallback(live, output, scene, null, null, false)).toBe(false)
    expect(sceneHasLanguageFallback(live, { language: "first" }, untranslated, null, null, false)).toBe(false)
  })
})

describe("a design's shape on outputs of another shape", () => {
  it("only a scene from a design carries its artboard shape", () => {
    const live = { isLive: false, liveVerse: null, sources: {}, themes: useBroadcastStore.getState().themes }
    const output = { themeId: live.themes[0].id }
    const plain = newScene("Composer")
    expect(sceneFrame(live as never, output, plain).aspect).toBeUndefined()
    const designed = { ...plain, design: { id: "d1", version: 3 } }
    expect(sceneFrame(live as never, output, designed).aspect).toBeCloseTo(16 / 9)
  })

  it("letterboxes to the design's shape and fills a matching canvas", () => {
    expect(sceneArea(1920, 1080, 16 / 9)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(sceneArea(1920, 1080, undefined)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
    expect(sceneArea(1440, 1080, 16 / 9)).toEqual({ x: 0, y: 135, w: 1440, h: 810 })
    const portrait = sceneArea(1080, 1920, 16 / 9)
    expect(portrait).toEqual({ x: 0, y: (1920 - 607.5) / 2, w: 1080, h: 607.5 })
  })

  it("draws the layers inside the area and the background over the whole canvas", () => {
    const calls: { m: string; a: unknown[] }[] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : (...a: unknown[]) => { calls.push({ m: String(k), a }) }),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D
    const frame = { sceneId: "s", background: "#000000", aspect: 16 / 9, layers: [{ id: "c", kind: "color" as const, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, color: "#ff0000" }] }
    drawScene(ctx, 1440, 1080, frame, { image: () => null, layerCanvas: () => { throw new Error("not needed") } })
    const fills = calls.filter((c) => c.m === "fillRect").map((c) => c.a)
    expect(fills[0]).toEqual([0, 0, 1440, 1080])
    expect(fills).toContainEqual([0, 135, 1440, 810])
  })
})
