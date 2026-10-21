import { describe, expect, it } from "vitest"
import { confidenceLevel } from "./confidence"

describe("confidence level for Auto", () => {
  it("reads percentages, keeps 0–1, and never lets a level stop Auto for good", () => {
    expect(confidenceLevel(0.9)).toBe(0.9)
    expect(confidenceLevel(80)).toBe(0.8)
    expect(confidenceLevel(150)).toBe(1)
    expect(confidenceLevel(-1)).toBe(0)
    expect(confidenceLevel(Number.NaN)).toBe(0.8)
    expect(confidenceLevel("x")).toBe(0.8)
  })
})
