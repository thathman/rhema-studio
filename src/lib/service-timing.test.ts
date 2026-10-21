import { describe, expect, it, vi } from "vitest"
import type { ProgramWithItems, VerseQueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))

import { formatMinutes, plannedTotalMs, projectedEnd, timingSummary } from "./service-timing"
import { rundownSignature, toItemInputs, toQueueItems } from "@/stores/service-store"

const item = (id: string, minutes: number | null): VerseQueueItem => ({
  id, verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, planned_minutes: minutes,
})

describe("service timing", () => {
  it("totals planned minutes and says how far behind the plan the live item is", () => {
    const items = [item("a", 5), item("b", null), item("c", 20), item("d", 10)]
    expect(plannedTotalMs(items)).toBe(35 * 60_000)
    expect(timingSummary(items, null, 99)).toEqual({ totalMs: 35 * 60_000, plannedSoFarMs: 0, behindMs: null })
    const s = timingSummary(items, 2, 30 * 60_000)
    expect(s.plannedSoFarMs).toBe(25 * 60_000)
    expect(s.behindMs).toBe(5 * 60_000)
    expect(timingSummary([item("x", null)], 0, 1000).behindMs).toBeNull()
    expect(formatMinutes(0)).toBe("")
    expect(formatMinutes(45 * 60_000)).toBe("45 min")
    expect(formatMinutes(70 * 60_000)).toBe("1 h 10 min")
    expect(formatMinutes(120 * 60_000)).toBe("2 h")
  })

  it("planned minutes round-trip through the service store and count in the signature", () => {
    const out = toItemInputs([item("a", 7.5), item("b", null)])
    expect(out[0].payload).toBe(JSON.stringify({ planned_minutes: 7.5 }))
    expect(out[1].payload).toBeUndefined()
    const data: ProgramWithItems = {
      program: { id: "p", title: "s", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 },
      items: [{ id: "a", program_id: "p", position: 0, kind: "verse", reference: "John 3:16", book_number: 43, chapter: 3, verse: 16, translation: null, secondary_translation: null, notes: null, payload: out[0].payload ?? null }],
    }
    expect(toQueueItems(data, 1, []).items[0].planned_minutes).toBe(7.5)
    expect(rundownSignature([item("a", 7.5)])).not.toBe(rundownSignature([item("a", 8)]))
  })

  it("projects the end: the plan starts with the timer, running late moves it", () => {
    const now = Date.UTC(2026, 9, 25, 10, 30)
    expect(projectedEnd({ totalMs: 90 * 60_000, plannedSoFarMs: 30 * 60_000, behindMs: 5 * 60_000 }, 35 * 60_000, now)).toEqual({
      plannedEnd: now - 35 * 60_000 + 90 * 60_000,
      expectedEnd: now - 35 * 60_000 + 95 * 60_000,
    })
    expect(projectedEnd({ totalMs: 0, plannedSoFarMs: 0, behindMs: null }, 0, now)).toBeNull()
  })
})
