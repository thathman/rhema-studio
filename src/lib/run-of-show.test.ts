import { describe, expect, it } from "vitest"
import { clockInstant, clockText, dwellSeconds, nextInPhase, phaseRange, planTimeline, plannedTimes, defaultPhases, headersAfterAppend, sectionEnd, headersAfterInsert, headersAfterMove, headersAfterRemove, interleave, newRunOfShowEvent, parseRunOfShowEvent, projectRunOfShowEvents, runOfShowClockRows, sectionSummaries, type OutlineHeader } from "./run-of-show"

const h = (id: string, at: number, type: OutlineHeader["type"] = "phase"): OutlineHeader => ({ id, type, name: id, at })
const read = (items: string[], headers: OutlineHeader[]) => interleave(items, headers).map((r) => ("header" in r ? `[${r.header.id}]` : r.item)).join(" ")

describe("run of show headers", () => {
  // [Warm-up] a b [Service] [Word] c d
  const items = ["a", "b", "c", "d"]
  const headers = [h("Warm-up", 0), h("Service", 2), h("Word", 2, "group")]

  it("reads headers before the item they sit above, in their own order", () => {
    expect(read(items, headers)).toBe("[Warm-up] a b [Service] [Word] c d")
    expect(read([], [h("Post", 0)])).toBe("[Post]")
    expect(read(["a"], [h("End", 1)])).toBe("a [End]")
  })

  it("an item added at the top joins the first section; the rest move down", () => {
    expect(read(["x", ...items], headersAfterInsert(headers, 0))).toBe("[Warm-up] x a b [Service] [Word] c d")
  })

  it("removing the first item of a section leaves its header in place", () => {
    expect(read(["a", "b", "d"], headersAfterRemove(headers, 2))).toBe("[Warm-up] a b [Service] [Word] d")
    expect(read(["a", "b"], headersAfterRemove(headersAfterRemove(headers, 3), 2))).toBe("[Warm-up] a b [Service] [Word]")
  })

  it("dragging an item across a header moves it into the other section", () => {
    // c (index 2, first of Service) dragged to the top: it is in Warm-up now.
    expect(read(["c", "a", "b", "d"], headersAfterMove(headers, 2, 0))).toBe("[Warm-up] c a b [Service] [Word] d")
    // a dragged to the end: it is last in Word.
    expect(read(["b", "c", "d", "a"], headersAfterMove(headers, 0, 3))).toBe("[Warm-up] b [Service] [Word] c d a")
    expect(headersAfterMove(headers, 1, 1)).toBe(headers)
  })
})

