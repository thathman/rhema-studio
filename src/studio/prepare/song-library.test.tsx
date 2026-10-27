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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => command === "content_list_songs" ? [song] : null),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useQueueStore } from "@/stores/queue-store"
import type { QueueItem } from "@/types"
import { SongLibrary } from "./song-library"

const slide = (id: string): QueueItem => ({
  id,
  kind: "slide",
  slide: { title: id, body: "words" },
  reference: id,
  confidence: 1,
  source: "manual",
  added_at: 0,
})

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
