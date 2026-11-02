import { describe, expect, it, vi } from "vitest"

const rendered = vi.fn()
vi.mock("@/lib/verse-renderer", () => ({
  renderVerse: (...args: unknown[]) => { rendered(...args); return null },
  drawLowerThird: vi.fn(),
  onThemeFontsLoaded: () => () => {},
}))

import { drawScene } from "@/lib/scene-renderer"
import type { SceneFrame } from "@/types"

/** #448: a feed layer's verse is laid out once per frame, not on every redraw (a camera beside it redraws at video rate). */
describe("feed layer render cache", () => {
  const noop = () => {}
  const ctx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : noop), set: () => true }) as unknown as CanvasRenderingContext2D
  const layerCtx = new Proxy({}, { get: () => noop, set: () => true }) as unknown as CanvasRenderingContext2D
  const canvas = { width: 0, height: 0, getContext: () => layerCtx } as unknown as HTMLCanvasElement
  const theme = { id: "t", resolution: { width: 1920, height: 1080 } } as never
  const frameWith = (verse: object): SceneFrame => ({ sceneId: "s", background: "#000", layers: [{ id: "f", kind: "feed", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, theme, verse: verse as never }] })

  it("renders a frame's verse once however often the scene redraws, and again when anything it draws changes", () => {
    const images = new Map<string, HTMLImageElement>()
    const opts = { image: () => null, layerCanvas: () => canvas, imageCache: images }
    const frame = frameWith({ reference: "John 3:16", segments: [] })
    for (let i = 0; i < 30; i++) drawScene(ctx, 1920, 1080, frame, opts)
    expect(rendered).toHaveBeenCalledTimes(1)
    drawScene(ctx, 1920, 1080, frameWith({ reference: "John 3:17", segments: [] }), opts)
    expect(rendered).toHaveBeenCalledTimes(2)
    const next = frameWith({ reference: "John 3:17", segments: [] })
    drawScene(ctx, 1920, 1080, next, opts)
    expect(rendered).toHaveBeenCalledTimes(3)
    // A theme picture finished loading: the same frame draws again, with it.
    images.set("bg.png", {} as HTMLImageElement)
    drawScene(ctx, 1920, 1080, next, opts)
    drawScene(ctx, 1920, 1080, next, opts)
    expect(rendered).toHaveBeenCalledTimes(4)
  })
})
