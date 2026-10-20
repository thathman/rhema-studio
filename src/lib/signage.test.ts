import { describe, expect, it } from "vitest"
import { signageFrame, signageIndex } from "./signage"

describe("signage loop", () => {
  it("rotates round-robin by seconds from the start, and is -1 with nothing to show", () => {
    expect(signageIndex(0, 0, 5_000, 10)).toBe(-1)
    expect(signageIndex(3, 1_000, 1_000, 10)).toBe(0)
    expect(signageIndex(3, 1_000, 10_999, 10)).toBe(0)
    expect(signageIndex(3, 1_000, 11_000, 10)).toBe(1)
    expect(signageIndex(3, 1_000, 31_000, 10)).toBe(0)
    expect(signageIndex(3, 1_000, 0, 10)).toBe(0) // clock before start: first picture, never negative
    expect(signageIndex(2, 0, 1_500, 0)).toBe(1) // seconds floor at 1
  })

  it("makes a full-frame picture", () => {
    expect(signageFrame("data:x")).toMatchObject({ kind: "image", image: { url: "data:x", fit: "cover" } })
  })
})
