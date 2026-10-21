import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))

import { stepLiveVerse } from "./remote-actions"
import { presentVerse } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

// A tiny Bible: John 3 has 3 verses, John 4 has 2; chapter 5 does not exist.
const CHAPTERS: Record<string, number> = { "43:3": 3, "43:4": 2, "43:2": 4 }
const verse = (t: number, b: number, c: number, v: number): Verse => ({
  id: 0, translation_id: t, book_number: b, book_name: "John", book_abbreviation: "Jn", chapter: c, verse: v, text: `T${t} ${c}:${v}`,
})
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string, a: Record<string, number>) => {
    if (cmd === "get_chapter") {
      const n = CHAPTERS[`${a.bookNumber}:${a.chapter}`] ?? 0
      return Array.from({ length: n }, (_, i) => verse(a.translationId, a.bookNumber, a.chapter, i + 1))
    }
    if (cmd === "get_verse") {
      const n = CHAPTERS[`${a.bookNumber}:${a.chapter}`] ?? 0
      return a.verse >= 1 && a.verse <= n ? verse(a.translationId, a.bookNumber, a.chapter, a.verse) : null
    }
    return null
  })
  useBibleStore.setState({
    selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, pendingNavigation: null, currentChapter: [],
    translations: [
      { id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true },
      { id: 7, abbreviation: "OYCB", title: "", language: "yo", is_copyrighted: false, is_downloaded: true },
    ],
  })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, presentWarning: null })
})

describe("continue the reading (verse next/prev on the live output)", () => {
  it("presents the next verse in the item's saved translation, crossing into the next chapter", async () => {
    await presentVerse(verse(1, 43, 3, 2), { item: { translation: "OYCB", secondary_translation: null }, goLive: true })
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("3:2 (OYCB)")
    await stepLiveVerse(1)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("3:3 (OYCB)")
    expect(useBroadcastStore.getState().isLive).toBe(true)
    await stepLiveVerse(1) // past the chapter end → 4:1
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("4:1 (OYCB)")
    expect(useBibleStore.getState().pendingNavigation).toMatchObject({ bookNumber: 43, chapter: 4, verse: 1 })
    await stepLiveVerse(-1) // back across the boundary → 3:3
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("3:3 (OYCB)")
  })

  it("stops at the end of a book with a warning and leaves the output alone", async () => {
    await presentVerse(verse(1, 43, 4, 2), { goLive: true })
    await stepLiveVerse(1)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("4:2")
    expect(useBroadcastStore.getState().presentWarning).toContain("ends at 4:2")
    expect(useBroadcastStore.getState().isLive).toBe(true)
  })

  it("Clear then Verse + continues from the cleared verse and goes back on air", async () => {
    await presentVerse(verse(1, 43, 3, 1), { goLive: true })
    useBroadcastStore.getState().setLive(false)
    await stepLiveVerse(1)
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("3:2")
  })

  it("with nothing live it steps the preview instead", async () => {
    useBibleStore.setState({ selectedVerse: verse(1, 43, 3, 1), currentChapter: [verse(1, 43, 3, 1), verse(1, 43, 3, 2), verse(1, 43, 3, 3)] })
    await stepLiveVerse(1)
    await flush()
    expect(useBibleStore.getState().selectedVerse?.verse).toBe(2)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("3:2")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("with a song or quick screen on air, Verse + steps the preview and leaves the screen alone", async () => {
    const song = { kind: "slide", reference: "Amazing Grace", segments: [], lines: ["Amazing grace"] } as never
    useBroadcastStore.setState({ isLive: true, liveVerse: song, liveSourceVerse: null })
    useBibleStore.setState({ selectedVerse: verse(1, 43, 3, 1), currentChapter: [verse(1, 43, 3, 1), verse(1, 43, 3, 2)] })
    await stepLiveVerse(1)
    await flush()
    expect(useBibleStore.getState().selectedVerse?.verse).toBe(2)
    expect(useBroadcastStore.getState().liveVerse).toBe(song)
  })
})