describe("section summaries", () => {
  it("a phase counts to the next phase, a group to the next header", () => {
    const items = [{ planned_minutes: 2 }, { planned_minutes: 3 }, { planned_minutes: 5 }, {}, { planned_minutes: 10 }]
    // [Warm] 0 1 [Main] [Praise] 2 3 [Word] 4
    const hs = [h("Warm", 0), h("Main", 2), h("Praise", 2, "group"), h("Word", 4, "group")]
    expect(sectionSummaries(items, hs)).toEqual({ Warm: { count: 2, minutes: 5 }, Main: { count: 3, minutes: 15 }, Praise: { count: 2, minutes: 5 }, Word: { count: 1, minutes: 10 } })
  })
  it("summarizes phase events, their moments, and loose items without changing the phase duration", () => {
    const items = [{ planned_minutes: 3 }, { planned_minutes: 2 }, { planned_minutes: 4 }]
    const hs: OutlineHeader[] = [
      { id: "main", type: "phase", name: "Main", at: 0, role: "main" },
      { id: "prayer", type: "group", name: "Prayer", at: 1, event: { schema_version: 1, duration_minutes: 5 } },
      { id: "sermon", type: "group", name: "Sermon", at: 1, event: { schema_version: 1, duration_minutes: 40 } },
      { id: "post", type: "phase", name: "Post", at: 3, role: "post" },
    ]

    expect(sectionSummaries(items, hs).main).toEqual({
      count: 3,
      minutes: 48,
      eventCount: 2,
      momentCount: 2,
      looseItemCount: 1,
    })
  })
  it("the default phases put everything in the main service", () => {
    const ids = ["p", "w", "m", "o"]
    const phases = defaultPhases(3, () => ids.shift()!)
    expect(read(["a", "b", "c"], phases)).toBe("[p] [w] [m] a b c [o]")
    expect(phases.map((x) => x.rule)).toEqual(["loop", "auto_once", "manual", "loop"])
  })

  it("projects one event across nested moment groups without changing the current item timing", () => {
    const items = [{ planned_minutes: 3 }, { planned_minutes: 7 }, { planned_minutes: 2 }]
    const event: OutlineHeader = { id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1, duration_minutes: 40, approval: "draft" } }
    const hs: OutlineHeader[] = [event, h("Scripture", 1, "group"), { ...h("Worship", 2, "group"), event: { schema_version: 1, duration_minutes: 12, approval: "approved" } }]
    expect(sectionEnd(items.length, hs, "sermon")).toBe(2)
    expect(sectionSummaries(items, hs)).toMatchObject({ sermon: { count: 2, minutes: 40 }, Scripture: { count: 1, minutes: 7 }, Worship: { count: 1, minutes: 12 } })
    expect(projectRunOfShowEvents(items, hs).map((e) => ({ id: e.id, duration_minutes: e.duration_minutes, moments: e.moments }))).toEqual([
      { id: "sermon", duration_minutes: 40, moments: items.slice(0, 2) },
      { id: "Worship", duration_minutes: 12, moments: items.slice(2) },
    ])
  })

  it("projects event plans to one Timekeeper row with the event duration and preserves legacy items", () => {
    const items = [
      { id: "welcome-a", reference: "Welcome words", planned_minutes: 2 },
      { id: "welcome-b", reference: "Welcome slide", planned_minutes: 3 },
      { id: "sermon-a", reference: "Scripture", planned_minutes: 2 },
      { id: "sermon-b", reference: "Sermon slides", planned_minutes: 4 },
      { id: "closing", reference: "Closing hymn", planned_minutes: 5 },
    ]
    const headers: OutlineHeader[] = [
      { id: "main", type: "phase", name: "Main service", at: 0, role: "main", starts_at: "10:00" },
      { id: "welcome", type: "group", name: "Opening prayer", at: 0, event: { schema_version: 1, duration_minutes: 15, approval: "approved" } },
      { id: "sermon", type: "group", name: "Sermon", at: 2, event: { schema_version: 1, duration_minutes: 40, approval: "approved" } },
      { id: "post", type: "phase", name: "Post-service", at: 4, role: "post" },
    ]

    const projected = runOfShowClockRows(items, headers)
    expect(projected.rows.map((row) => [row.id, row.reference, row.planned_minutes, row.moments.map((moment) => moment.id)])).toEqual([
      ["welcome", "Opening prayer", 15, ["welcome-a", "welcome-b"]],
      ["sermon", "Sermon", 40, ["sermon-a", "sermon-b"]],
      ["closing", "Closing hymn", 5, ["closing"]],
    ])
    expect(projected.headers.find((header) => header.id === "main")?.at).toBe(0)
  })

  it("creates versioned event plans and treats legacy approval as non-authoritative", () => {
    expect(newRunOfShowEvent(2, () => "event")).toEqual({ id: "event", type: "group", name: "New event", at: 2, event: { schema_version: 1 } })
    expect(parseRunOfShowEvent({ schema_version: 1, approval: "approved", owner_id: "newer-build" })).toEqual({ schema_version: 1, payload_extra: { owner_id: "newer-build" } })
    expect(parseRunOfShowEvent({ schema_version: 1, role: "Prayer" })).toMatchObject({ schema_version: 1, role: "Prayer" })
    expect(parseRunOfShowEvent({ schema_version: 2 })).toBeNull()
    expect(parseRunOfShowEvent({ schema_version: 1, approval: "draft", duration_minutes: 601 })).toBeNull()
  })
})

