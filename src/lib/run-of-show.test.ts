import { describe, expect, it } from "vitest"
import { defaultPhases, headersAfterInsert, headersAfterMove, headersAfterRemove, interleave, sectionSummaries, type OutlineHeader } from "./run-of-show"

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
