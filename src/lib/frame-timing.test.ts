import { describe, expect, it } from "vitest"
import { frameTiming } from "./frame-timing"

describe("recorder frame timing headers (#626)", () => {
  it("sends the draw time and the skipped count as plain integers", () => {
    expect(frameTiming(1_793_000_000_123.7, 4)).toEqual({ "x-frame-drawn-at": "1793000000123", "x-frames-skipped": "4" })
  })

  it("a canvas never drawn sends no draw time; the count is never negative", () => {
    expect(frameTiming(0, 0)).toEqual({ "x-frames-skipped": "0" })
    expect(frameTiming(Number.NaN, -3)).toEqual({ "x-frames-skipped": "0" })
  })
})
