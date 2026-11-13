import { describe, expect, it } from "vitest"
import { countdownText, itemCounting, lookCounting, NO_COUNTDOWN_SOURCES } from "@/lib/countdown-display"
import { cleanItemTiming } from "@/lib/item-timing"

const live = (actualStart: number | null) => ({ events: [{ state: "live", label: "Sermon", plannedStart: 0, plannedEnd: 30 * 60_000, actualStart, hardStop: null }] })

describe("an item's own timer (#196)", () => {
  it("is kept when saved, never on a milestone, and only as up or none", () => {
    expect(cleanItemTiming({ timer: "up" })).toEqual({ timer: "up" })
    expect(cleanItemTiming({ timer: "none", warn_minutes: 2 })).toEqual({ warn_minutes: 2, timer: "none" })
    expect(cleanItemTiming({ timer: "sideways" })).toBeNull()
    expect(cleanItemTiming({ milestone: true, timer: "up" })).toEqual({ milestone: true })
  })

  it("counts down by default, up from the item's start, or not at all", () => {
    expect(itemCounting(live(1_000))).toMatchObject({ totalMs: 30 * 60_000, endsAt: 1_000 + 30 * 60_000 })
    const up = itemCounting(live(1_000), "up")!
    expect(up).toMatchObject({ label: "Sermon", totalMs: 0, endsAt: 1_000 })
    // 3 min 5 s after it started, the display reads 3:05, counting up.
    expect(countdownText(up.totalMs, up.endsAt! - (1_000 + 185_000))).toBe("3:05")
    const none = itemCounting(live(1_000), "none")!
    expect(none.idle).toContain("no timer")
  })

  it("a countdown look on the item on now shows what the item asks for", () => {
    const look = { counts: "item" } as Parameters<typeof lookCounting>[0]
    const timer = { durationMs: 0, startedAt: null, accumulatedMs: 0 }
    const sources = { ...NO_COUNTDOWN_SOURCES, item: itemCounting(live(1_000), "none") }
    expect(lookCounting(look, sources, timer, 0, 0).idle).toContain("no timer")
  })
})
