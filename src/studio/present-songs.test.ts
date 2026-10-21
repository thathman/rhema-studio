import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SongQueueItem, SongWithSections, Verse, VerseQueueItem } from "@/types"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))

import { presentActions } from "./present-actions"
import { remoteActions } from "@/lib/remote-actions"
import { presentSlide } from "@/hooks/use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongStore } from "@/stores/song-store"

const verse = (book_number: number, chapter: number, v: number, text = "text"): Verse => ({
  id: 0, translation_id: 1, book_number, book_name: `Book${book_number}`, book_abbreviation: "", chapter, verse: v, text,
})
const verseItem = (v: Verse): VerseQueueItem => ({
  id: crypto.randomUUID(), verse: v, reference: `${v.book_name} ${v.chapter}:${v.verse}`, confidence: 1, source: "manual", added_at: 0,
})

const amazing: SongWithSections = {
  song: {
    id: "song-1", title: "Amazing Grace", authors: "John Newton", copyright: "", ccli_number: null, licence: "public_domain",
    licence_note: "", primary_language: "en", tags: "", notes: "", key: "", tempo: null, revision: 1, created_at: "", updated_at: "",
  },
  sections: [
    { id: "v1", kind: "verse", label: "Verse 1", texts: { en: "Amazing grace\nhow sweet", yo: "Oore-ọ̀fẹ́\nìyanu" } },
    { id: "c", kind: "chorus", label: "Chorus", texts: { en: "Praise God" } },
  ],
  arrangements: [{ id: "a1", name: "Default", sequence: ["v1", "c", "v1"], is_default: true }],
  numbers: [],
}

const songItem = (languages = ["en"], id = "item-song"): SongQueueItem => ({
  id, kind: "song", song: { song_id: "song-1", title: "Amazing Grace", arrangement_id: null, languages },
  reference: "Amazing Grace", confidence: 1, source: "manual", added_at: 0,
})

const flush = () => new Promise((r) => setTimeout(r, 0))
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "get_verse") return verse(args.bookNumber as number, args.chapter as number, args.verse as number)
    if (cmd === "content_get_song") return args.id === "song-1" ? amazing : null
    return null
  })
  useBibleStore.setState({
    selectedVerse: null, selectedSlide: null, activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false,
    translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }],
  })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, presentWarning: null })
  useQueueStore.setState({ items: [], activeIndex: null })
  useSongStore.setState({ songs: {} })
})

describe("presentSlide", () => {
  it("goes on air with the slide in one step and keeps preview in sync", async () => {
    const outcome = await presentSlide(songItem(), 0, { goLive: true })
    expect(outcome).toBe("presented")
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveVerse).toMatchObject({ kind: "lyric", reference: "Amazing Grace · Verse 1", lines: ["Amazing grace", "how sweet"] })
    expect(s.liveVerse?.footer).toBeUndefined()
    expect(s.liveSlide).toMatchObject({ itemId: "item-song", songId: "song-1", index: 0, total: 3 })
    expect(s.liveSourceVerse).toBeNull()
    expect(useBibleStore.getState().selectedSlide).toMatchObject({ index: 0 })
  })

  it("renders both languages, reports a section missing one, and footers a CCLI song", async () => {
    await presentSlide(songItem(["en", "yo"]), 0, { goLive: true })
    expect(useBroadcastStore.getState().liveVerse?.secondaryLines).toEqual(["Oore-ọ̀fẹ́", "ìyanu"])
    expect(useBroadcastStore.getState().presentWarning).toBeNull()
    await presentSlide(songItem(["en", "yo"]), 1, { goLive: true })
    expect(useBroadcastStore.getState().liveVerse?.secondaryLines).toBeUndefined()
    expect(useBroadcastStore.getState().presentWarning).toContain("no YO text")

    useSongStore.setState({ songs: { "song-1": { ...amazing, song: { ...amazing.song, licence: "ccli", ccli_number: "777" } } } })
    await presentSlide(songItem(), 0, { goLive: true })
    expect(useBroadcastStore.getState().liveVerse?.footer).toBe("Amazing Grace · John Newton · CCLI 777")
  })

  it("refuses a song with no lyrics in the chosen language and leaves the output alone", async () => {
    await presentSlide(songItem(), 1, { goLive: true })
    const before = useBroadcastStore.getState().liveVerse
    expect(await presentSlide(songItem(["fr"]), 0, { goLive: true })).toBe("empty")
    expect(useBroadcastStore.getState().liveVerse).toBe(before)
    expect(useBroadcastStore.getState().presentWarning).toContain("no lyrics in FR")
    // Deleted song: same rule.
    expect(await presentSlide({ ...songItem(), song: { ...songItem().song, song_id: "gone" } }, 0, { goLive: true })).toBe("empty")
    expect(useBroadcastStore.getState().presentWarning).toContain("no longer in the library")
  })

  it("stays off air until the song arrives; Clear during loading wins", async () => {
    const d = deferred<SongWithSections>()
    mockInvoke.mockImplementation((cmd: string) => (cmd === "content_get_song" ? d.promise : Promise.resolve(null)))
    const p = presentSlide(songItem(), 0, { goLive: true })
    expect(useBroadcastStore.getState().isLive).toBe(false)
    presentActions.clear()
    d.resolve(amazing)
    expect(await p).toBe("superseded")
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
  })
})