describe("adding to a section", () => {
  it("an item added to a section goes at its end, above the next section", () => {
    // [Pre] [Warm] [Main] a b [Post]: Pre and Warm are empty.
    const hs = [h("Pre", 0), h("Warm", 0), h("Main", 0), h("Post", 2)]
    const at = sectionEnd(2, hs, "Warm")
    expect(at).toBe(0)
    expect(read(["x", "a", "b"], headersAfterAppend(hs, at, "Warm"))).toBe("[Pre] [Warm] x [Main] a b [Post]")
    // Two in a row keep their order.
    const once = headersAfterAppend(hs, 0, "Warm")
    expect(read(["x", "y", "a", "b"], headersAfterAppend(once, 1, "Warm"))).toBe("[Pre] [Warm] x y [Main] a b [Post]")
    // The last section: after everything.
    expect(sectionEnd(2, hs, "Post")).toBe(2)
    expect(read(["a", "b", "z"], headersAfterAppend(hs, 2, "Post"))).toBe("[Pre] [Warm] [Main] a b [Post] z")
    // A group inside Main ends at the next header.
    const g = [...hs, h("Word", 1, "group")]
    expect(sectionEnd(2, g, "Main")).toBe(2)
    expect(sectionEnd(2, g, "Word")).toBe(2)
  })

  it("adding at an event's end keeps nested group headers inside the event", () => {
    const sermon: OutlineHeader = { id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1, duration_minutes: 40, approval: "draft" } }
    const next: OutlineHeader = { id: "prayer", type: "group", name: "Closing prayer", at: 3, event: { schema_version: 1, approval: "draft" } }
    const headers = [sermon, h("Scripture", 3, "group"), next]
    const at = sectionEnd(3, headers, sermon.id)
    const after = headersAfterAppend(headers, at, sermon.id)
    expect(read(["a", "b", "c", "d"], after)).toBe("[sermon] a b c [Scripture] d [prayer]")
    expect(projectRunOfShowEvents(["a", "b", "c", "d"], after)[0].moments).toEqual(["a", "b", "c", "d"])
  })
})

describe("the planned day", () => {
  const items = [{ reference: "Countdown", planned_minutes: 5 }, { reference: "Hymn", planned_minutes: 4 }, { reference: "Sermon", planned_minutes: 30 }, { reference: "Fellowship loop", planned_minutes: 3 }]
  const phases = (start?: string): OutlineHeader[] => [
    { ...h("Warm-up", 0), role: "warmup", rule: "auto_once" },
    { ...h("Main service", 1), role: "main", rule: "manual", ...(start ? { starts_at: start } : {}) },
    { ...h("Post-service loop", 3), role: "post", rule: "loop" },
  ]
  it("plans from the start: the warm-up ends at it, items follow, the finish adds up", () => {
    const t = planTimeline(items, phases("10:00"))!
    expect(t).toMatchObject({ start: "10:00", warmupStart: "09:55", finish: "10:34" })
    expect(t.rows.map((r) => `${r.time} ${r.label}`)).toEqual(["09:55 Warm-up begins", "10:00 Main service begins", "10:00 Hymn", "10:04 Sermon", "10:34 Main service ends"])
  })
  it("running late moves only the finish; no start time, no plan; midnight wraps", () => {
    expect(planTimeline(items, phases("10:00"), 5)!.finish).toBe("10:39")
    expect(planTimeline(items, phases("10:00"), 5)!.rows[2].time).toBe("10:00")
    expect(planTimeline(items, phases())).toBeNull()
    expect(planTimeline(items, phases("23:50"))!.finish).toBe("00:24")
    expect(clockText(-5)).toBe("23:55")
  })
  it("a fixed start and a pause (#196 R3) are in the plan, the fixed start nearest the item before", () => {
    const withTimes = items.map((i, k) => (k === 2 ? { ...i, gap_minutes: 3 } : i))
    expect(planTimeline(withTimes, phases("10:00"))!.rows.map((r) => `${r.time} ${r.label}${r.pause ? ` +${r.pause}` : ""}`).slice(2, 5)).toEqual(["10:00 Hymn", "10:07 Sermon +3", "10:37 Main service ends"])
    const fixed = items.map((i, k) => (k === 2 ? { ...i, starts_at: "10:10" } : i))
    expect(planTimeline(fixed, phases("10:00"))!.rows[3]).toMatchObject({ time: "10:10", pause: 6, fixed: true })
    expect(planTimeline(fixed, phases("10:00"))!.finish).toBe("10:40")
    expect(planTimeline(items.map((i, k) => (k === 2 ? { ...i, starts_at: "00:05" } : i)), phases("23:50"))!.finish).toBe("00:35")
  })
  it("gives warm-up items their times from the warm-up's start, main items from the plan", () => {
    expect([...plannedTimes(items, phases("10:00"))]).toEqual([[1, "10:00"], [2, "10:04"], [0, "09:55"]])
    expect(plannedTimes(items, phases()).size).toBe(0)
  })
})

