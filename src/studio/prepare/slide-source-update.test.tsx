// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The host's reusable slides: the whole library, whatever the Library's own search shows.
const hostSlides = vi.hoisted(() => ({ list: [] as unknown[], calls: 0 }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => {
  if (cmd !== "content_list_reusable_slides") return null
  hostSlides.calls += 1
  return hostSlides.list
}) }))
import type { ReusableSlide, SlideQueueItem } from "@/types"
import { useQueueStore } from "@/stores/queue-store"
import { copyAtSourceRevision } from "@/studio/library/slide-items"
import { CustomSlideEditor } from "./item-editor-parts"

const source = (revision: number, over: Partial<ReusableSlide> = {}): ReusableSlide => ({
  id: "src-1", kind: "announcement", title: "Harvest", body: "Sunday 10am\nBring a friend", link: null, background_media_id: null,
  revision, created_at: "", updated_at: "", ...over,
})
const copy: SlideQueueItem = {
  id: "i1", kind: "slide", reference: "Harvest", confidence: 1, source: "manual", added_at: 1, notes: "Read slowly",
  slide: { title: "Harvest", body: "Sunday 9am", link: "https://old.example", source_asset_id: "src-1", source_revision: 2 },
  background: { media_id: "m-old", name: "Old" },
} as SlideQueueItem

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
})

describe("a service copy of a reusable slide (#395)", () => {
  it("brings the copy to the source's version, keeping this moment's own notes", () => {
    const next = copyAtSourceRevision(copy, source(3, { background_media_id: "m-new" }), [{ id: "m-new", name: "Gold" }])
    expect(next.slide).toEqual({ title: "Harvest", body: "Sunday 10am\nBring a friend", source_asset_id: "src-1", source_revision: 3 })
    expect(next.background).toEqual({ media_id: "m-new", name: "Gold" })
    expect(next).toMatchObject({ id: "i1", notes: "Read slowly", added_at: 1 })
    expect(copyAtSourceRevision(copy, source(3), []).background).toBeUndefined()
  })

  it("says when the source is newer and updates only on request", async () => {
    useQueueStore.setState({ items: [copy] })
    hostSlides.list = [source(3)]
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<CustomSlideEditor item={copy} />))
    expect(el.textContent).toContain("The reusable source was changed since this copy was made (version 3; this copy is 2)")
    expect(useQueueStore.getState().items[0]).toBe(copy)
    const update = [...el.querySelectorAll("button")].find((b) => b.textContent === "Update this copy")!
    await act(async () => update.click())
    const updated = useQueueStore.getState().items[0] as SlideQueueItem
    expect(updated.slide).toMatchObject({ body: "Sunday 10am\nBring a friend", source_revision: 3 })
    await act(async () => root.render(<CustomSlideEditor item={updated} />))
    expect(el.textContent).not.toContain("was changed since")
    act(() => root.unmount())
  })

  it("says nothing when the copy is current", async () => {
    hostSlides.list = [source(2)]
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<CustomSlideEditor item={copy} />))
    expect(el.textContent).not.toContain("was changed since")
    // An empty library (the source was deleted) asks once, not again and again.
    hostSlides.list = []
    hostSlides.calls = 0
    await act(async () => root.render(<CustomSlideEditor item={{ ...copy, id: "i2" }} />))
    await act(async () => new Promise<void>((r) => setTimeout(r, 50)))
    expect(hostSlides.calls).toBeLessThanOrEqual(1)
    expect(el.textContent).not.toContain("was changed since")
    act(() => root.unmount())
  })
})
