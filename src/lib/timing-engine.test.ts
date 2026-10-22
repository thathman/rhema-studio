import { describe, expect, it } from "vitest"
import { serviceTiming, type TimingInput, type TimingItem } from "./timing-engine"
import type { OutlineHeader } from "./run-of-show"

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 25, h, m, s).getTime()
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const items: TimingItem[] = [
  { id: "loop", reference: "Welcome loop" },
  { id: "a", reference: "Opening prayer", planned_minutes: 5 },
  { id: "b", reference: "Worship", planned_minutes: 20 },
  { id: "c", reference: "Sermon", planned_minutes: 30, end_by: "11:00" },
  { id: "d", reference: "Blessing", planned_minutes: 5 },
]
const headers: OutlineHeader[] = [
  { id: "pre", type: "phase", name: "Pre-service loop", at: 0, rule: "loop", role: "pre" },
  { id: "main", type: "phase", name: "Main service", at: 1, rule: "manual", role: "main", starts_at: "10:00" },
  { id: "g", type: "group", name: "The Word", at: 3 },
]
const input = (o: Partial<TimingInput>): TimingInput => ({ items, headers, firstOnAir: new Map(), onAirMs: new Map(), liveItemId: null, now: at(9, 30), ...o })
const times = (t: ReturnType<typeof serviceTiming>) => t!.events.map((e) => `${e.id} ${hhmm(e.expectedStart)}-${hhmm(e.expectedEnd)} ${e.state}${e.squeezed ? " squeezed" : ""}`)

describe("timing engine (issue #196)", () => {
  it("before the service: the plan, groups included, and nothing outside the main phase", () => {
    const t = serviceTiming(input({}))!
    expect(hhmm(t.start)).toBe("10:00")
    expect(hhmm(t.plannedEnd)).toBe("11:00")
    expect(t.lateMs).toBe(0)
    expect(times(t)).toEqual(["a 10:00-10:05 upcoming", "b 10:05-10:25 upcoming", "c 10:25-10:55 upcoming", "d 10:55-11:00 upcoming"])
  })

  it("starting late moves what is expected, never the plan", () => {
    const t = serviceTiming(input({ now: at(10, 4), firstOnAir: new Map([["a", at(10, 4)]]), liveItemId: "a" }))!
    expect(times(t)[0]).toBe("a 10:04-10:09 live")
    expect(t.events[0].plannedStart).toBe(at(10, 0))
    expect(Math.round(t.lateMs / 60_000)).toBe(4)
  })

  it("a live item running over pushes the rest; a finished one counts as it actually ran", () => {
    const t = serviceTiming(input({
      now: at(10, 30),
      firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 3)]]),
      onAirMs: new Map([["a", 3 * 60_000], ["b", 27 * 60_000]]),
      liveItemId: "b",
    }))!
    expect(times(t).slice(0, 2)).toEqual(["a 10:00-10:03 done", "b 10:03-10:30 live"])
    // 10:30 + 30 min ends exactly at its 11:00 hard stop: not cut.
    expect(times(t)[2]).toBe("c 10:30-11:00 upcoming")
  })

  it("a hard stop cuts the sermon to fit, and the rest follows it", () => {
    const t = serviceTiming(input({ now: at(10, 40), firstOnAir: new Map([["a", at(10, 10)], ["b", at(10, 15)]]), onAirMs: new Map([["a", 5 * 60_000]]), liveItemId: "b" }))!
    const c = t.events.find((e) => e.id === "c")!
    expect(c.squeezed).toBe(true)
    expect(hhmm(c.expectedStart)).toBe("10:40")
    expect(hhmm(c.expectedEnd)).toBe("11:00")
    expect(hhmm(t.events.find((e) => e.id === "d")!.expectedStart)).toBe("11:00")
  })

  it("off air between items: what is next can only start from now", () => {
    const t = serviceTiming(input({ now: at(10, 12), firstOnAir: new Map([["a", at(10, 0)]]), onAirMs: new Map([["a", 5 * 60_000]]), liveItemId: null }))!
    expect(times(t).slice(0, 2)).toEqual(["a 10:00-10:05 done", "b 10:12-10:32 upcoming"])
  })

  it("the operator's ±5 shifts only what is still to come", () => {
    const t = serviceTiming(input({ now: at(9, 30), adjustMinutes: 5 }))!
    expect(times(t)[0]).toBe("a 10:05-10:10 upcoming")
    expect(t.events[0].plannedStart).toBe(at(10, 0))
  })

  it("no start time, no timing", () => {
    expect(serviceTiming(input({ headers: headers.map((h) => ({ ...h, starts_at: undefined })) }))).toBeNull()
  })
})
