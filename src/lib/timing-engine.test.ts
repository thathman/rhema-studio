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

  describe("the church's clock, holds, milestones, soft ends, delay modes, finishing and restarts", () => {
    const mainOnly: OutlineHeader[] = [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }]
    const plain: TimingItem[] = [
      { id: "a", reference: "Opening prayer", planned_minutes: 5 },
      { id: "b", reference: "Worship", planned_minutes: 20 },
      { id: "c", reference: "Sermon", planned_minutes: 30, end_by: "11:00" },
      { id: "d", reference: "Blessing", planned_minutes: 5 },
    ]
    const run = (o: Partial<TimingInput>) => serviceTiming(input({ items: plain, headers: mainOnly, ...o }))!
    const worshipLive = (now: number) => ({ now, firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 5)]]), onAirMs: new Map([["a", 5 * 60_000]]), liveItemId: "b" })

    it("works on the church's time zone when one is set, whatever this computer's zone", () => {
      const utc = (h: number, m: number) => Date.UTC(2026, 9, 25, h, m)
      // 10:00 in Lagos is 09:00 UTC.
      const t = run({ now: utc(8, 0), timeZone: "Africa/Lagos" })
      expect(t.start).toBe(utc(9, 0))
      expect(t.events.find((e) => e.id === "c")!.hardStop).toBe(utc(10, 0))
      expect(t.plannedEnd).toBe(utc(10, 0))
      // Without a zone, as before: this computer's 10:00.
      expect(run({ now: at(9, 0) }).start).toBe(at(10, 0))
    })

    it("a hold counts: the live item is expected to end later by the time held", () => {
      // Worship from 10:05 for 20 min, held 10:10–10:13: expected to end 10:28, and the Sermon after it.
      const t = run({ ...worshipLive(at(10, 20)), holds: [{ since: at(10, 10), until: at(10, 13) }] })
      expect(times(t).slice(1, 3)).toEqual(["b 10:05-10:28 live", "c 10:28-10:58 upcoming"])
      expect(t.events[1].heldMs).toBe(3 * 60_000)
      expect(t.held).toBe(false)
      // Still held since 10:15: its time does not run out while held.
      const on = run({ ...worshipLive(at(10, 20)), holds: [{ since: at(10, 15), until: null }] })
      expect(times(on)[1]).toBe("b 10:05-10:30 live")
      expect(on.held).toBe(true)
      // A hold before the service has begun: nothing still to come can start before now.
      const before = run({ now: at(10, 2), holds: [{ since: at(9, 58), until: null }] })
      expect(times(before)[0]).toBe("a 10:02-10:07 upcoming")
      // Without the hold it is still the plan (planning ahead is not "late").
      expect(times(run({ now: at(10, 2) }))[0]).toBe("a 10:00-10:05 upcoming")
    })

    it("a milestone takes no time and is reached, not skipped, once what follows starts", () => {
      const items: TimingItem[] = [plain[0], { id: "m", reference: "Livestream begins", planned_minutes: 10, timing: { milestone: true } }, plain[1]]
      const plan = run({ items })
      expect(times(plan)).toEqual(["a 10:00-10:05 upcoming", "m 10:05-10:05 upcoming", "b 10:05-10:25 upcoming"])
      expect(plan.events[1].milestone).toBe(true)
      const t = run({ items, ...worshipLive(at(10, 7)) })
      expect(times(t)).toEqual(["a 10:00-10:05 done", "m 10:05-10:05 done", "b 10:05-10:25 live"])
      // Taken by itself, it lasts no time: what follows can start now.
      const taken = run({ items, now: at(10, 6), firstOnAir: new Map([["a", at(10, 0)], ["m", at(10, 5)]]), onAirMs: new Map([["a", 5 * 60_000]]), liveItemId: "m" })
      expect(times(taken).slice(1)).toEqual(["m 10:05-10:05 live", "b 10:06-10:26 upcoming"])
      expect(taken.events[1].overrun).toBe(false)
    })

    it("an item with no minutes and no milestone mark is still skipped when jumped over", () => {
      const items: TimingItem[] = [plain[0], { id: "z", reference: "Notices" }, plain[1]]
      expect(times(run({ items, ...worshipLive(at(10, 7)) }))[1]).toBe("z 10:05-10:05 skipped")
    })

    it("a soft end: running past the plan is not over until the soft end; without one it is", () => {
      const soft = plain.map((i) => (i.id === "b" ? { ...i, timing: { soft_end_minutes: 25 } } : i))
      const before = run({ items: soft, ...worshipLive(at(10, 27)) })
      expect(before.events[1]).toMatchObject({ overrun: false, softEnd: at(10, 30) })
      // Expected times still follow what is happening (and the plan for the rest), not the soft end.
      expect(times(before)[1]).toBe("b 10:05-10:27 live")
      expect(run({ items: soft, ...worshipLive(at(10, 31)) }).events[1].overrun).toBe(true)
      expect(run({ ...worshipLive(at(10, 26)) }).events[1]).toMatchObject({ overrun: true, softEnd: null })
      expect(run({ ...worshipLive(at(10, 24)) }).events[1].overrun).toBe(false)
      // Done after running past its end is an overrun too.
      const done = run({ now: at(10, 40), firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 2)], ["c", at(10, 30)]]), onAirMs: new Map([["a", 2 * 60_000], ["b", 28 * 60_000]]), liveItemId: "c" })
      expect(done.events.slice(0, 2).map((e) => e.overrun)).toEqual([false, true])
    })

    it("each item's warning: two minutes unless it has its own", () => {
      const t = run({ items: plain.map((i) => (i.id === "c" ? { ...i, timing: { warn_minutes: 5 } } : i)) })
      expect(t.events.map((e) => e.warnMs / 60_000)).toEqual([2, 2, 5, 2])
    })

    it("push: the delay moves everything still to come, pauses and fixed starts too", () => {
      const gapped: TimingItem[] = [plain[0], plain[1], { id: "c", reference: "Sermon", planned_minutes: 10, gap_minutes: 5 }, plain[3]]
      expect(times(run({ items: gapped, adjustMinutes: 5 })).slice(2)).toEqual(["c 10:30-10:40 upcoming", "d 10:40-10:45 upcoming"])
      const pushed = run({ items: gapped, adjustMinutes: 5, offsetMode: "push" })
      expect(times(pushed)).toEqual(["a 10:05-10:10 upcoming", "b 10:10-10:30 upcoming", "c 10:35-10:45 upcoming", "d 10:45-10:50 upcoming"])
      expect(pushed.events[2].absorbedMs).toBe(0)
      expect(Math.round(pushed.lateMs / 60_000)).toBe(5)
      // A fixed start moves with it, and says it is late for its time.
      const fixed: TimingItem[] = [plain[0], plain[1], { id: "c", reference: "Notices", planned_minutes: 10, starts_at: "10:30" }, plain[3]]
      const f = run({ items: fixed, adjustMinutes: 10, offsetMode: "push" })
      expect(times(f).slice(2)).toEqual(["c 10:40-10:50 upcoming", "d 10:50-10:55 upcoming"])
      expect(f.events[2].conflict).toBe(true)
      // Real lateness is still taken up by a pause; only the delay is pushed through it.
      const late = run({ items: gapped, ...worshipLive(at(10, 7)), firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 8)]]), now: at(10, 9), adjustMinutes: 5, offsetMode: "push" })
      expect(times(late)[2]).toBe("c 10:35-10:45 upcoming")
      expect(late.events[2].absorbedMs).toBe(3 * 60_000)
    })

    it("push: a hard stop still cuts, and takes up what it cuts", () => {
      const t = run({ adjustMinutes: 10, offsetMode: "push" })
      expect(times(t).slice(2)).toEqual(["c 10:35-11:00 upcoming squeezed", "d 11:00-11:05 upcoming"])
    })

    it("finished: what never started was skipped, and the service ended when the last item did", () => {
      const t = run({ now: at(10, 40), firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 5)]]), onAirMs: new Map([["a", 5 * 60_000], ["b", 30 * 60_000]]), liveItemId: null, finishedAt: at(10, 35) })
      expect(times(t)).toEqual(["a 10:00-10:05 done", "b 10:05-10:35 done", "c 10:35-10:35 skipped", "d 10:35-10:35 skipped"])
      expect(t.finished).toBe(true)
      expect(t.expectedEnd).toBe(at(10, 35))
      expect(t.sections.find((x) => x.id === "main")!.state).toBe("done")
    })

    it("after a restart: the item running is still the one happening, flagged, with no time made up", () => {
      // Rhema closed during Worship and came back at 10:35; nothing has started since.
      const base = { now: at(10, 35), firstOnAir: new Map([["a", at(10, 0)], ["b", at(10, 5)]]), onAirMs: new Map([["a", 5 * 60_000], ["b", 30 * 60_000]]), liveItemId: null }
      const t = run({ ...base, untrustedId: "b" })
      expect(t.events[1]).toMatchObject({ state: "live", untrusted: true, actualStart: at(10, 5) })
      expect(times(t).slice(1, 3)).toEqual(["b 10:05-10:35 live", "c 10:35-11:00 upcoming squeezed"])
      // Not flagged: as before, the item is done (it ran until now).
      expect(run(base).events[1]).toMatchObject({ state: "done", untrusted: false })
      // The operator moved on: it is done, and still flagged until someone confirms it.
      const on = run({ ...base, firstOnAir: new Map([...base.firstOnAir, ["c", at(10, 36)]]), now: at(10, 37), liveItemId: "c", untrustedId: "b" })
      expect(on.events[1]).toMatchObject({ state: "done", untrusted: true })
      expect(on.events[2].untrusted).toBe(false)
    })

    it("expected finish per group and per phase (warm-up before, loops around)", () => {
      const items: TimingItem[] = [
        { id: "loop", reference: "Welcome loop" },
        { id: "w1", reference: "Warm-up song", planned_minutes: 3 },
        { id: "w2", reference: "Warm-up video", planned_minutes: 2 },
        { id: "a", reference: "Opening", planned_minutes: 5 },
        { id: "b", reference: "Worship", planned_minutes: 20 },
        { id: "c", reference: "Sermon", planned_minutes: 30 },
        { id: "d", reference: "Blessing", planned_minutes: 5 },
        { id: "out", reference: "Goodbye loop" },
      ]
      const hs: OutlineHeader[] = [
        { id: "pre", type: "phase", name: "Pre-service loop", at: 0, rule: "loop", role: "pre" },
        { id: "warm", type: "phase", name: "Warm-up", at: 1, rule: "auto_once", role: "warmup" },
        { id: "main", type: "phase", name: "Main service", at: 3, rule: "manual", role: "main", starts_at: "10:00" },
        { id: "g1", type: "group", name: "Worship", at: 3 },
        { id: "g2", type: "group", name: "The Word", at: 5 },
        { id: "post", type: "phase", name: "Post-service loop", at: 7, rule: "loop", role: "post" },
      ]
      const sec = (t: ReturnType<typeof serviceTiming>) => t!.sections.map((x) => `${x.id} ${x.plannedStart === null ? "-" : hhmm(x.plannedStart)}/${x.plannedEnd === null ? "-" : hhmm(x.plannedEnd)} → ${x.expectedStart === null ? "-" : hhmm(x.expectedStart)}/${x.expectedEnd === null ? "-" : hhmm(x.expectedEnd)} ${x.state}`)
      const plan = serviceTiming(input({ items, headers: hs }))
      expect(sec(plan)).toEqual([
        "pre -/09:55 → -/09:55 upcoming",
        "warm 09:55/10:00 → 09:55/10:00 upcoming",
        "main 10:00/11:00 → 10:00/11:00 upcoming",
        "g1 10:00/10:25 → 10:00/10:25 upcoming",
        "g2 10:25/11:00 → 10:25/11:00 upcoming",
        "post 11:00/- → 11:00/- upcoming",
      ])
      // The warm-up began two minutes late: it is expected to run to 10:02, and the loop before it ended as it began.
      const warm = serviceTiming(input({ items, headers: hs, now: at(9, 58), firstOnAir: new Map([["w1", at(9, 57)]]), onAirMs: new Map([["w1", 60_000]]), liveItemId: "w1" }))
      expect(sec(warm).slice(0, 2)).toEqual(["pre -/09:55 → -/09:57 done", "warm 09:55/10:00 → 09:57/10:02 live"])
      // Worship running 6 minutes over: its group, the next group, the service and the loop after it move.
      const over = serviceTiming(input({ items, headers: hs, now: at(10, 31), firstOnAir: new Map([["w1", at(9, 55)], ["a", at(10, 0)], ["b", at(10, 5)]]), onAirMs: new Map([["w1", 5 * 60_000], ["a", 5 * 60_000]]), liveItemId: "b" }))
      expect(sec(over).slice(1)).toEqual([
        "warm 09:55/10:00 → 09:55/10:00 done",
        "main 10:00/11:00 → 10:00/11:06 live",
        "g1 10:00/10:25 → 10:00/10:31 live",
        "g2 10:25/11:00 → 10:31/11:06 upcoming",
        "post 11:00/- → 11:06/- upcoming",
      ])
    })

    it("repeated groups with the same name are kept apart, and a plan that overlaps itself is flagged", () => {
      const hs: OutlineHeader[] = [...mainOnly, { id: "x1", type: "group", name: "Worship", at: 0 }, { id: "x2", type: "group", name: "Worship", at: 2 }]
      const t = run({ headers: hs })
      expect(t.sections.filter((x) => x.type === "group").map((x) => `${x.id} ${hhmm(x.plannedStart!)}-${hhmm(x.plannedEnd!)}`)).toEqual(["x1 10:00-10:25", "x2 10:25-11:00"])
      // Notices fixed at 10:10 while Worship is planned to 10:25: the plan keeps 10:10, expected follows Worship.
      const overlap = run({ items: [plain[0], plain[1], { id: "n", reference: "Notices", planned_minutes: 5, starts_at: "10:10" }] })
      expect(overlap.events[2]).toMatchObject({ plannedStart: at(10, 10), expectedStart: at(10, 25), conflict: true })
    })
  })
})
