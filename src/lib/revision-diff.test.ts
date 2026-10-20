import { describe, expect, it, vi } from "vitest"
import type { ItemInput, VerseQueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))

import { diffRevision } from "./revision-diff"

const item = (id: string, ref: string, v: number, notes: string | null = null): VerseQueueItem => ({
  id, verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: v, text: "" }, reference: ref, confidence: 1, source: "manual", added_at: 0, notes, translation: null, secondary_translation: null,
})
const snap = (id: string, ref: string, v: number, notes: string | null = null): ItemInput => ({ id, kind: "verse", reference: ref, book_number: 43, chapter: 3, verse: v, translation: null, secondary_translation: null, notes })

describe("revision diff", () => {
  it("names what a restore adds and removes, counts changes, and knows when nothing differs", () => {
    const now = [item("a", "John 3:16", 16), item("b", "John 3:17", 17)]
    expect(diffRevision(now, [snap("a", "John 3:16", 16), snap("b", "John 3:17", 17)]).same).toBe(true)
    const d = diffRevision(now, [snap("b", "John 3:17", 17), snap("c", "John 3:18", 18)])
    expect(d.added).toEqual(["John 3:18"])
    expect(d.removed).toEqual(["John 3:16"])
    expect(d.changed).toBe(1) // b moved from position 1 to 0
    expect(d.same).toBe(false)
    expect(diffRevision(now, [snap("a", "John 3:16", 16, "slowly"), snap("b", "John 3:17", 17)]).changed).toBe(1)
  })
})
