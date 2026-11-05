import { describe, expect, it } from "vitest"
import { deviceStage, nextStep } from "./device-stage"

describe("a device's Discover › Pair › Assign › Ready stage (#445)", () => {
  it("is Ready only while the device reports that it works", () => {
    expect(deviceStage({ paired: false, assigned: false, reporting: false })).toBe("discovered")
    expect(deviceStage({ paired: true, assigned: false, reporting: false })).toBe("paired")
    expect(deviceStage({ paired: true, assigned: true, reporting: false })).toBe("assigned")
    expect(deviceStage({ paired: true, assigned: true, reporting: true })).toBe("ready")
    // Reporting without a key or an assignment is not Ready: nothing is assumed.
    expect(deviceStage({ paired: false, assigned: true, reporting: true })).toBe("discovered")
    expect(deviceStage({ paired: true, assigned: false, reporting: true })).toBe("paired")
  })

  it("says what to do next, and nothing once Ready", () => {
    expect(nextStep("ready", "tv")).toBeNull()
    expect(nextStep("assigned", "tv")).toContain("TV is on")
    expect(nextStep("paired", "desk")).toContain("role")
    expect(nextStep("assigned", "camera")).toContain("Rhema Studio Cam")
  })
})
