import { describe, expect, it } from "vitest"
import { cleanItemTiming, itemTimingPayload, parseItemTiming, warnMs } from "./item-timing"

describe("an item's timing rules as saved (#196 R1.2)", () => {
  it("keeps what is in range and drops the rest", () => {
    expect(cleanItemTiming({ soft_end_minutes: 25, warn_minutes: 5 })).toEqual({ soft_end_minutes: 25, warn_minutes: 5 })
    expect(cleanItemTiming({ soft_end_minutes: -1, warn_minutes: 999, milestone: "yes" })).toBeNull()
    // A milestone has no end, so no soft end or warning.
    expect(cleanItemTiming({ milestone: true, soft_end_minutes: 25, warn_minutes: 5 })).toEqual({ milestone: true })
    expect(cleanItemTiming(null)).toBeNull()
    expect(cleanItemTiming([1])).toBeNull()
  })

  it("round-trips through the payload, and nothing is written when there is nothing", () => {
    expect(itemTimingPayload(null)).toEqual({})
    const payload = JSON.stringify({ planned_minutes: 20, ...itemTimingPayload({ soft_end_minutes: 25 }) })
    expect(parseItemTiming(payload)).toEqual({ timing: { soft_end_minutes: 25 } })
    expect(parseItemTiming("not json")).toEqual({})
    expect(parseItemTiming(JSON.stringify({ timing: { warn_minutes: 0 } }))).toEqual({})
  })

  it("warns two minutes before the end unless the item says otherwise", () => {
    expect(warnMs(null)).toBe(120_000)
    expect(warnMs({ warn_minutes: 5 })).toBe(300_000)
  })
})