describe("stepping through a song in the rundown", () => {
  it("Next steps slides, then moves to the next item; Previous enters a song at its last slide", async () => {
    useQueueStore.setState({ items: [verseItem(verse(19, 23, 1)), songItem(), verseItem(verse(43, 3, 16))] })
    presentActions.next() // verse 1
    await flush()
    presentActions.next() // song slide 0
    await flush()
    expect(useBroadcastStore.getState().liveSlide?.index).toBe(0)
    expect(useQueueStore.getState().activeIndex).toBe(1)
    presentActions.next()
    await flush()
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().liveSlide?.index).toBe(2)
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Amazing Grace · Verse 1")
    presentActions.next() // past the last slide → next item
    await flush()
    expect(useBroadcastStore.getState().liveSlide).toBeNull()
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book43 3:16")
    expect(useQueueStore.getState().activeIndex).toBe(2)
    presentActions.prev() // back into the song, at its last slide
    await flush()
    expect(useBroadcastStore.getState().liveSlide).toMatchObject({ index: 2, total: 3 })
    presentActions.prev()
    await flush()
    expect(useBroadcastStore.getState().liveSlide?.index).toBe(1)
    expect(useBroadcastStore.getState().isLive).toBe(true)
  })

  it("remote next/prev use the same slide semantics", async () => {
    useQueueStore.setState({ items: [songItem()] })
    remoteActions.queueNext()
    await flush()
    remoteActions.queueNext()
    await flush()
    expect(useBroadcastStore.getState().liveSlide?.index).toBe(1)
    remoteActions.queuePrev()
    await flush()
    expect(useBroadcastStore.getState().liveSlide?.index).toBe(0)
    remoteActions.queuePrev() // at the first slide of the first item: stays
    await flush()
    expect(useBroadcastStore.getState().liveSlide?.index).toBe(0)
  })

  it("Clear keeps the slide for Restore; Next after Clear advances, and only once the slide is ready", async () => {
    useQueueStore.setState({ items: [songItem()] })
    presentActions.next()
    await flush()
    presentActions.next()
    await flush()
    presentActions.clear()
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(presentActions.canRestore()).toBe(true)
    presentActions.restore()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveSlide?.index).toBe(1)
    presentActions.clear()
    presentActions.next()
    expect(useBroadcastStore.getState().isLive).toBe(false) // not before the slide is ready
    await flush()
    expect(useBroadcastStore.getState().isLive).toBe(true)
    expect(useBroadcastStore.getState().liveSlide?.index).toBe(2)
  })

  it("Show live presents the previewed slide and marks the item active", async () => {
    useQueueStore.setState({ items: [verseItem(verse(19, 23, 1)), songItem()] })
    presentActions.previewSlide(songItem(), 1)
    await flush()
    presentActions.showLive()
    await flush()
    const s = useBroadcastStore.getState()
    expect(s.isLive).toBe(true)
    expect(s.liveSlide).toMatchObject({ itemId: "item-song", index: 1 })
    expect(s.liveVerse?.reference).toBe("Amazing Grace · Chorus")
    expect(useQueueStore.getState().activeIndex).toBe(1)
    // Previewing a verse afterwards clears the slide, so Show live shows the verse.
    useBibleStore.getState().selectVerse(verse(19, 23, 1))
    expect(useBibleStore.getState().selectedSlide).toBeNull()
    presentActions.showLive()
    await flush()
    expect(useBroadcastStore.getState().liveSlide).toBeNull()
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("Book19 23:1")
  })

  it("previewItem on a song selects its first slide without touching the live output", async () => {
    presentActions.showLive() // nothing selected: no-op
    presentActions.previewItem(songItem())
    await flush()
    expect(useBibleStore.getState().selectedSlide).toMatchObject({ item: { id: "item-song" }, index: 0 })
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(useSongStore.getState().songs["song-1"]).toBeDefined()
  })
})
