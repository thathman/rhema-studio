// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { canvasVerses } = vi.hoisted(() => ({ canvasVerses: [] as unknown[] }))
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

vi.mock("@/components/ui/canvas-verse", () => ({ CanvasVerse: ({ verse }: { verse: unknown }) => { canvasVerses.push(verse); return null } }))
vi.mock("@/components/ui/panel-header", () => ({ PanelHeader: ({ children }: { children: unknown }) => children }))
vi.mock("@/studio/prepare/item-plan", () => ({ ItemPlan: () => null }))
vi.mock("@/hooks/use-preview-label", () => ({ usePreviewLabel: () => null }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { bibleActions } from "@/hooks/use-bible"
import { presentActions } from "@/studio/present-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongStore } from "@/stores/song-store"
import type { AudioQueueItem, SongQueueItem, SongWithSections, Verse, VerseQueueItem } from "@/types"
import { PreviewPanel } from "./preview-panel"
import { useMediaStore } from "@/stores/media-store"

const verse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world",
}

const opening: VerseQueueItem = {
  id: "opening-reading",
  kind: "verse",
  verse,
  reference: "John 3:16",
  confidence: 1,
  source: "manual",
  added_at: 0,
}

const hymn: SongQueueItem = {
  id: "new-hymn",
  kind: "song",
  song: { song_id: "hymn", title: "New Hymn", arrangement_id: null, languages: ["en"] },
  reference: "New Hymn",
  confidence: 1,
  source: "manual",
  added_at: 1,
}

const hymnDetails: SongWithSections = {
  song: {
    id: "hymn",
    title: "New Hymn",
    authors: "",
    copyright: "",
    ccli_number: null,
    licence: "unknown",
    licence_note: "",
    primary_language: "en",
    tags: "",
    notes: "",
    key: "",
    tempo: null,
    revision: 1,
    created_at: "",
    updated_at: "",
  },
  sections: [],
  arrangements: [],
  numbers: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  canvasVerses.length = 0
  useQueueStore.setState({ items: [opening, hymn], headers: [], activeIndex: null })
  useBibleStore.setState({
    selectedVerse: verse,
    selectedSlide: null,
    selectedQueueItemId: opening.id,
    activeTranslationId: 1,
    translations: [
      { id: 1, title: "King James Version", abbreviation: "KJV", language: "en", is_copyrighted: false, is_downloaded: true },
      { id: 2, title: "Second Version", abbreviation: "SV", language: "en", is_copyrighted: false, is_downloaded: true },
    ],
  })
  useSongStore.setState({ songs: { [hymnDetails.song.id]: hymnDetails } })
  useMediaStore.setState({ assets: [], urls: {}, loaded: true, loading: false, error: null })
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("Preview translation refresh", () => {
  it("does not let an old verse refresh replace a newly selected service item", async () => {
    const request = deferred<Verse | null>()
    vi.spyOn(bibleActions, "fetchVerse").mockReturnValue(request.promise)

    await act(async () => root!.render(<PreviewPanel />))
    await act(async () => useBibleStore.getState().setActiveTranslation(2))
    expect(bibleActions.fetchVerse).toHaveBeenCalled()

    await act(async () => presentActions.previewItem(hymn))
    expect(useBibleStore.getState().selectedQueueItemId).toBe(hymn.id)

    await act(async () => {
      request.resolve({ ...verse, id: 2, translation_id: 2, text: "Fresh translation" })
      await request.promise
    })

    expect(useBibleStore.getState().selectedQueueItemId).toBe(hymn.id)
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(hymn.id)
  })

  it("shows local-only audio in Preview and names a missing file", async () => {
    const audio: AudioQueueItem = {
      id: "walk-in",
      kind: "audio",
      audio: { media_id: "walkin", name: "Walk-in" },
      reference: "Walk-in",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    useQueueStore.setState({ items: [audio], activeIndex: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: { item: audio, index: 0 }, selectedQueueItemId: audio.id })

    await act(async () => root!.render(<PreviewPanel />))

    expect(canvasVerses.at(-1)).toMatchObject({ lines: [
      "♪ Walk-in",
      'Audio file “Walk-in” is missing from this computer\'s media library.',
      "Congregation and OBS screens stay unchanged",
    ] })
  })

  it("does not imply audio is missing when the local media catalog could not be checked", async () => {
    const audio: AudioQueueItem = {
      id: "walk-in",
      kind: "audio",
      audio: { media_id: "walkin", name: "Walk-in" },
      reference: "Walk-in",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    useQueueStore.setState({ items: [audio], activeIndex: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: { item: audio, index: 0 }, selectedQueueItemId: audio.id })
    useMediaStore.setState({ assets: [], loaded: true, loading: false, error: "Local media folder is unavailable" })

    await act(async () => root!.render(<PreviewPanel />))

    expect(canvasVerses.at(-1)).toMatchObject({ lines: [
      "♪ Walk-in",
      "The local media library couldn't be checked: Local media folder is unavailable",
      "Congregation and OBS screens stay unchanged",
    ] })
    expect(canvasVerses.at(-1)).not.toMatchObject({ lines: expect.arrayContaining([expect.stringContaining("is missing from")]) })
  })
})
