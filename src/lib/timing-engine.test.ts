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

  it("an item jumped over is skipped: no expected time, and the rest follows the live item", () => {
    // Opening prayer ran 10:00–10:05; Worship never went on air; the Sermon is on now.
    const t = serviceTiming(input({
      now: at(10, 10),
      firstOnAir: new Map([["a", at(10, 0)], ["c", at(10, 5)]]),
      onAirMs: new Map([["a", 5 * 60_000], ["c", 5 * 60_000]]),
      liveItemId: "c",
      adjustMinutes: 5,
    }))!
    const b = t.events.find((e) => e.id === "b")!
    expect(b.state).toBe("skipped")
    expect(b.expectedEnd - b.expectedStart).toBe(0)
    expect(b.actualStart).toBeNull()
    expect(b.plannedStart).toBe(at(10, 5))
    expect(times(t)).toEqual(["a 10:00-10:05 done", "b 10:05-10:05 skipped", "c 10:05-10:35 live", "d 10:40-10:45 upcoming"])
    // Twenty minutes of worship not done: the service is expected to end 15 min early (with +5).
    expect(Math.round(t.lateMs / 60_000)).toBe(-15)
  })

  it("off air after a jump: what was jumped over stays skipped, what is after the last one on air is still to come", () => {
    const t = serviceTiming(input({ now: at(10, 40), firstOnAir: new Map([["c", at(10, 2)]]), onAirMs: new Map([["c", 30 * 60_000]]), liveItemId: null }))!
    expect(t.events.map((e) => e.state)).toEqual(["skipped", "skipped", "done", "upcoming"])
    expect(times(t)[3]).toBe("d 10:40-10:45 upcoming")
  })

  it("the operator's ±5 shifts only what is still to come", () => {
    const t = serviceTiming(input({ now: at(9, 30), adjustMinutes: 5 }))!
    expect(times(t)[0]).toBe("a 10:05-10:10 upcoming")
    expect(t.events[0].plannedStart).toBe(at(10, 0))
  })

  it("planning in the evening before: nothing has begun, so the plan stands (not hours late)", () => {
    const t = serviceTiming(input({ now: at(22, 41) }))!
    expect(t.lateMs).toBe(0)
    expect(times(t)[0]).toBe("a 10:00-10:05 upcoming")
  })

  it("a watchnight across midnight: begun at 23:31, at 00:10 the start is last night's, and an end by 00:15 is that night's", () => {
    const night = (d: number, h: number, m: number) => new Date(2026, 11, d, h, m).getTime()
    const late = headers.map((h) => (h.id === "main" ? { ...h, starts_at: "23:30" } : h))
    const t = serviceTiming(input({
      headers: late,
      items: items.map((i) => (i.id === "c" ? { ...i, end_by: "00:15" } : i)),
      firstOnAir: new Map([["a", night(31, 23, 31)], ["b", night(31, 23, 36)]]),
      onAirMs: new Map([["a", 5 * 60_000], ["b", 34 * 60_000]]),
      liveItemId: "b",
      now: night(32, 0, 10),
    }))!
    expect(t.start).toBe(night(31, 23, 30))
    expect(times(t)).toEqual(["a 23:31-23:36 done", "b 23:36-00:10 live", "c 00:10-00:15 upcoming squeezed", "d 00:15-00:20 upcoming"])
    expect(Math.round(t.lateMs / 60_000)).toBe(-10)
  })

  it("before a watchnight: at 23:00 a 00:30 start is tonight's, not this morning's", () => {
    const late = headers.map((h) => (h.id === "main" ? { ...h, starts_at: "00:30" } : h))
    expect(serviceTiming(input({ headers: late, now: at(23, 0) }))!.start).toBe(new Date(2026, 9, 26, 0, 30).getTime())
  })

  it("no start time, no timing", () => {
    expect(serviceTiming(input({ headers: headers.map((h) => ({ ...h, starts_at: undefined })) }))).toBeNull()
  })

  describe("fixed starts, pauses and the offset (R3)", () => {
    // Opening 10:00–10:05, Worship 10:05–10:25, Notices fixed at 10:30 (5 min free before it), Blessing after it.
    const mainOnly: OutlineHeader[] = [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }]
    const fixedItems: TimingItem[] = [
      { id: "a", reference: "Opening prayer", planned_minutes: 5 },
      { id: "b", reference: "Worship", planned_minutes: 20 },
      { id: "c", reference: "Notices", planned_minutes: 10, starts_at: "10:30" },
      { id: "d", reference: "Blessing", planned_minutes: 5 },
    ]
    const fixed = (o: Partial<TimingInput>) => serviceTiming(input({ items: fixedItems, headers: mainOnly, ...o }))!
    const worshipFrom = (h: number, m: number) => ({ now: at(h, m + 2), firstOnAir: new Map([["a", at(10, 0)], ["b", at(h, m)]]), onAirMs: new Map([["a", m * 60_000]]), liveItemId: "b" })

    it("the plan: a fixed start is its planned start, and the free time before it is a pause", () => {
      const t = fixed({})
      expect(times(t)).toEqual(["a 10:00-10:05 upcoming", "b 10:05-10:25 upcoming", "c 10:30-10:40 upcoming", "d 10:40-10:45 upcoming"])
      const c = t.events[2]
      expect([c.fixedStart, c.plannedStart, c.gapMs, c.absorbedMs, c.conflict]).toEqual([at(10, 30), at(10, 30), 5 * 60_000, 0, false])
      expect(t.events[3].fixedStart).toBeNull()
      expect(hhmm(t.plannedEnd)).toBe("10:45")
    })

    it("running late by less than the free time: it holds its time and the pause is used", () => {
      // Worship began 10:08, so it is expected to end 10:28: two minutes left before 10:30.
      const t = fixed(worshipFrom(10, 8))
      expect(times(t).slice(1)).toEqual(["b 10:08-10:28 live", "c 10:30-10:40 upcoming", "d 10:40-10:45 upcoming"])
      expect(t.events[2]).toMatchObject({ conflict: false, absorbedMs: 3 * 60_000 })
      expect(t.lateMs).toBe(0)
    })

    it("running late past it: it starts when what is before ends, and says so", () => {
      const t = fixed(worshipFrom(10, 13))
      expect(times(t).slice(2)).toEqual(["c 10:33-10:43 upcoming", "d 10:43-10:48 upcoming"])
      expect(t.events[2]).toMatchObject({ conflict: true, absorbedMs: 5 * 60_000 })
      expect(Math.round(t.lateMs / 60_000)).toBe(3)
    })

    it("running early: it still starts at its time, not before", () => {
      const t = fixed(worshipFrom(10, 2))
      expect(times(t).slice(1, 3)).toEqual(["b 10:02-10:22 live", "c 10:30-10:40 upcoming"])
      expect(t.events[2].conflict).toBe(false)
    })

    it("the offset moves linked items but not a fixed start; what follows it follows it", () => {
      const t = fixed({ adjustMinutes: 10 })
      expect(times(t)).toEqual(["a 10:10-10:15 upcoming", "b 10:15-10:35 upcoming", "c 10:30-10:40 upcoming", "d 10:40-10:45 upcoming"])
      expect(t.events[2].conflict).toBe(false)
    })

    it("real lateness still reaches a fixed start under an offset, and only the real part", () => {
      // Worship 3 min past 10:30 for real; +5 on top would be 10:38, but the fixed start waits only for what really runs.
      const t = fixed({ ...worshipFrom(10, 13), adjustMinutes: 5 })
      expect(times(t)[2]).toBe("c 10:33-10:43 upcoming")
      expect(t.events[2].conflict).toBe(true)
    })

    it("a fixed start the plan itself runs past is a conflict before the service", () => {
      const t = fixed({ items: fixedItems.map((i) => (i.id === "b" ? { ...i, planned_minutes: 30 } : i)) })
      expect(times(t)[2]).toBe("c 10:35-10:45 upcoming")
      expect(t.events[2]).toMatchObject({ plannedStart: at(10, 30), conflict: true, gapMs: 0 })
    })

    // Opening, Worship, then a planned 5 min pause before the Sermon (10:30), then the Blessing.
    const gapItems: TimingItem[] = [
      { id: "a", reference: "Opening prayer", planned_minutes: 5 },
      { id: "b", reference: "Worship", planned_minutes: 20 },
      { id: "c", reference: "Sermon", planned_minutes: 10, gap_minutes: 5 },
      { id: "d", reference: "Blessing", planned_minutes: 5 },
    ]
    const gapped = (o: Partial<TimingInput>) => serviceTiming(input({ items: gapItems, headers: mainOnly, ...o }))!

    it("a pause is in the plan", () => {
      const t = gapped({})
      expect(times(t)).toEqual(["a 10:00-10:05 upcoming", "b 10:05-10:25 upcoming", "c 10:30-10:40 upcoming", "d 10:40-10:45 upcoming"])
      expect(t.events[2]).toMatchObject({ gapMs: 5 * 60_000, absorbedMs: 0, fixedStart: null })
    })

    it("3 min late: the pause takes it up and the Sermon stays on plan", () => {
      const t = gapped(worshipFrom(10, 8))
      expect(times(t).slice(2)).toEqual(["c 10:30-10:40 upcoming", "d 10:40-10:45 upcoming"])
      expect(t.events[2].absorbedMs).toBe(3 * 60_000)
      expect(t.lateMs).toBe(0)
    })

    it("7 min late: the pause is used up and only the 2 min beyond it push on", () => {
      const t = gapped(worshipFrom(10, 12))
      expect(times(t).slice(2)).toEqual(["c 10:32-10:42 upcoming", "d 10:42-10:47 upcoming"])
      expect(t.events[2].absorbedMs).toBe(5 * 60_000)
      expect(Math.round(t.lateMs / 60_000)).toBe(2)
    })

    it("early: the pause is kept, so what follows moves up", () => {
      const t = gapped(worshipFrom(10, 2))
      expect(times(t)[2]).toBe("c 10:27-10:37 upcoming")
      expect(t.events[2].absorbedMs).toBe(0)
    })

    it("the offset is taken up by a pause too", () => {
      const t = gapped({ adjustMinutes: 5 })
      expect(times(t).slice(1, 3)).toEqual(["b 10:10-10:30 upcoming", "c 10:30-10:40 upcoming"])
      expect(t.events[2].absorbedMs).toBe(5 * 60_000)
    })

    it("once an item has begun, its pause is history: nothing absorbed", () => {
      const t = gapped({ now: at(10, 41), firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 5)], ["c", at(10, 31)]]), onAirMs: new Map([["a", 5 * 60_000], ["b", 20 * 60_000]]), liveItemId: "c" })
      expect(t.events[2]).toMatchObject({ state: "live", gapMs: 5 * 60_000, absorbedMs: 0, conflict: false })
    })

    it("a fixed start after midnight in a watchnight is that night's", () => {
      const night = (d: number, h: number, m: number) => new Date(2026, 11, d, h, m).getTime()
      const late = [{ ...mainOnly[0], starts_at: "23:30" }]
      const t = serviceTiming(input({ items: fixedItems.map((i) => (i.id === "c" ? { ...i, starts_at: "00:05" } : i)), headers: late, now: night(31, 22, 0) }))!
      expect(t.events[2]).toMatchObject({ fixedStart: night(32, 0, 5), plannedStart: night(32, 0, 5), gapMs: 10 * 60_000, conflict: false })
      expect(hhmm(t.plannedEnd)).toBe("00:20")
    })
  })
})
