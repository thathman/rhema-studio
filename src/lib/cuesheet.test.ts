import { describe, expect, it } from "vitest"
import { cuesheet, pauseWords } from "./cuesheet"
import { serviceTiming } from "./timing-engine"
import type { OutlineHeader } from "./run-of-show"

const at = (h: number, m: number) => new Date(2026, 9, 25, h, m).getTime()
const items = [
  { id: "w", reference: "Welcome", planned_minutes: 5 },
  { id: "s1", reference: "Song 1", planned_minutes: 4 },
  { id: "s2", reference: "Song 2", planned_minutes: 6 },
  { id: "m", reference: "Sermon", planned_minutes: 35, end_by: "11:00" },
]
const headers: OutlineHeader[] = [
  { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" },
  { id: "praise", type: "group", name: "Praise", at: 1 },
  { id: "word", type: "group", name: "The word", at: 3 },
]

describe("cuesheet", () => {
  it("lists plan, actual and expected per item, with a total above each group", () => {
    // Welcome began 7 min late and ran 6 min; Song 1 is on now.
    const onAir = new Map([["w", 6 * 60_000], ["s1", 60_000]])
    const t = serviceTiming({ items, headers, firstOnAir: new Map([["w", at(10, 7)], ["s1", at(10, 13)]]), onAirMs: onAir, liveItemId: "s1", now: at(10, 14) })!
    const rows = cuesheet(t, headers, items.length, onAir)
    expect(rows.map((r) => (r.kind === "group" ? `[${r.name} ${r.minutes}]` : r.kind === "gap" ? "pause" : r.event.label))).toEqual(["Welcome", "[Praise 10]", "Song 1", "Song 2", "[The word 35]", "Sermon"])
    const row = (label: string) => rows.find((r) => r.kind === "item" && r.event.label === label)
    expect(row("Welcome")).toMatchObject({ minutes: 5, actualMs: 360_000, offsetMinutes: 7 })
    expect(row("Song 1")).toMatchObject({ minutes: 4, actualMs: 60_000, offsetMinutes: 8 })
    // Still to come: expected after Song 1 ends (10:17), so Song 2 is 8 min late; nothing actual yet.
    expect(row("Song 2")).toMatchObject({ actualMs: null, offsetMinutes: 8 })
    const sermon = row("Sermon")!
    expect(sermon.kind === "item" && [sermon.event.hardStop, sermon.event.squeezed]).toEqual([at(11, 0), false])
    const praise = rows[1]
    expect(praise.kind === "group" && [praise.plannedStart, praise.plannedEnd, praise.expectedEnd]).toEqual([at(10, 5), at(10, 15), at(10, 23)])
  })

  it("an item jumped over says Skipped, with no offset, and the rest follows the live item", () => {
    // Welcome ran; Song 1 never went on air; Song 2 is on now.
    const onAir = new Map([["w", 5 * 60_000], ["s2", 60_000]])
    const t = serviceTiming({ items, headers, firstOnAir: new Map([["w", at(10, 0)], ["s2", at(10, 5)]]), onAirMs: onAir, liveItemId: "s2", now: at(10, 6) })!
    const rows = cuesheet(t, headers, items.length, onAir)
    const row = (label: string) => rows.find((r) => r.kind === "item" && r.event.label === label)
    expect(row("Song 1")).toMatchObject({ event: { state: "skipped" }, actualMs: null, offsetMinutes: null })
    // Song 2 started 4 min early against the plan; the Sermon is expected after it (10:11), not after Song 1 too.
    expect(row("Song 2")).toMatchObject({ event: { state: "live" }, offsetMinutes: -4 })
    expect(row("Sermon")).toMatchObject({ offsetMinutes: -4 })
  })

  it("a pause is its own row above the item (and its group), saying how much lateness it takes up; a fixed start is marked", () => {
    // A 5 min pause before the Praise group; the Sermon fixed at 10:30 (Song 2 is planned to end 10:20).
    const timed = items.map((i) => (i.id === "s1" ? { ...i, gap_minutes: 5 } : i.id === "m" ? { ...i, starts_at: "10:30" } : i))
    // Welcome began 10:03 and is on now: 3 min late, so the pause is expected to take up 3 of its 5 min.
    const onAir = new Map([["w", 60_000]])
    const t = serviceTiming({ items: timed, headers, firstOnAir: new Map([["w", at(10, 3)]]), onAirMs: onAir, liveItemId: "w", now: at(10, 4) })!
    const rows = cuesheet(t, headers, items.length, onAir)
    expect(rows.map((r) => (r.kind === "group" ? `[${r.name}]` : r.kind === "gap" ? `pause ${r.minutes} absorbs ${r.absorbedMinutes}${r.beforeFixed ? " fixed" : ""}` : r.event.label))).toEqual([
      "Welcome", "pause 5 absorbs 3", "[Praise]", "Song 1", "Song 2", "pause 10 absorbs 0 fixed", "[The word]", "Sermon",
    ])
    const sermon = rows.at(-1)!
    expect(sermon.kind === "item" && [sermon.event.fixedStart, sermon.event.expectedStart, sermon.event.conflict]).toEqual([at(10, 30), at(10, 30), false])
    expect(pauseWords(5, 3, false)).toEqual({ label: "Pause · 5 min", absorbs: "absorbs 3 min" })
    expect(pauseWords(5, 5, false).absorbs).toBe("absorbs 5 min · used up")
    expect(pauseWords(5, 0, true)).toEqual({ label: "Pause before the fixed start · 5 min", absorbs: "can absorb 5 min" })
    expect(pauseWords(5, null, false).absorbs).toBe("")
  })

  it("once its item has begun a pause row says nothing about absorbing", () => {
    const timed = items.map((i) => (i.id === "s1" ? { ...i, gap_minutes: 5 } : i))
    const onAir = new Map([["w", 5 * 60_000], ["s1", 60_000]])
    const t = serviceTiming({ items: timed, headers, firstOnAir: new Map([["w", at(10, 0)], ["s1", at(10, 10)]]), onAirMs: onAir, liveItemId: "s1", now: at(10, 11) })!
    expect(cuesheet(t, headers, items.length, onAir).find((r) => r.kind === "gap")).toMatchObject({ minutes: 5, absorbedMinutes: null })
  })
})
