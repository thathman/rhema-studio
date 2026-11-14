// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { SlideQueueItem, SongQueueItem, SongWithSections, Verse } from "@/types"
import { bibleActions } from "@/hooks/use-bible"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongStore } from "@/stores/song-store"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
import { SlideList } from "@/studio/present/rundown-list"
import { QuickFind } from "@/studio/present/quick-find"

/** Pickers inside Prepare (#447): choosing a song slide or a Quick find result never writes Live's Preview. */
const previewA: SlideQueueItem = { id: "item-a", kind: "slide", slide: { title: "Preview A", body: "" }, reference: "Preview A", confidence: 1, source: "manual", added_at: 0 }
const song: SongQueueItem = {
  id: "song-c", kind: "song", reference: "Song C", confidence: 1, source: "manual", added_at: 0,
  song: { song_id: "song-1", title: "Song C", hymn: false, hymn_numbers: [], arrangement_id: "default", languages: ["en"] },
}
const library: SongWithSections = {
  song: { id: "song-1", title: "Song C", authors: "", copyright: "", ccli_number: null, licence: "public_domain", licence_note: "", primary_language: "en", tags: "", notes: "", key: "", tempo: null, revision: 1, created_at: "", updated_at: "" },
  sections: [
    { id: "verse", kind: "verse", label: "Verse 1", texts: { en: "Verse words" } },
    { id: "chorus", kind: "chorus", label: "Chorus", texts: { en: "Chorus words" } },
  ],
  arrangements: [{ id: "default", name: "Default", sequence: ["verse", "chorus"], is_default: true }],
  numbers: [],
}
const verse: Verse = { id: 1, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" }

let root: Root | null = null
const preview = () => { const s = useBibleStore.getState(); return { slide: s.selectedSlide, verse: s.selectedVerse, id: s.selectedQueueItemId } }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useQueueStore.setState({ items: [previewA, song], headers: [], activeIndex: null, addTarget: null })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: { item: previewA, index: 0 }, selectedQueueItemId: previewA.id, books: [] })
  useSongStore.setState({ songs: { "song-1": library }, missing: [] })
  useRundownSelection.setState({ ids: [], anchor: null, focusId: song.id, focusSlideIndex: 0 })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("Prepare's pickers stay private (#447)", () => {
  it("a song slide clicked in Prepare shows in Prepare only; Live's Preview stays A", async () => {
    await act(async () => root!.render(<SlideList item={song} index={1} mode="prepare" />))
    const before = preview()
    const chorus = [...document.querySelectorAll<HTMLButtonElement>("li button")].find((b) => b.textContent?.includes("Chorus"))!
    expect(chorus).toBeTruthy()
    await act(async () => chorus.click())
    expect(useRundownSelection.getState()).toMatchObject({ focusId: song.id, focusSlideIndex: 1 })
    expect(chorus.getAttribute("aria-current")).toBe("true")
    expect(preview()).toEqual(before)
  })

  it("a Quick find result picked in Prepare's Add dialog is only marked; Live's Preview stays A", async () => {
    vi.spyOn(bibleActions, "searchVerses").mockResolvedValue([verse])
    vi.spyOn(bibleActions, "fetchVerse").mockResolvedValue(null)
    const select = vi.spyOn(bibleActions, "selectVerse")
    useSongStore.setState({ lookup: async () => [], all: async () => [], loadHymnbooks: async () => {} } as never)
    await act(async () => root!.render(<QuickFind mode="prepare" scope="bible" />))
    const before = preview()
    const input = document.querySelector<HTMLInputElement>("input")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "loved the world")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    const row = [...document.querySelectorAll<HTMLButtonElement>("li button")].find((b) => b.textContent?.includes("John 3:16"))!
    expect(row).toBeTruthy()
    await act(async () => row.click())
    expect(row.getAttribute("aria-current")).toBe("true")
    expect(select).not.toHaveBeenCalled()
    expect(preview()).toEqual(before)
  })

  it("finds a passage by its words in the church's second Bible when the active one has none (Yorùbá)", async () => {
    const { invoke } = await import("@tauri-apps/api/core")
    vi.spyOn(bibleActions, "searchVerses").mockResolvedValue([])
    const fetch = vi.spyOn(bibleActions, "fetchVerse").mockResolvedValue(verse)
    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => command === "search_verses" && (args as { translationId: number }).translationId === 2 ? [{ ...verse, translation_id: 2, text: "Nítorí Ọlọ́run fẹ́ aráyé" }] : null)
    useBibleStore.setState({ activeTranslationId: 1, secondaryTranslationId: 2 } as never)
    useSongStore.setState({ lookup: async () => [], all: async () => [], loadHymnbooks: async () => {} } as never)
    await act(async () => root!.render(<QuickFind mode="prepare" scope="bible" />))
    const input = document.querySelector<HTMLInputElement>("input")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "olorun fe araye")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
    // Shown as the passage in the active Bible, like any other result.
    expect(fetch).toHaveBeenCalledWith(verse.book_number, verse.chapter, verse.verse)
    expect([...document.querySelectorAll("li button")].some((b) => b.textContent?.includes("John 3:16"))).toBe(true)
    vi.mocked(invoke).mockImplementation(async () => null)
  })
})
