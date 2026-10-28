// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fixtures = vi.hoisted(() => {
  const verse = {
    id: 1,
    translation_id: 1,
    book_number: 1,
    book_name: "Genesis",
    book_abbreviation: "Gen",
    chapter: 1,
    verse: 1,
    text: "In the beginning",
  }
  const meaningResult = {
    verse_ref: "Genesis 1:1",
    verse_text: verse.text,
    book_name: "Genesis",
    book_number: 1,
    chapter: 1,
    verse: 1,
    similarity: 0.91,
    sources: ["semantic"],
  }
  let deferChapter = false
  let pendingChapters: Array<(verses: unknown[]) => void> = []
  return {
    verse,
    meaningResult,
    book: { id: 1, translation_id: 1, book_number: 1, name: "Genesis", abbreviation: "Gen", testament: "OT" },
    translation: { id: 1, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true },
    loadChapter: () => deferChapter
      ? new Promise<unknown[]>((resolve) => pendingChapters.push(resolve))
      : Promise.resolve([verse]),
    deferNextChapter: () => { deferChapter = true },
    pendingChapterCount: () => pendingChapters.length,
    resolvePendingChapters: () => {
      const requests = pendingChapters
      pendingChapters = []
      deferChapter = false
      requests.forEach((resolve) => resolve([verse]))
    },
    resetChapterRequests: () => {
      deferChapter = false
      pendingChapters = []
    },
  }
})

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "list_translations") return [fixtures.translation]
    if (command === "list_books") return [fixtures.book]
    if (command === "get_chapter") return fixtures.loadChapter()
    if (command === "semantic_search") return [fixtures.meaningResult]
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))
vi.mock("@/components/ui/canvas-verse", () => ({ CanvasVerse: () => null }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SearchPanel } from "./search-panel"
import { PreviewPanel } from "./preview-panel"
import { LiveOutputPanel } from "./live-output-panel"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import type { VerseQueueItem } from "@/types"

let root: Root | null = null
let el: HTMLDivElement | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  fixtures.resetChapterRequests()
  Element.prototype.scrollIntoView ??= () => {}
  useBibleStore.setState({
    selectedVerse: null,
    selectedSlide: null,
    selectedQueueItemId: null,
    samplePreview: false,
    books: [],
    translations: [],
    currentChapter: [],
    pendingNavigation: null,
    semanticResults: [],
    activeTranslationId: 1,
  })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSlide: null, liveItemId: null, rehearsal: false })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null })
  useServiceStore.setState({ current: null, programs: [], dirty: false, saving: false })
  el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
  el = null
  document.body.replaceChildren()
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null, samplePreview: false })
})

