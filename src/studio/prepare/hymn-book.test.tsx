// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { CSS?: { escape: (value: string) => string } }).CSS ??= { escape: (value) => value }
})

const { hymn, fullSong } = vi.hoisted(() => {
  const hymn = {
    id: "cac-245",
    title: "Grace Greater Than Our Sin",
    authors: "Julia H. Johnston",
    licence: "public_domain" as const,
    primary_language: "en",
    languages: ["en", "yo"],
    numbers: ["CAC 245"],
    first_line: "Marvelous grace of our loving Lord",
    revision: 1,
    updated_at: "2026-10-25T00:00:00Z",
  }
  const fullSong = {
    song: {
      id: hymn.id,
      title: hymn.title,
      alternate_titles: ["Oore to po"],
      authors: hymn.authors,
      copyright: "",
      ccli_number: null,
      licence: hymn.licence,
      licence_note: "",
      primary_language: "en",
      tags: "cacghb",
      notes: "",
      key: "",
      tempo: null,
      revision: 1,
      created_at: "2026-10-25T00:00:00Z",
      updated_at: "2026-10-25T00:00:00Z",
    },
    sections: [
      { id: "verse-1", kind: "verse", label: "Verse 1", texts: { en: "Marvelous grace of our loving Lord", yo: "Ore iyanu Oluwa wa" } },
      { id: "chorus", kind: "chorus", label: "Chorus", texts: { en: "Grace that exceeds our sin", yo: "Ore to po ju ese wa lo" } },
    ],
    arrangements: [{ id: "default", name: "Default", sequence: ["verse-1", "chorus"], is_default: true }],
    numbers: [{ hymnbook_id: "cac", hymnbook_code: "CAC", number: "245" }],
  }
  return { hymn, fullSong }
})

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "content_list_songs") return [hymn]
    if (command === "content_get_song") return fullSong
    if (command === "content_list_hymnbooks") return []
    if (command === "content_list_song_attachments") return []
    return null
  }),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useSongStore } from "@/stores/song-store"
import { HymnBook } from "./hymn-book"

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
  useSettingsStore.getState().setHymnFirstLanguage("en")
  useSongStore.setState({ songs: {}, missing: [], results: [], query: "", searching: false, error: null })
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("Hymn Book details (#385)", () => {
  it("selecting a hymn opens its full, ordered bilingual details", async () => {
    await act(async () => root!.render(<HymnBook />))
    const preview = document.querySelector<HTMLButtonElement>('button[title="Select to preview and view details"]')
    expect(preview).toBeTruthy()

    await act(async () => preview!.click())

    expect(await document.querySelector('[aria-label="Hymn details"]')).toBeTruthy()
    expect(document.body.textContent).toContain("CAC Main 245")
    expect(document.body.textContent).toContain("Marvelous grace of our loving Lord")
    expect(document.body.textContent).toContain("Ore iyanu Oluwa wa")
    expect(document.body.textContent).toContain("Default")
    expect(document.querySelector('button[aria-label="Edit library hymn Grace Greater Than Our Sin"]')).toBeTruthy()
  })

  it("opens the shared song editor with CAC number and bilingual sections intact", async () => {
    await act(async () => root!.render(<HymnBook />))
    await act(async () => document.querySelector<HTMLButtonElement>('button[title="Select to preview and view details"]')!.click())
    const edit = document.querySelector<HTMLButtonElement>('button[aria-label="Edit library hymn Grace Greater Than Our Sin"]')!
    await act(async () => edit.click())

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Edit song")
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Hymn number"]')?.value).toBe("245")
    expect(document.querySelector('[aria-label="Verse 1 in English"]')).toBeTruthy()
    expect(document.querySelector('[aria-label="Verse 1 in Yorùbá"]')).toBeTruthy()
  })

  it("reports the inserted hymn ID so Prepare can select the in-service copy", async () => {
    const onAdded = vi.fn()
    await act(async () => root!.render(<HymnBook onAdded={onAdded} />))
    const yorubaFirst = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Yorùbá")!
    await act(async () => yorubaFirst.click())
    const add = document.querySelector<HTMLButtonElement>('button[aria-label="Add hymn 245 to the service"]')
    expect(add).toBeTruthy()
    await act(async () => add!.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted).toMatchObject({ kind: "song", song: { song_id: hymn.id, languages: ["yo", "en"] } })
    expect((inserted as unknown as { song: { hymn_numbers?: string[] } }).song.hymn_numbers).toEqual(["CAC 245"])
    expect(onAdded).toHaveBeenCalledWith(inserted.id)
  })
})
