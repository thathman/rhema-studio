import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { handleVerseDetections } from "./use-detection-events"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import type { DetectionResult, VerseQueueItem } from "@/types"
import type { Program } from "@/types/content"

const heard = (verse: number): DetectionResult =>
  ({ verse_ref: `John 3:${verse}`, book_number: 43, book_name: "John", chapter: 3, verse, verse_text: "text", confidence: 0.95, source: "direct", auto_queued: true, is_chapter_only: false }) as unknown as DetectionResult
const item = (id: string, verse: number) =>
  ({ id, verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse, text: "t" }, reference: `John 3:${verse}`, confidence: 1, source: "manual", added_at: 0 }) as VerseQueueItem

describe("heard verses and the rundown", () => {
  beforeEach(() => {
    useBroadcastStore.setState({ autoLive: false })
    useQueueStore.setState({ items: [item("a", 1), item("b", 16), item("c", 17)], activeIndex: 2 })
  })

  it("with a service open: neither moves Next nor writes into the service; a matching item only flashes", () => {
    useServiceStore.setState({ current: { id: "p1", title: "Sunday", revision: 1 } as unknown as Program })
    handleVerseDetections([heard(16), heard(30)])
    const q = useQueueStore.getState()
    expect(q.items.map((i) => i.id)).toEqual(["a", "b", "c"])
    expect(q.activeIndex).toBe(2)
    expect(q.highlightedId).toBe("b")
  })

  it("without a service: the original detection queue still adds and points at heard verses", () => {
    useServiceStore.setState({ current: null })
    handleVerseDetections([heard(30)])
    expect(useQueueStore.getState().items).toHaveLength(4)
  })
})