describe("first-run Bible preview", () => {
  it("labels the default Genesis preview as a sample while Program remains empty", async () => {
    await act(async () => root!.render(<><SearchPanel /><PreviewPanel /><PreviewPanel compact /><LiveOutputPanel /></>))
    await vi.waitFor(() => expect(useBibleStore.getState().selectedVerse).toMatchObject({ book_number: 1, chapter: 1, verse: 1 }))

    const [preview, compactPreview] = el!.querySelectorAll<HTMLElement>('[data-slot="preview-panel"]')
    const program = el!.querySelector<HTMLElement>('[data-slot="live-output-panel"]')!
    expect(preview.textContent).toContain("Sample preview — no service selected")
    expect(preview.textContent).toContain("Only you see this")
    expect(compactPreview.textContent).toContain("Sample preview — no service selected")
    expect(compactPreview.textContent).toContain("Genesis 1:1")
    expect(useQueueStore.getState().items).toHaveLength(0)
    expect(program.textContent).toContain("Nothing on air")
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: false, liveVerse: null, liveItemId: null })
  })

  it("clears the sample label when the operator selects another verse", async () => {
    await act(async () => root!.render(<><SearchPanel /><PreviewPanel /><PreviewPanel compact /><LiveOutputPanel /></>))
    await vi.waitFor(() => expect(useBibleStore.getState().samplePreview).toBe(true))

    const otherVerse = { ...fixtures.verse, verse: 2, text: "And the earth was without form" }
    act(() => useBibleStore.getState().selectVerse(otherVerse))

    const [preview, compactPreview] = el!.querySelectorAll<HTMLElement>('[data-slot="preview-panel"]')
    expect(useBibleStore.getState().samplePreview).toBe(false)
    expect(useBibleStore.getState().selectedVerse).toMatchObject({ book_number: 1, chapter: 1, verse: 2 })
    expect(preview.textContent).not.toContain("Sample preview")
    expect(compactPreview.textContent).not.toContain("Sample preview")
    expect(compactPreview.textContent).toContain("Genesis 1:2")
    expect(useQueueStore.getState().items).toHaveLength(0)
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: false, liveVerse: null, liveItemId: null })
  })

  it("keeps an existing Preview selection when Bible data finishes loading", async () => {
    const selectedVerse = { ...fixtures.verse, verse: 9, text: "And God said" }
    useBibleStore.setState({ selectedVerse })

    await act(async () => root!.render(<><SearchPanel /><PreviewPanel /></>))
    await vi.waitFor(() => expect(useBibleStore.getState().books).toHaveLength(1))

    expect(useBibleStore.getState().selectedVerse).toBe(selectedVerse)
    expect(useBibleStore.getState().samplePreview).toBe(false)
    expect(useBibleStore.getState().pendingNavigation).toBe(null)
    expect(el!.querySelector('[data-slot="preview-panel"]')?.textContent).not.toContain("Sample preview")
  })

  it("abandons the sample if the operator selects a verse while the chapter is loading", async () => {
    fixtures.deferNextChapter()
    await act(async () => root!.render(<><SearchPanel /><PreviewPanel /></>))
    await vi.waitFor(() => expect(fixtures.pendingChapterCount()).toBeGreaterThan(0))

    const selectedVerse = { ...fixtures.verse, verse: 9, text: "And God said" }
    act(() => useBibleStore.getState().selectVerse(selectedVerse))
    await act(async () => fixtures.resolvePendingChapters())
    await vi.waitFor(() => expect(useBibleStore.getState().pendingNavigation).toBe(null))

    expect(useBibleStore.getState().selectedVerse).toBe(selectedVerse)
    expect(useBibleStore.getState().samplePreview).toBe(false)
    expect(el!.querySelector('[data-slot="preview-panel"]')?.textContent).not.toContain("Sample preview")
  })
})

describe("explicit repeated Scripture additions", () => {
  function existingReading(): VerseQueueItem {
    return {
      id: "opening-reading",
      verse: fixtures.verse,
      reference: "Genesis 1:1",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
  }

  async function renderLoadedChapter() {
    await act(async () => root!.render(<SearchPanel />))
    await vi.waitFor(() => expect(useBibleStore.getState().books).toHaveLength(1))
    await act(async () => useBibleStore.getState().setPendingNavigation({ bookNumber: 1, chapter: 1, verse: 1 }))
    await vi.waitFor(() => expect(el!.querySelector('[aria-label="Add another Genesis 1:1 to the service"]')).not.toBeNull())
  }

  it("keeps Add available for a verse already in the planned service", async () => {
    useQueueStore.setState({ items: [existingReading()] })
    await renderLoadedChapter()

    await vi.waitFor(() => expect(el!.querySelector('[aria-label="Add another Genesis 1:1 to the service"]')).not.toBeNull())
    const add = el!.querySelector<HTMLButtonElement>('[aria-label="Add another Genesis 1:1 to the service"]')!
    await act(async () => add.click())
    expect(useQueueStore.getState().items.map((item) => item.id)).toHaveLength(2)
  })

  it("keeps Add available for an already planned reference in Meaning results", async () => {
    useQueueStore.setState({ items: [existingReading()] })
    await renderLoadedChapter()
    await act(async () => el!.querySelector<HTMLButtonElement>('[data-tour="context-search"]')!.click())
    const input = await vi.waitFor(() => {
      const element = el!.querySelector<HTMLInputElement>('[aria-label="Search by meaning"]')
      expect(element).not.toBeNull()
      return element!
    })
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setValue.call(input, "beginning")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await vi.waitFor(() => expect(el!.querySelector('[aria-label="Add another Genesis 1:1 to the service"]')).not.toBeNull())
    const add = el!.querySelector<HTMLButtonElement>('[aria-label="Add another Genesis 1:1 to the service"]')!
    await act(async () => add.click())
    expect(useQueueStore.getState().items).toHaveLength(2)
  })
})
