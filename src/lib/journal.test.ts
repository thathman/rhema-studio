import { describe, expect, it } from "vitest"
import { actualByItem, actualDurations, formatJournal, type JournalEntry } from "./journal"

const e = (mono: number, kind: JournalEntry["kind"], label: string, itemId: string | null = null): JournalEntry => ({ at: 1_700_000_000_000 + mono, mono, kind, label, itemId })

describe("service journal", () => {
  it("measures how long each thing was on air, ignoring messages and rehearsal toggles", () => {
    const entries = [e(0, "live", "John 3:16", "a"), e(30_000, "message", "wrap up"), e(60_000, "quick", "Please stand"), e(90_000, "restore", "John 3:16", "a"), e(150_000, "clear", "John 3:16", "a"), e(200_000, "live", "Amazing Grace", "b")]
    const d = actualDurations(entries, 260_000)
    expect(d.map((x) => [x.label, x.ms])).toEqual([["John 3:16", 60_000], ["Please stand", 30_000], ["John 3:16", 60_000], ["Amazing Grace", 60_000]])
    expect(Object.fromEntries(actualByItem(entries, 260_000))).toEqual({ a: 120_000, b: 60_000 })
  })

  it("prints a readable log with planned versus actual", () => {
    const entries = [e(0, "live", "John 3:16", "a"), e(120_000, "live", "Amazing Grace", "b")]
    const text = formatJournal("9 am service", entries, 300_000, new Map([["a", 60_000]]))
    expect(text).toContain("9 am service")
    expect(text).toContain("LIVE          John 3:16  (2:00)")
    expect(text).toContain("John 3:16: 2:00 (planned 1:00, +1:00)")
    expect(text).toContain("Amazing Grace: 3:00")
  })
})
