import { describe, expect, it } from "vitest"
import { feedMotion, tickerStrips } from "@/lib/feed-motion"
import { drawScene, drawTickerLayer } from "@/lib/scene-renderer"
import { DEFAULT_TICKER_STYLE } from "@/lib/ticker"
import type { LowerThird, SceneFrame, SceneLayerFrame, Ticker } from "@/types"

/**
 * A browser feed redraws only what moves (perf-001): a scene's ticker layer crawls on a strip of
 * its own when nothing is above it, and the main picture stays still.
 */

/** A drawing context that records every call (and answers measureText). */
function recorder() {
  const calls: { m: string; a: unknown[] }[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (k === "measureText" ? () => ({ width: 100 }) : k === "canvas" ? { width: 1920, height: 1080 } : (...a: unknown[]) => { calls.push({ m: String(k), a }) }),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls, of: (m: string) => calls.filter((c) => c.m === m).map((c) => c.a) }
}

const ticker: Ticker = { items: ["Youth meeting Friday"], style: DEFAULT_TICKER_STYLE, startedAt: 1_000 }
const overlay: LowerThird = { line1: "Pastor Ade", line2: "", shownAt: 1_000 }
const layer = (l: Partial<SceneLayerFrame>, i = 0): SceneLayerFrame => ({ id: `l${i}`, kind: "feed", box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, ...l })
const frameOf = (...layers: Partial<SceneLayerFrame>[]): SceneFrame => ({ sceneId: "s", background: "transparent", layers: layers.map((l, i) => layer(l, i)) })
const band = { kind: "ticker" as const, ticker, box: { x: 0, y: 90, w: 100, h: 10 } }
const noImages = { image: () => null, layerCanvas: () => { throw new Error("not this way") } }
const still = { now: 50_000, hostNow: 50_000, fading: false, cameraInCanvas: false }

describe("drawScene's tickerAbove", () => {
  it("leaves a ticker layer on a strip out of the canvas; without the option it is drawn as before", () => {
    const f = frameOf({ kind: "color", color: "#101820" }, band)
    const skipped = recorder()
    drawScene(skipped.ctx, 1920, 1080, f, { ...noImages, now: 5_000, tickerAbove: (id) => id === "l1" })
    expect(skipped.of("fillText")).toEqual([])
    expect(skipped.of("fillRect")).toEqual([[0, 0, 1920, 1080]])
    const drawn = recorder()
    drawScene(drawn.ctx, 1920, 1080, f, { ...noImages, now: 5_000 })
    expect(drawn.of("fillText").map((a) => a[0])).toContain("Youth meeting Friday")
    // Another layer's id leaves it in.
    const other = recorder()
    drawScene(other.ctx, 1920, 1080, f, { ...noImages, now: 5_000, tickerAbove: (id) => id === "l0" })
    expect(other.of("fillText").map((a) => a[0])).toContain("Youth meeting Friday")
  })

  it("the strip is painted by the same code as the canvas would paint the box", () => {
    const inCanvas = recorder()
    drawScene(inCanvas.ctx, 1920, 1080, frameOf(band), { ...noImages, now: 5_000 })
    const onStrip = recorder()
    drawTickerLayer(onStrip.ctx, 1920, 108, layer(band), 1080, { now: 5_000 })
    expect(onStrip.of("fillText")).toEqual(inCanvas.of("fillText"))
  })
})

