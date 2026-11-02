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
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongStore } from "@/stores/song-store"
import type { AudioQueueItem, SlideQueueItem, SongQueueItem, SongWithSections, Verse, VerseQueueItem } from "@/types"
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
const welcomeSlide: SlideQueueItem = {
  id: "welcome-slide",
  kind: "slide",
  slide: { title: "Welcome", body: "Welcome to the service." },
  reference: "Welcome",
  confidence: 1,
  source: "manual",
  added_at: 2,
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
    secondaryTranslationId: null,
    overrideServiceTranslations: false,
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
  it("previews the selected congregation output in its configured language without changing Program", async () => {
    const baseOutput = useBroadcastStore.getState().outputs[0]!
    useBroadcastStore.setState({
      outputs: [
        { ...baseOutput, id: "english-output", name: "English screen", role: "congregation", language: "first" },
        { ...baseOutput, id: "yoruba-output", name: "Yoruba screen", role: "congregation", language: "second" },
        { ...baseOutput, id: "stage-output", name: "Stage monitor", role: "stage", language: "both" },
      ],
      isLive: true,
      liveVerse: { reference: "On air", segments: [{ text: "Program remains unchanged" }] },
    })
    useBibleStore.setState({ secondaryTranslationId: 2 })
    const yoruba = { ...verse, id: 2, translation_id: 2, text: "Nítorí Ọlọ́run fẹ́ aráyé" }
    vi.spyOn(bibleActions, "fetchVerse").mockImplementation(async (_book, _chapter, _verse, translationId) => translationId === 2 ? yoruba : verse)
    const program = useBroadcastStore.getState().liveVerse

    await act(async () => root!.render(<PreviewPanel outputLanguageId="english-output" onOutputLanguageIdChange={() => {}} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(canvasVerses.at(-1)).toMatchObject({ segments: [{ verseNumber: 16, text: verse.text }] })
    const outputPicker = document.body.querySelector<HTMLSelectElement>('[aria-label="Output for Preview and Scene Take"]')!
    expect([...outputPicker.options].map((option) => option.textContent)).toEqual([
      "English screen · First language",
      "Yoruba screen · Second language",
    ])

    await act(async () => root!.render(<PreviewPanel outputLanguageId="yoruba-output" onOutputLanguageIdChange={() => {}} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(bibleActions.fetchVerse).toHaveBeenCalledWith(43, 3, 16, 2)
    expect(canvasVerses.at(-1)).toMatchObject({ segments: [{ text: yoruba.text }] })
    expect(useBroadcastStore.getState().liveVerse).toEqual(program)
    expect(useBroadcastStore.getState().isLive).toBe(true)
  })

  it("keeps the available text and shows checking until a missing secondary translation is confirmed", async () => {
    const baseOutput = useBroadcastStore.getState().outputs[0]!
    useBroadcastStore.setState({ outputs: [{ ...baseOutput, id: "yoruba-output", name: "Yoruba screen", role: "congregation", language: "second" }] })
    useBibleStore.setState({ secondaryTranslationId: 2 })
    const request = deferred<Verse | null>()
    vi.spyOn(bibleActions, "fetchVerse").mockReturnValue(request.promise)
    const host = document.body.firstElementChild!

    await act(async () => root!.render(<PreviewPanel outputLanguageId="yoruba-output" onOutputLanguageIdChange={() => {}} />))
    await act(async () => Promise.resolve())

    expect(canvasVerses.at(-1)).toMatchObject({ segments: [{ verseNumber: 16, text: verse.text }] })
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Checking the selected output’s second language")
    expect(host.textContent).not.toContain("Second language unavailable")

    await act(async () => {
      request.resolve(null)
      await request.promise
    })

    expect(host.textContent).toContain("Second language unavailable")
  })

  it("falls back when the secondary lookup returns a verse with a different identity", async () => {
    const baseOutput = useBroadcastStore.getState().outputs[0]!
    useBroadcastStore.setState({ outputs: [{ ...baseOutput, id: "yoruba-output", name: "Yoruba screen", role: "congregation", language: "second" }] })
    useBibleStore.setState({ secondaryTranslationId: 2 })
    const request = deferred<Verse | null>()
    vi.spyOn(bibleActions, "fetchVerse").mockReturnValue(request.promise)
    const selectVerse = vi.spyOn(bibleActions, "selectVerse")
    const host = document.body.firstElementChild!

    await act(async () => root!.render(<PreviewPanel outputLanguageId="yoruba-output" onOutputLanguageIdChange={() => {}} />))
    await act(async () => Promise.resolve())
    expect(host.textContent).toContain("Checking the selected output’s second language")

    await act(async () => {
      request.resolve({ ...verse, book_number: 1, translation_id: 2, text: "A different verse" })
      await request.promise
    })

    expect(host.textContent).toContain("Second language unavailable")
    expect(host.textContent).not.toContain("Checking the selected output’s second language")
    expect(selectVerse).not.toHaveBeenCalled()
    expect(useBibleStore.getState().selectedVerse).toEqual(verse)
    expect(canvasVerses.at(-1)).toMatchObject({ segments: [{ verseNumber: 16, text: verse.text }] })
  })

  it("does not let a late secondary-language response replace a newly selected slide preview", async () => {
    const baseOutput = useBroadcastStore.getState().outputs[0]!
    useBroadcastStore.setState({ outputs: [{ ...baseOutput, id: "yoruba-output", name: "Yoruba screen", role: "congregation", language: "second" }] })
    useBibleStore.setState({ secondaryTranslationId: 2 })
    const request = deferred<Verse | null>()
    vi.spyOn(bibleActions, "fetchVerse").mockReturnValue(request.promise)

    await act(async () => root!.render(<PreviewPanel outputLanguageId="yoruba-output" onOutputLanguageIdChange={() => {}} />))
    await act(async () => Promise.resolve())
    expect(bibleActions.fetchVerse).toHaveBeenCalledWith(43, 3, 16, 2)

    await act(async () => presentActions.previewItem(welcomeSlide))
    await act(async () => {
      request.resolve({ ...verse, id: 2, translation_id: 2, text: "Late Yoruba" })
      await request.promise
    })

    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(welcomeSlide.id)
    expect(canvasVerses.at(-1)).toMatchObject({ reference: "Welcome", lines: ["Welcome to the service."] })
    expect(canvasVerses.at(-1)).not.toMatchObject({ segments: [{ text: "Late Yoruba" }] })
  })

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

  it("does not apply an older translation refresh after the active translation changes again", async () => {
    const secondTranslation = deferred<Verse | null>()
    const thirdTranslation = deferred<Verse | null>()
    vi.spyOn(bibleActions, "fetchVerse").mockImplementation((_book, _chapter, _verse, translationId) => translationId === 2 ? secondTranslation.promise : translationId === 3 ? thirdTranslation.promise : Promise.resolve(verse))
    useBibleStore.setState({ translations: [
      ...useBibleStore.getState().translations,
      { id: 3, title: "Third Version", abbreviation: "TV", language: "yo", is_copyrighted: false, is_downloaded: true },
    ] })

    await act(async () => root!.render(<PreviewPanel />))
    await act(async () => useBibleStore.getState().setActiveTranslation(2))
    await act(async () => {
      useBibleStore.getState().setActiveTranslation(3)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useBibleStore.getState().activeTranslationId).toBe(3)

    expect(bibleActions.fetchVerse).toHaveBeenCalledWith(43, 3, 16, 2)
    expect(bibleActions.fetchVerse).toHaveBeenCalledWith(43, 3, 16, 3)

    await act(async () => {
      secondTranslation.resolve({ ...verse, id: 2, translation_id: 2, text: "Older translation" })
      await secondTranslation.promise
    })
    expect(useBibleStore.getState().selectedVerse).toEqual(verse)

    await act(async () => {
      thirdTranslation.resolve({ ...verse, id: 3, translation_id: 3, text: "Current translation" })
      await thirdTranslation.promise
    })
    expect(useBibleStore.getState().selectedVerse).toMatchObject({ translation_id: 3, text: "Current translation" })
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
