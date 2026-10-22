import { describe, expect, it } from "vitest"
import { clockText, dwellSeconds, nextInPhase, phaseRange, planTimeline, defaultPhases, headersAfterAppend, sectionEnd, headersAfterInsert, headersAfterMove, headersAfterRemove, interleave, sectionSummaries, type OutlineHeader } from "./run-of-show"

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
  it("the default phases put everything in the main service", () => {
    const ids = ["p", "w", "m", "o"]
    const phases = defaultPhases(3, () => ids.shift()!)
    expect(read(["a", "b", "c"], phases)).toBe("[p] [w] [m] a b c [o]")
    expect(phases.map((x) => x.rule)).toEqual(["loop", "auto_once", "manual", "loop"])
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