describe("tickerStrips: a strip only for a ticker layer that is top-most in its area", () => {
  it("a ticker on top gets a strip; one covered by a layer that paints stays in the canvas", () => {
    expect([...tickerStrips(frameOf({ kind: "color" }, band))]).toEqual(["l1"])
    expect([...tickerStrips(frameOf(band, { kind: "logo", imageUrl: "x", box: { x: 84, y: 88, w: 12, h: 12 } }))]).toEqual([])
    // Above it but elsewhere: no matter.
    expect([...tickerStrips(frameOf(band, { kind: "logo", imageUrl: "x", box: { x: 84, y: 4, w: 12, h: 12 } }))]).toEqual(["l0"])
    // Touching edges do not overlap.
    expect([...tickerStrips(frameOf(band, { kind: "color", box: { x: 0, y: 0, w: 100, h: 90 } }))]).toEqual(["l0"])
  })

  it("an empty lower-third box, an idle ticker layer or a see-through layer above does not count", () => {
    expect([...tickerStrips(frameOf(band, { kind: "lowerThird", overlay: null }))]).toEqual(["l0"])
    expect([...tickerStrips(frameOf(band, { kind: "ticker", ticker: null }))]).toEqual(["l0"])
    expect([...tickerStrips(frameOf(band, { kind: "color", opacity: 0 }))]).toEqual(["l0"])
    // A lower third up in its box over the ticker: back in the canvas.
    expect([...tickerStrips(frameOf(band, { kind: "lowerThird", overlay }))]).toEqual([])
  })

  it("two tickers on strips keep their order; a ticker under one that stays in the canvas stays too", () => {
    expect([...tickerStrips(frameOf(band, { ...band, ticker: { ...ticker, items: ["Choir"] } }))].sort()).toEqual(["l0", "l1"])
    const covered = frameOf(band, band, { kind: "color", box: { x: 0, y: 95, w: 10, h: 5 } })
    expect([...tickerStrips(covered)]).toEqual([])
  })

  it("no strips with no scene, or while the frame's own lower third is over the whole picture", () => {
    expect(tickerStrips(undefined).size).toBe(0)
    expect(tickerStrips(frameOf(band), true).size).toBe(0)
  })
})

describe("feedMotion: the main picture is redrawn only while it moves", () => {
  it("a scene ticker on its strip crawls without moving the picture; in the canvas it moves the picture", () => {
    const f = { scene: frameOf({ kind: "color" }, band) }
    expect(feedMotion(f, { ...still, strips: tickerStrips(f.scene) })).toEqual({ picture: false, crawl: true, noise: false })
    expect(feedMotion(f, { ...still, strips: new Set() })).toEqual({ picture: true, crawl: false, noise: false })
  })

  it("a paused or see-through ticker on its strip does not keep the page drawing", () => {
    const paused = { scene: frameOf({ ...band, ticker: { ...ticker, pausedAt: 2_000 } }) }
    expect(feedMotion(paused, { ...still, strips: tickerStrips(paused.scene) })).toEqual({ picture: false, crawl: false, noise: false })
    const clear = { scene: frameOf({ ...band, opacity: 0 }) }
    expect(feedMotion(clear, { ...still, strips: tickerStrips(clear.scene) })).toEqual({ picture: false, crawl: false, noise: false })
  })

  it("the full-frame ticker crawls; a fade, a camera in the canvas or a lower third coming in move the picture", () => {
    const none = new Set<string>()
    expect(feedMotion({ ticker }, { ...still, strips: none })).toEqual({ picture: false, crawl: true, noise: false })
    expect(feedMotion({ ticker: { ...ticker, pausedAt: 3_000 } }, { ...still, strips: none })).toEqual({ picture: false, crawl: false, noise: false })
    expect(feedMotion({}, { ...still, fading: true, strips: none }).picture).toBe(true)
    expect(feedMotion({}, { ...still, cameraInCanvas: true, strips: none }).picture).toBe(true)
    expect(feedMotion({ overlay }, { ...still, now: 1_200, strips: none }).picture).toBe(true)
    expect(feedMotion({ overlay }, { ...still, now: 5_000, strips: none }).picture).toBe(false)
    // In its scene box (by the host's clock).
    const lt = { scene: frameOf({ kind: "lowerThird", overlay }) }
    expect(feedMotion(lt, { ...still, hostNow: 1_200, strips: none }).picture).toBe(true)
    expect(feedMotion(lt, { ...still, hostNow: 5_000, strips: none }).picture).toBe(false)
  })

  it("nothing moves with no frame or the feed off", () => {
    expect(feedMotion(null, { ...still, fading: true, strips: new Set() })).toEqual({ picture: false, crawl: false, noise: false })
    expect(feedMotion({ off: true, ticker }, { ...still, strips: new Set() })).toEqual({ picture: false, crawl: false, noise: false })
  })
})
