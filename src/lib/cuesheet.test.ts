import { describe, expect, it } from "vitest"
import { cuesheet } from "./cuesheet"
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
    expect(rows.map((r) => (r.kind === "group" ? `[${r.name} ${r.minutes}]` : r.event.label))).toEqual(["Welcome", "[Praise 10]", "Song 1", "Song 2", "[The word 35]", "Sermon"])
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
})
