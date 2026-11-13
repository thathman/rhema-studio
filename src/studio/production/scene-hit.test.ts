import { describe, expect, it } from "vitest"

import { layerAt, resizeTurned, unturnDelta, type HitLayer } from "./scene-hit"
import type { SceneBox } from "@/types"

// A 1920×1080 frame; a wide bar 40% × 10% in the middle (768–1152 × 486–594 px).
const bar = (extra: Partial<HitLayer> = {}): HitLayer => ({ id: "bar", kind: "color", box: { x: 30, y: 45, w: 40, h: 10 }, ...extra })
const at = (layers: HitLayer[], xPx: number, yPx: number) => layerAt(layers, { x: (xPx / 1920) * 100, y: (yPx / 1080) * 100 }, 1920, 1080)

describe("Scene Composer hit-testing of turned layers (#851 G7)", () => {
  it("grabs an upright layer by its box and nothing outside it", () => {
    expect(at([bar()], 960, 540)).toBe("bar")
    expect(at([bar()], 780, 500)).toBe("bar")
    expect(at([bar()], 960, 700)).toBeNull()
  })

  it("grabs a turned layer where it is drawn, not by its upright box", () => {
    const turned = [bar({ rotation: 90 })]
    // Turned a quarter, the bar stands upright through the centre (912–1008 × 156–924 px).
    expect(at(turned, 960, 300)).toBe("bar")
    expect(at(turned, 800, 540), "where the upright box was: empty space now").toBeNull()
    const diagonal = [bar({ rotation: 45 })]
    expect(at(diagonal, 780, 500), "the upright box's corner is empty at 45°").toBeNull()
    expect(at(diagonal, 960 + 150, 540 + 150), "along the turned bar").toBe("bar")
  })

  it("turns about the layer's pivot (a text layer's words), and keeps tickers upright (cameras turn, #448)", () => {
    // Pivot at the top of the box: turned 180° the box swings up above itself.
    const flipped = [bar({ rotation: 180, pivot: { x: 50, y: 45 } })]
    expect(at(flipped, 960, 470)).toBe("bar")
    expect(at(flipped, 960, 560)).toBeNull()
    expect(at([bar({ kind: "ticker", rotation: 90 })], 800, 540), "a ticker is never turned").toBe("bar")
    expect(at([bar({ kind: "camera", rotation: 90 })], 800, 540), "a camera turns").not.toBe("bar")
    expect(at([bar({ kind: "camera", rotation: 90 })], 960, 400), "a camera turns").toBe("bar")
  })

  it("picks the topmost layer under the pointer", () => {
    const under = { id: "under", kind: "color", box: { x: 0, y: 0, w: 100, h: 100 } }
    expect(at([under, bar({ rotation: 45 })], 1110, 690)).toBe("bar")
    expect(at([under, bar({ rotation: 45 })], 780, 500)).toBe("under")
  })

  it("turns a resize drag into the layer's own axes", () => {
    const d = unturnDelta(0, 100, 90)
    expect(d.dx).toBeCloseTo(100)
    expect(d.dy).toBeCloseTo(0)
    expect(unturnDelta(30, 40, undefined)).toEqual({ dx: 30, dy: 40 })
  })
  it("keeps a turned layer's opposite corner still on screen while it is resized", () => {
    // Where a box's corner (fx, fy as fractions of the box) shows, turned about `pivot` (% of frame).
    const onScreen = (b: SceneBox, deg: number, fx: number, fy: number, pivot = { x: b.x + b.w / 2, y: b.y + b.h / 2 }) => {
      const rad = (deg * Math.PI) / 180
      const px = (pivot.x / 100) * 1920, py = (pivot.y / 100) * 1080
      const dx = ((b.x + b.w * fx) / 100) * 1920 - px, dy = ((b.y + b.h * fy) / 100) * 1080 - py
      return { x: px + dx * Math.cos(rad) - dy * Math.sin(rad), y: py + dx * Math.sin(rad) + dy * Math.cos(rad) }
    }
    const start = { x: 30, y: 45, w: 40, h: 10 }
    for (const deg of [90, 37, -120, 180]) {
      const before = onScreen(start, deg, 0, 0)
      for (const size of [{ w: 50, h: 10 }, { w: 30, h: 20 }, { w: 44.4, h: 6 }]) {
        const next = resizeTurned(start, size, deg, 1920, 1080)
        expect(next).toMatchObject(size)
        const after = onScreen(next, deg, 0, 0)
        expect(Math.hypot(after.x - before.x, after.y - before.y), `${deg}° ${size.w}×${size.h}`).toBeLessThan(1e-6)
      }
    }
    // The old way (top-left kept in the layer's own frame) drifts: the pivot moved with the size.
    const drifted = onScreen({ ...start, w: 50 }, 90, 0, 0)
    expect(Math.hypot(drifted.x - onScreen(start, 90, 0, 0).x, drifted.y - onScreen(start, 90, 0, 0).y)).toBeGreaterThan(50)
  })

  it("keeps the corner still for a layer turning about its own pivot (text), and stays in the frame", () => {
    // A text layer turns about the middle of its first 10% of height, whatever the box's height.
    const pivotOf = (b: SceneBox) => ({ x: b.x + b.w / 2, y: b.y + 5 })
    const start = { x: 20, y: 30, w: 30, h: 40 }
    const corner = (b: SceneBox) => {
      const p = pivotOf(b), rad = (25 * Math.PI) / 180
      const dx = ((b.x - p.x) / 100) * 1920, dy = ((b.y - p.y) / 100) * 1080
      return { x: (p.x / 100) * 1920 + dx * Math.cos(rad) - dy * Math.sin(rad), y: (p.y / 100) * 1080 + dx * Math.sin(rad) + dy * Math.cos(rad) }
    }
    const before = corner(start)
    const next = resizeTurned(start, { w: 45, h: 50 }, 25, 1920, 1080, pivotOf)
    expect(next).toMatchObject({ w: 45, h: 50 })
    const after = corner(next)
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1e-6)
    // Grown past the frame's edge, it stops where it still fits, corner still in place.
    const edge = resizeTurned(start, { w: 100, h: 100 }, 25, 1920, 1080, pivotOf)
    // (within the 0.05% the composer's rounding is allowed)
    expect(edge.x).toBeGreaterThanOrEqual(-0.05)
    expect(edge.y).toBeGreaterThanOrEqual(-0.05)
    expect(edge.x + edge.w).toBeLessThanOrEqual(100.05)
    expect(edge.y + edge.h).toBeLessThanOrEqual(100.05)
    expect(edge.w).toBeGreaterThan(start.w)
    const kept = corner(edge)
    expect(Math.hypot(kept.x - before.x, kept.y - before.y)).toBeLessThan(1e-6)
    // Upright, the top-left stays and the size is held inside the frame, as before.
    expect(resizeTurned(start, { w: 90, h: 20 }, undefined, 1920, 1080)).toEqual({ x: 20, y: 30, w: 80, h: 20 })
  })
  it("still resizes a turned box the composer's rounding left a hair outside the frame", () => {
    // Rounded to 0.1%, a turned layer's box can end 0.03% past the bottom edge.
    const start = { x: 40, y: 60, w: 30, h: 40.03 }
    const next = resizeTurned(start, { w: 35, h: 40.03 }, 180, 1920, 1080)
    expect(next.w).toBe(35)
    expect(next.x).toBeCloseTo(35, 6)
  })
})
