import { afterEach, describe, expect, it, vi } from "vitest"
import { monotonicNow, refreshWallAnchor, wallAt } from "./timer-store"

describe("clock times shown with the timer (FR-07)", () => {
  afterEach(() => { vi.restoreAllMocks() })

  it("follow the real clock again after the laptop slept or the clock was set", () => {
    const now = monotonicNow()
    expect(Math.abs(wallAt(now) - Date.now())).toBeLessThan(1000)
    // The wall clock moves an hour ahead of the monotonic clock (a sleep, or the clock was set).
    const later = Date.now() + 3_600_000
    vi.spyOn(Date, "now").mockReturnValue(later)
    refreshWallAnchor()
    expect(Math.abs(wallAt(monotonicNow()) - later)).toBeLessThan(1000)
  })
})
