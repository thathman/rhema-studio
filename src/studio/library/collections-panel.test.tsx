// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args), convertFileSrc: (p: string) => p }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { CollectionsPanel } from "@/studio/library/collections-panel"
import { useSongStore } from "@/stores/song-store"
import { useMediaStore } from "@/stores/media-store"
import { useSlideStore } from "@/stores/slide-store"
import type { Collection, CollectionSummary } from "@/studio/library/collections"

const grace = { id: "song-grace", title: "Amazing Grace", authors: "", licence: "unknown" as const, primary_language: "en", languages: ["en"], numbers: [], first_line: "Amazing grace", revision: 1, updated_at: "" }
let collections: Collection[] = []
let root: Root | null = null

const summary = (c: Collection): CollectionSummary => ({ ...c.summary, item_count: c.items.length })

beforeEach(() => {
  collections = []
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const find = () => collections.find((c) => c.summary.id === args.id)!
    switch (command) {
      case "content_list_collections": return collections.map(summary)
      case "content_get_collection": return collections.find((c) => c.summary.id === args.id) ?? null
      case "content_create_collection": {
        const c: Collection = { summary: { id: `c${collections.length + 1}`, name: String(args.name), item_count: 0, created_at: "", updated_at: "" }, items: [] }
        collections.push(c)
        return c.summary
      }
      case "content_delete_collection": collections = collections.filter((c) => c.summary.id !== args.id); return null
      case "content_add_to_collection": {
        const c = find()
        c.items.push({ kind: args.kind as "song", item_id: String(args.itemId), title: "Amazing Grace", detail: "song", position: c.items.length })
        return c
      }
      case "content_remove_from_collection": {
        const c = find()
        c.items = c.items.filter((i) => i.item_id !== args.itemId)
        return c
      }
      case "content_list_reusable_slides": return []
      case "media_list": return []
      default: throw new Error(`Unexpected ${command}`)
    }
  })
  useSongStore.setState({ all: async () => [grace] })
  useMediaStore.setState({ assets: [], loaded: true, loading: false })
  useSlideStore.setState({ slides: [] })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label)!
async function type(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("Library → Collections (#853 G9)", () => {
  it("makes a collection, adds a song, uses it in the service, and takes it out without touching the library", async () => {
    const onUseItem = vi.fn()
    await act(async () => { root!.render(<CollectionsPanel onUseItem={onUseItem} />); await tick() })
    expect(document.body.textContent).toContain("No collections yet")

    await type("New collection name", "Christmas")
    await act(async () => { button("Make").click(); await tick(); await tick() })
    expect(mockInvoke).toHaveBeenCalledWith("content_create_collection", { name: "Christmas" })
    expect(document.body.textContent).toContain("Empty. Add songs, slides, pictures or designs below.")

    await act(async () => { await tick() })
    await act(async () => { button("Add Amazing Grace to Christmas").click(); await tick() })
    expect(mockInvoke).toHaveBeenCalledWith("content_add_to_collection", { id: "c1", kind: "song", itemId: "song-grace" })
    expect(document.querySelector('[aria-label="Items in Christmas"]')?.textContent).toContain("Amazing Grace")

    await act(async () => { button("Use").click(); await tick() })
    expect(onUseItem).toHaveBeenCalledWith(expect.objectContaining({ kind: "song", song: expect.objectContaining({ song_id: "song-grace" }) }), expect.anything())

    await act(async () => { button("Take Amazing Grace out of Christmas").click(); await tick() })
    expect(mockInvoke).toHaveBeenCalledWith("content_remove_from_collection", { id: "c1", kind: "song", itemId: "song-grace" })
    expect(mockInvoke.mock.calls.some(([command]) => command === "content_delete_song")).toBe(false)
  })

  it("asks before removing a collection", async () => {
    collections = [{ summary: { id: "c1", name: "Easter", item_count: 0, created_at: "", updated_at: "" }, items: [] }]
    await act(async () => { root!.render(<CollectionsPanel />); await tick() })
    await act(async () => button("Remove collection Easter").click())
    expect(mockInvoke).not.toHaveBeenCalledWith("content_delete_collection", expect.anything())
    await act(async () => { button("Remove").click(); await tick() })
    expect(mockInvoke).toHaveBeenCalledWith("content_delete_collection", { id: "c1" })
  })

  it("a failed list reads as Could not load, with Try again (#832 S8)", async () => {
    let fail = true
    const ok = mockInvoke.getMockImplementation()!
    mockInvoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "content_list_collections" && fail) throw { kind: "unavailable", message: "Content database is not available" }
      return ok(command, args)
    })
    await act(async () => { root!.render(<CollectionsPanel />); await tick() })
    expect(document.body.textContent).toContain("Could not load collections")
    expect(document.body.textContent).not.toContain("No collections yet")
    fail = false
    await act(async () => { button("Try again").click(); await tick() })
    expect(document.body.textContent).toContain("No collections yet")
  })
})
