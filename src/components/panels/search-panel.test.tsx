// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} })) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SearchPanel } from "./search-panel"
import { useBibleStore, useQueueStore } from "@/stores"
import type { Book, Translation, Verse, VerseQueueItem } from "@/types"
import type { SemanticSearchResult } from "@/types/detection"

const genesis: Book = { id: 1, translation_id: 1, book_number: 1, name: "Genesis", abbreviation: "Gen", testament: "OT" }
const translations: Translation[] = [{ id: 1, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true }]
const firstVerse: Verse = { id: 101, translation_id: 1, book_number: 1, book_name: "Genesis", book_abbreviation: "Gen", chapter: 1, verse: 1, text: "In the beginning God created the heaven and the earth." }

let root: Root
let host: HTMLDivElement

async function render() {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<SearchPanel />)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= (() => {}) as typeof Element.prototype.scrollIntoView
  document.body.replaceChildren()
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "list_translations") return translations
    if (command === "list_books") return [genesis]
    if (command === "get_chapter") return [firstVerse]
    return null
  })
  useBibleStore.setState({
    translations,
    books: [genesis],
    activeTranslationId: 1,
    selectedVerse: null,
    selectedSlide: null,
    selectedQueueItemId: null,
    currentChapter: [firstVerse],
    pendingNavigation: null,
    semanticResults: [],
  })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe("SearchPanel explicit Scripture additions", () => {
  it("keeps Add available for a verse already in the planned service", async () => {
    const existing: VerseQueueItem = {
      id: "opening-reading",
      verse: firstVerse,
      reference: "Genesis 1:1",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    useQueueStore.setState({ items: [existing] })

    await render()

    const add = host.querySelector<HTMLButtonElement>('[aria-label="Add another Genesis 1:1 to the service"]')
    expect(add).not.toBeNull()
    await act(async () => add!.click())
    expect(useQueueStore.getState().items.map((item) => item.id)).toHaveLength(2)
  })

  it("keeps Add available for an already planned reference in Meaning results", async () => {
    const existing: VerseQueueItem = {
      id: "opening-reading",
      verse: firstVerse,
      reference: "Genesis 1:1",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    const result: SemanticSearchResult = {
      verse_ref: "Genesis 1:1",
      verse_text: firstVerse.text,
      book_name: "Genesis",
      book_number: 1,
      chapter: 1,
      verse: 1,
      similarity: 0.91,
      sources: ["semantic"],
    }
    useQueueStore.setState({ items: [existing] })
    useBibleStore.setState({ semanticResults: [result] })

    await render()
    const meaningTab = host.querySelector<HTMLButtonElement>('[data-tour="context-search"]')!
    await act(async () => meaningTab.click())

    const add = host.querySelector<HTMLButtonElement>('[aria-label="Add another Genesis 1:1 to the service"]')
    expect(add).not.toBeNull()
    await act(async () => add!.click())
    expect(useQueueStore.getState().items).toHaveLength(2)
  })
})
