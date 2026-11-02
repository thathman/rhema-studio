// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { invoke: mockInvoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: Record<string, unknown>) => mockInvoke(command, args) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { isVerseItem, type Translation, type Verse, type VerseQueueItem } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { VerseTranslationControls } from "./verse-translation-controls"

const translations: Translation[] = [
  { id: 1, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true },
  { id: 7, abbreviation: "OYCB", title: "Open Yoruba Contemporary Bible", language: "yo", is_copyrighted: false, is_downloaded: true },
  { id: 12, abbreviation: "NOT-INSTALLED", title: "Not installed", language: "en", is_copyrighted: false, is_downloaded: false },
]

const verse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "English test fixture",
}

const item: VerseQueueItem = {
  id: "verse-1",
  reference: "John 3:16",
  verse,
  translation: "KJV",
  secondary_translation: null,
  confidence: 1,
  source: "manual",
  added_at: 0,
}

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mockInvoke.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command !== "get_verse" || args?.translationId !== 7) return null
    return { ...verse, id: 7, translation_id: 7, text: "Yoruba test fixture" }
  })
  useBibleStore.setState({ translations, activeTranslationId: 1, secondaryTranslationId: 7 })
  useQueueStore.setState({ items: [item], headers: [], activeIndex: null })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(<VerseTranslationControls item={item} />))
  return host
}

async function setSelect(host: HTMLElement, label: string, value: string) {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("Prepare Scripture translation controls", () => {
  it("changes this moment's primary text and secondary pin without changing service defaults", async () => {
    const host = await render()

    await setSelect(host, "Primary translation", "OYCB")
    expect(mockInvoke).toHaveBeenCalledWith("get_verse", {
      translationId: 7,
      bookNumber: 43,
      chapter: 3,
      verse: 16,
    })
    expect(useQueueStore.getState().items[0]).toMatchObject({
      id: "verse-1",
      reference: "John 3:16",
      translation: "OYCB",
      verse: { translation_id: 7, text: "Yoruba test fixture" },
    })

    await setSelect(host, "Secondary translation", "KJV")
    expect(useQueueStore.getState().items[0]).toMatchObject({ secondary_translation: "KJV" })
    expect(useBibleStore.getState()).toMatchObject({ activeTranslationId: 1, secondaryTranslationId: 7 })
    expect(host.querySelector('option[value="NOT-INSTALLED"]')).toBeNull()
  })

  it("keeps the current pin and text when the requested edition has no verse", async () => {
    mockInvoke.mockResolvedValue(null)
    const host = await render()

    await setSelect(host, "Primary translation", "OYCB")

    expect(useQueueStore.getState().items[0]).toMatchObject({
      translation: "KJV",
      verse: { translation_id: 1, text: "English test fixture" },
    })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("left unchanged")
  })

  it("does not overwrite newer moment content when a translation lookup is still pending", async () => {
    let finishLookup!: (value: Verse | null) => void
    mockInvoke.mockReturnValue(new Promise<Verse | null>((resolve) => { finishLookup = resolve }))
    const host = await render()

    await setSelect(host, "Primary translation", "OYCB")
    useQueueStore.getState().updateItem(item.id, (current) => isVerseItem(current)
      ? { ...current, verse: { ...current.verse, text: "Newer operator content" } }
      : current)
    expect(useQueueStore.getState().items[0]).toMatchObject({ verse: { text: "Newer operator content" } })
    await act(async () => finishLookup({ ...verse, id: 7, translation_id: 7, text: "Yoruba test fixture" }))

    expect(useQueueStore.getState().items[0]).toMatchObject({
      translation: "KJV",
      verse: { translation_id: 1, text: "Newer operator content" },
    })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("changed while the edition was loading")
  })
})
