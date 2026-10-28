import { describe, expect, it } from "vitest"
import { nearestPlacementTarget, placementAtPointer } from "./drop-placement"

describe("rundown drop placement", () => {
  const target = { top: 100, bottom: 180 }

  it("places before a row when the pointer is in its upper half", () => {
    expect(placementAtPointer(119, target)).toBe("before")
  })

  it("places after a row when the pointer is in its lower half", () => {
    expect(placementAtPointer(161, target)).toBe("after")
  })

  it("uses a consistent lower-half decision at the midpoint", () => {
    expect(placementAtPointer(140, target)).toBe("after")
  })

  it("chooses the nearest peer when sortable collision detection reports the dragged row", () => {
    expect(nearestPlacementTarget(235, [
      { id: "dragged", top: 210, bottom: 260 },
      { id: "peer", top: 270, bottom: 320 },
    ], "dragged")).toEqual({ targetId: "peer", placement: "before" })
  })

  it("returns no peer when the rundown contains only the dragged row", () => {
    expect(nearestPlacementTarget(235, [{ id: "dragged", top: 210, bottom: 260 }], "dragged")).toBeNull()
  })
})
