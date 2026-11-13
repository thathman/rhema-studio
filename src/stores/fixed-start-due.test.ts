import { describe, expect, it } from "vitest"
import { nextDueFixedStart } from "@/stores/fixed-start-auto-store"
import type { TimingInput, TimingItem } from "@/lib/timing-engine"
import type { OutlineHeader } from "@/lib/run-of-show"

// The real timing engine (no mocks): Worship 10:05–10:25 is on, the Sermon is fixed at 10:30.
const at = (h: number, m: number, s = 0, ms = 0) => new Date(2026, 9, 25, h, m, s, ms).getTime()
const headers: OutlineHeader[] = [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }]
const plan = (worshipMinutes: number): TimingItem[] => [
  { id: "a", reference: "Opening prayer", planned_minutes: 5 },
  { id: "b", reference: "Worship", planned_minutes: worshipMinutes },
  { id: "c", reference: "Sermon", planned_minutes: 30, starts_at: "10:30" },
]
const input = (worshipMinutes: number, now: number): TimingInput => ({
  items: plan(worshipMinutes), headers, now, liveItemId: "b",
  firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 5)]]), onAirMs: new Map([["a", 5 * 60_000]]),
})

describe("the next fixed start, as the real timing engine sees it (ADR 25 §8.9)", () => {
  it("is due just after its time when what runs before was on time, whatever the tick's offset", () => {
    for (const now of [at(10, 30, 0, 0), at(10, 30, 0, 400), at(10, 30, 1), at(10, 31, 59)]) {
      expect(nextDueFixedStart(input(20, now), at(9, 0), [])?.id, String(now)).toBe("c")
    }
    expect(nextDueFixedStart(input(20, at(10, 29, 59)), at(9, 0), [])).toBeNull()
    expect(nextDueFixedStart(input(20, at(10, 32, 1)), at(9, 0), [])).toBeNull()
    expect(nextDueFixedStart(input(20, at(10, 30, 1)), at(9, 0), ["c"])).toBeNull()
  })

  it("is not due when what runs before was planned to run past it (a person starts it then)", () => {
    expect(nextDueFixedStart(input(40, at(10, 30, 1)), at(9, 0), [])).toBeNull()
  })
})
