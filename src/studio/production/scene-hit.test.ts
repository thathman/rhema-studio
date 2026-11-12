import { describe, expect, it } from "vitest"

import { layerAt, unturnDelta, type HitLayer } from "./scene-hit"

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

  it("turns about the layer's pivot (a text layer's words), and keeps cameras upright", () => {
    // Pivot at the top of the box: turned 180° the box swings up above itself.
    const flipped = [bar({ rotation: 180, pivot: { x: 50, y: 45 } })]
    expect(at(flipped, 960, 470)).toBe("bar")
    expect(at(flipped, 960, 560)).toBeNull()
    expect(at([bar({ kind: "camera", rotation: 90 })], 800, 540), "a camera is never turned").toBe("bar")
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
})
