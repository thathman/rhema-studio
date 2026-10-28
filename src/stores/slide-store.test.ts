import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReusableSlide } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))

import { useSlideStore } from "./slide-store"
import { useQueueStore } from "./queue-store"

const source: ReusableSlide = { id: "source-1", kind: "announcement", title: "Youth meeting", body: "Friday at six", link: null, background_media_id: null, revision: 3, created_at: "", updated_at: "" }

beforeEach(() => {
  mockInvoke.mockReset()
  useSlideStore.setState({ slides: [], loading: false, error: null, query: "", pendingSourceId: null })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
})

describe("reusable slide source store", () => {
  it("lists and searches reusable sources through the local content database", async () => {
    mockInvoke.mockResolvedValue([source])
    expect(await useSlideStore.getState().list("youth")).toEqual([source])
    expect(mockInvoke).toHaveBeenCalledWith("content_list_reusable_slides", { query: "youth", limit: 5000 })
    expect(useSlideStore.getState().error).toBeNull()
  })

  it("keeps a database failure visible and recoverable", async () => {
    mockInvoke.mockRejectedValueOnce({ kind: "unavailable", message: "Content database is not available" })
    await expect(useSlideStore.getState().list()).rejects.toMatchObject({ message: "Content database is not available" })
    expect(useSlideStore.getState().error).toBe("Content database is not available")
    mockInvoke.mockResolvedValueOnce([source])
    await useSlideStore.getState().list()
    expect(useSlideStore.getState().error).toBeNull()
  })

  it("refuses removing a source still used by the service on screen", async () => {
    useQueueStore.setState({ items: [{ id: "occurrence", kind: "slide", slide: { title: source.title, body: source.body, source_asset_id: source.id, source_revision: source.revision }, reference: source.title, confidence: 1, source: "manual", added_at: 0 }] })
    await expect(useSlideStore.getState().remove(source.id, source.revision)).rejects.toMatchObject({ kind: "in_use" })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("passes source revision on updates and uses optimistic delete revisions", async () => {
    const updated = { ...source, title: "Youth night", revision: 4 }
    mockInvoke.mockResolvedValueOnce(updated).mockResolvedValueOnce(null)
    await useSlideStore.getState().update(source.id, source.revision, { kind: source.kind, title: updated.title, body: source.body, link: null, background_media_id: null })
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "content_update_reusable_slide", expect.objectContaining({ id: source.id, expectedRevision: 3 }))
    await useSlideStore.getState().remove(source.id, updated.revision)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "content_delete_reusable_slide", { id: source.id, expectedRevision: 4 })
  })
})
