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
  useBibleStore.setState({ selectedVerse: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }, { id: 7, abbreviation: "OYCB", title: "", language: "yo", is_copyrighted: false, is_downloaded: true }] })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, presentWarning: null })
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

describe("presentActions ticker (Shift+T, #187)", () => {
  it("takes the ticker with its words, stops it when it runs, and does nothing without words", async () => {
    useBroadcastStore.setState({ ticker: null, tickerItems: ["  "], rehearsal: false })
    presentActions.ticker()
    await flush()
    expect(useBroadcastStore.getState().ticker).toBeNull()
    useBroadcastStore.setState({ tickerItems: ["Youth meeting Friday"] })
    presentActions.ticker()
    await flush()
    expect(useBroadcastStore.getState().ticker?.items).toContain("Youth meeting Friday")
    presentActions.ticker()
    expect(useBroadcastStore.getState().ticker).toBeNull()
  })
})

describe("presentActions live safety", () => {
  function deferredLookups() {
    const pending: Array<{ resolve: (v: Verse | null) => void; reject: (e: unknown) => void }> = []
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === "get_verse" ? new Promise<Verse | null>((resolve, reject) => pending.push({ resolve, reject })) : Promise.resolve(null)
    )
    return pending
  }

  it("Next does not go on air before the verse is fetched", async () => {
    useQueueStore.setState({ items: [item(verse(19, 23, 1))] })
    const pending = deferredLookups()
    presentActions.next()
    expect(useBroadcastStore.getState().isLive).toBe(false)
    pending[0].resolve(verse(19, 23, 1, "fetched"))
    await flush()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe("fetched")
  })

  it("after Clear, a Next whose lookup fails leaves the screen cleared and Restore intact", async () => {
    useQueueStore.setState({ items: [item(verse(19, 23, 1)), item(verse(43, 3, 16, ""))] })
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    presentActions.clear()
    const pending = deferredLookups()
    presentActions.next()
    pending[0].reject(new Error("db gone"))
    await flush()
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(false)
    expect(s.liveVerse?.reference).toContain("Book19 23:1")
    expect(presentActions.canRestore()).toBe(true)
    presentActions.restore()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book19 23:1")
  })

  it("Clear pressed while Next is still loading wins", async () => {
    useQueueStore.setState({ items: [item(verse(19, 23, 1)), item(verse(43, 3, 16))] })
    presentActions.next()
    await flush()
    const pending = deferredLookups()
    presentActions.next()
    presentActions.clear()
    pending[0].resolve(verse(43, 3, 16, "late"))
    await flush()
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(false)
    expect(s.liveVerse?.reference).toContain("Book19 23:1")
  })

  it("Previous and Next by keyboard, button and remote all go live only with the verse", async () => {
    useQueueStore.setState({ items: [item(verse(19, 23, 1)), item(verse(43, 3, 16))], activeIndex: 1 })
    const pending = deferredLookups()
    presentActions.prev()
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useQueueStore.getState().activeIndex).toBe(1)
    pending[0].resolve(verse(19, 23, 1, "ok"))
    await flush()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useQueueStore.getState().activeIndex).toBe(0)
  })

  it("Show live presents the preview in the translation the preview is in", async () => {
    useQueueStore.setState({ items: [{ ...item(verse(43, 3, 16)), translation: "OYCB", secondary_translation: "KJV" }] })
    mockInvoke.mockImplementation(async (cmd: string, args: Record<string, number>) =>
      cmd === "get_verse" ? { ...verse(args.bookNumber, args.chapter, args.verse, args.translationId === 7 ? "Yorùbá" : "English"), translation_id: args.translationId } : null
    )
    presentActions.previewItem(useQueueStore.getState().items[0])
    await flush()
    expect(useBibleStore.getState().selectedVerse?.translation_id).toBe(7)
    presentActions.showLive()
    await flush()
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveVerse?.translationLines).toEqual(["Yorùbá", "English"])
    expect(useQueueStore.getState().activeIndex).toBe(0)
  })

  it("ignores a late Preview lookup after another saved edition is selected", async () => {
    const english = { ...item(verse(43, 3, 16, "saved English")), translation: "KJV", secondary_translation: null }
    const yoruba = { ...item(verse(43, 3, 16, "saved Yoruba")), translation: "OYCB", secondary_translation: null }
    useQueueStore.setState({ items: [english, yoruba] })
    const pending: Array<{ translationId: number; resolve: (value: Verse) => void }> = []
    mockInvoke.mockImplementation((cmd: string, args: Record<string, number>) =>
      cmd === "get_verse" ? new Promise<Verse>((resolve) => pending.push({ translationId: args.translationId, resolve })) : Promise.resolve(null)
    )

    presentActions.previewItem(english)
    presentActions.previewItem(yoruba)
    expect(pending.map((lookup) => lookup.translationId)).toEqual([1, 7])

    pending[0].resolve({ ...verse(43, 3, 16, "late English"), translation_id: 1 })
    await flush()
    expect(useBibleStore.getState().selectedQueueItemId).toBe(yoruba.id)
    expect(useBibleStore.getState().selectedVerse?.translation_id).toBe(7)

    pending[1].resolve({ ...verse(43, 3, 16, "fresh Yoruba"), translation_id: 7 })
    await flush()
    expect(useBibleStore.getState().selectedQueueItemId).toBe(yoruba.id)
    expect(useBibleStore.getState().selectedVerse).toMatchObject({ translation_id: 7, text: "fresh Yoruba" })
  })

  it("a rundown item saved for a translation that is not installed warns instead of showing another one", async () => {
    useQueueStore.setState({ items: [{ ...item(verse(43, 3, 16)), translation: "NIV", secondary_translation: null }] })
    presentActions.next()
    await flush()
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(false)
    expect(s.liveVerse).toBeNull()
    expect(s.presentWarning).toMatch(/NIV.*not installed/)
    // The operator overrides deliberately: now it shows in KJV.
    useBibleStore.getState().setOverrideServiceTranslations(true)
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("(KJV)")
    expect(useBroadcastStore.getState().presentWarning).toBeNull()
  })
})

