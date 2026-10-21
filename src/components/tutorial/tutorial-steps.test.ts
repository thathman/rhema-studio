import { describe, expect, it } from "vitest"
import { TUTORIAL_STEPS, type TourPlace } from "./tutorial-steps"

describe("first-run tour (Studio)", () => {
  it("walks Home, Prepare, Present and More in that order, every step with a place and a target", () => {
    const places = TUTORIAL_STEPS.map((s) => (s.data as TourPlace).workspace)
    expect(places[0]).toBe("home")
    expect([...new Set(places)]).toEqual(["home", "prepare", "present", "more"])
    for (const s of TUTORIAL_STEPS) {
      expect(typeof s.target).toBe("string")
      expect(String(s.title).length).toBeGreaterThan(0)
    }
    // Nothing points at the classic dashboard any more.
    expect(TUTORIAL_STEPS.some((s) => /transcript-panel|detections-panel|book-search|context-search/.test(String(s.target)))).toBe(false)
    // Present steps show the Standard view a volunteer works in.
    expect(TUTORIAL_STEPS.filter((s) => (s.data as TourPlace).workspace === "present").every((s) => (s.data as TourPlace).presentView === "standard")).toBe(true)
  })
})
