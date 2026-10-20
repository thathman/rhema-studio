import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))

import { presentActions } from "./present-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

const verse = (book_number: number, chapter: number, v: number, text = "text"): Verse => ({
  id: 0,
  translation_id: 1,
  book_number,
  book_name: `Book${book_number}`,
  book_abbreviation: "",
  chapter,
  verse: v,
  text,
})

const item = (v: Verse) => ({
  id: crypto.randomUUID(),
  verse: v,
  reference: `${v.book_name} ${v.chapter}:${v.verse}`,
  confidence: 1,
  source: "manual" as const,
  added_at: 0,
})

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  mockInvoke.mockReset()
  // get_verse returns whatever was asked for, with text
  mockInvoke.mockImplementation(async (cmd: string, args: Record<string, number>) =>
    cmd === "get_verse" ? verse(args.bookNumber, args.chapter, args.verse) : null
  )
  useBibleStore.setState({ selectedVerse: null, activeTranslationId: 1, translations: [] })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null })
  useQueueStore.setState({ items: [], activeIndex: null })
})

describe("presentActions", () => {
  it("next presents the first rundown item and goes on air", async () => {
    useQueueStore.setState({ items: [item(verse(19, 23, 1)), item(verse(43, 3, 16))] })
    presentActions.next()
    await flush()
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveVerse?.reference).toContain("Book19 23:1")
    expect(useQueueStore.getState().activeIndex).toBe(0)
  })

  it("next with an empty rundown does nothing", () => {
    presentActions.next()
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("showLive presents the preview and marks the matching rundown item active", async () => {
    useQueueStore.setState({ items: [item(verse(19, 23, 1)), item(verse(43, 3, 16))] })
    useBibleStore.getState().selectVerse(verse(43, 3, 16))
    presentActions.showLive()
    await flush()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book43 3:16")
    expect(useQueueStore.getState().activeIndex).toBe(1)
  })

  it("clear takes the output off air but keeps the item for restore", async () => {
    useBibleStore.getState().selectVerse(verse(43, 3, 16))
    presentActions.showLive()
    await flush()
    presentActions.clear()
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(false)
    expect(s.liveVerse).not.toBeNull()
    expect(presentActions.canRestore()).toBe(true)
    presentActions.restore()
    expect(useBroadcastStore.getState().isLive).toBe(true)
  })

  it("restore with nothing to restore stays off air", () => {
    expect(presentActions.canRestore()).toBe(false)
    presentActions.restore()
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
})