describe("a phase running by itself", () => {
  const loop: OutlineHeader = { id: "pre", type: "phase", name: "Pre-service loop", at: 0, rule: "loop" }
  const warm: OutlineHeader = { id: "warm", type: "phase", name: "Warm-up", at: 2, rule: "auto_once", role: "warmup" }

  it("covers its own items, groups included, up to the next phase", () => {
    const headers = [loop, { ...h("g", 1, "group") }, warm]
    expect(phaseRange(4, headers, "pre")).toEqual({ start: 0, end: 2 })
    expect(phaseRange(4, headers, "warm")).toEqual({ start: 2, end: 4 })
    expect(phaseRange(4, headers, "g")).toBeNull()
  })

  it("loops wrap; run-once phases end; outside the phase starts at its first item", () => {
    expect(nextInPhase("loop", 0, 3, 0)).toBe(1)
    expect(nextInPhase("loop", 0, 3, 2)).toBe(0)
    expect(nextInPhase("auto_once", 2, 4, 3)).toBeNull()
    expect(nextInPhase("auto_once", 2, 4, 7)).toBe(2)
    expect(nextInPhase("loop", 2, 2, 2)).toBeNull()
  })

  it("a loop uses its seconds; a run-once phase its planned minutes, so the warm-up ends on time", () => {
    expect(dwellSeconds({ ...loop, advance_seconds: 8 }, 3)).toBe(8)
    expect(dwellSeconds(loop, 3)).toBe(180)
    expect(dwellSeconds(loop, null)).toBe(10)
    expect(dwellSeconds({ ...warm, advance_seconds: 8 }, 5)).toBe(300)
    expect(dwellSeconds(warm, null)).toBe(10)
  })
})

describe("a clock time as an instant", () => {
  it("is the nearest one: yesterday's, today's or tomorrow's", () => {
    const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime()
    expect(clockInstant(10 * 60, at(25, 9, 0))).toBe(at(25, 10, 0))
    expect(clockInstant(23 * 60 + 30, at(26, 0, 10))).toBe(at(25, 23, 30))
    expect(clockInstant(30, at(25, 23, 0))).toBe(at(26, 0, 30))
  })
  it("keeps the local time across a clock change (calendar days, not 24 h)", () => {
    const tz = process.env.TZ
    process.env.TZ = "Europe/London"
    try {
      // The clocks went back at 02:00 on 25 October 2026: that day has 25 hours.
      const t = clockInstant(23 * 60, new Date(2026, 9, 26, 0, 30).getTime())
      expect(new Date(t).getHours()).toBe(23)
      expect(new Date(t).getDate()).toBe(25)
    } finally {
      process.env.TZ = tz
    }
  })
})
