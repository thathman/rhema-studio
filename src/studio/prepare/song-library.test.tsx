// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { CSS?: { escape: (value: string) => string } }).CSS ??= { escape: (value) => value }
})

const song = {
  id: "song-new",
  title: "A New Song",
  authors: "",
  licence: "unknown" as const,
  primary_language: "en",
  languages: ["en"],
  numbers: [],
  first_line: "First line",
  revision: 1,
  updated_at: "2026-10-25T00:00:00Z",
}

const hymn = {
  ...song,
  id: "cac-hymn",
  title: "CAC Hymn 245",
  numbers: ["CAC 245"],
  languages: ["en", "yo"],
}

const verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world",
}

const audioAsset = {
  id: "walk-in-audio",
  kind: "audio" as const,
  name: "Walk-in music",
  file: "walk-in.wav",
  hash: "hash",
  size: 100,
  mime: "audio/wav",
  width: null,
  height: null,
  duration_ms: null,
  source: "import",
  source_ref: "",
  original_path: "",
  created_at: "2026-10-25T00:00:00Z",
  path: "/media/walk-in.wav",
  present: true,
}

const currentProgram = { id: "current", title: "This Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 }
const previousProgram = { id: "previous", title: "Last Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 }
const previousService = {
  program: previousProgram,
  items: [{
    id: "old-slide",
    program_id: previousProgram.id,
    position: 0,
    kind: "slide",
    reference: "Welcome",
    book_number: null,
    chapter: null,
    verse: null,
    translation: null,
    secondary_translation: null,
    notes: null,
    payload: JSON.stringify({ title: "Welcome", body: "Welcome to church" }),
  }],
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: { tag?: string; withTag?: boolean }) => {
    if (command === "content_list_songs") return args?.tag === "cacghb" && args.withTag ? [hymn] : [song]
    if (command === "content_list_hymnbooks") return []
    if (command === "media_list") return [audioAsset]
    if (command === "content_get_program") return previousService
    if (command === "search_verses") return [verse]
    return null
  }),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useAddDialog } from "@/studio/prepare/add-target"
import { useServiceStore } from "@/stores/service-store"
import type { QueueItem } from "@/types"
import { SongLibrary } from "./song-library"
import { AddItems } from "./add-items"

const slide = (id: string): QueueItem => ({
  id,
  kind: "slide",
  slide: { title: id, body: "words" },
  reference: id,
  confidence: 1,
  source: "manual",
  added_at: 0,
})

function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useQueueStore.setState({
    items: [slide("first-a"), slide("phase-item"), slide("first-b")],
    headers: [
      { id: "first", type: "phase", name: "First phase", at: 0 },
      { id: "later", type: "phase", name: "Later phase", at: 2 },
    ],
    activeIndex: null,
    addTarget: "later",
  })
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("SongLibrary Add to a selected phase (#384)", () => {
  it("keeps earlier phase items in place when adding to a later phase", async () => {
    await act(async () => root!.render(<SongLibrary />))
    const add = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add")
    expect(add).toBeTruthy()
    await act(async () => add!.click())

    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual([
      "first-a",
      "phase-item",
      "first-b",
      expect.any(String),
    ])
    expect(useQueueStore.getState().items.at(-1)).toMatchObject({ kind: "song", song: { song_id: song.id } })
  })
})

describe("Add item workflow (#386)", () => {
  it("closes after a successful Add and selects the inserted queue item by ID", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useAddDialog.setState({ open: false })

    await act(async () => root!.render(<AddItems />))
    const trigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add item"))!
    await act(async () => trigger.click())
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()

    const songsTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent?.trim() === "Songs")!
    await act(async () => {
      songsTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
      songsTab.click()
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.body.textContent).toContain(song.title)
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add")!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted).toMatchObject({ kind: "song", song: { song_id: song.id } })
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger), { timeout: 1000 })
  })

  it("closes after a successful Bible Add and selects that passage by ID", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useAddDialog.setState({ open: false })

    await act(async () => root!.render(<AddItems />))
    const trigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add item"))!
    await act(async () => trigger.click())
    const example = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "the Lord is my shepherd")!
    await act(async () => example.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)) })
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add")!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted).toMatchObject({ verse: { book_number: verse.book_number, chapter: verse.chapter, verse: verse.verse } })
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger), { timeout: 1000 })
  })

  it("closes after a successful Hymn Add and selects that service item", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useAddDialog.setState({ open: false })

    await act(async () => root!.render(<AddItems />))
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add item"))!.click())
    const hymnsTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent?.trim() === "Hymn book")!
    await act(async () => { hymnsTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); hymnsTab.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const add = document.querySelector<HTMLButtonElement>('button[aria-label="Add hymn 245 to the service"]')!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted).toMatchObject({ kind: "song", song: { song_id: hymn.id } })
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("closes after a successful slide Add and selects the inserted slide", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useAddDialog.setState({ open: false })

    await act(async () => root!.render(<AddItems />))
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add item"))!.click())
    const slidesTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent?.trim() === "Slides")!
    await act(async () => { slidesTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); slidesTab.click() })
    const title = document.querySelector<HTMLInputElement>('input[aria-label="Slide title"]')!
    await act(async () => fill(title, "Welcome"))
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add to service")!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted).toMatchObject({ kind: "slide", slide: { title: "Welcome" } })
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("closes after a successful media Add and selects the inserted asset", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useAddDialog.setState({ open: false })

    await act(async () => root!.render(<AddItems />))
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add item"))!.click())
    const mediaTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent?.trim() === "Pictures")!
    await act(async () => { mediaTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); mediaTab.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add")!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted).toMatchObject({ kind: "image", image: { media_id: audioAsset.id } })
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("closes after reusing selected items and selects the last inserted copy", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useAddDialog.setState({ open: false })
    useServiceStore.setState({ programs: [currentProgram, previousProgram], current: currentProgram })

    await act(async () => root!.render(<AddItems />))
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add item"))!.click())
    const reuseTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent?.trim() === "Reuse")!
    await act(async () => { reuseTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); reuseTab.click() })
    const previous = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Last Sunday"))!
    await act(async () => previous.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => checkbox.click())
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add 1 to this service"))!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted).toMatchObject({ kind: "slide", slide: { title: "Welcome" } })
    expect(inserted.id).not.toBe("old-slide")
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("leaves the picker open when a Bible Add is deduped", async () => {
    const existing: QueueItem = {
      id: "existing-verse",
      kind: "verse",
      verse,
      reference: "John 3:16",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    useQueueStore.setState({ items: [existing], headers: [], activeIndex: null, addTarget: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useAddDialog.setState({ open: false })

    await act(async () => root!.render(<AddItems />))
    const trigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add item"))!
    await act(async () => trigger.click())
    const example = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "the Lord is my shepherd")!
    await act(async () => example.click())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)) })
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add")!
    await act(async () => add.click())

    expect(useQueueStore.getState().items).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  })
})
