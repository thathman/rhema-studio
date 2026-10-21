import { beforeEach, describe, expect, it, vi } from "vitest"

const presentSlide = vi.fn(async () => "presented")
const presentVerse = vi.fn(async () => "presented")
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@/hooks/use-broadcast", () => ({
  presentSlide: (...a: unknown[]) => presentSlide(...(a as [])),
  presentVerse: (...a: unknown[]) => presentVerse(...(a as [])),
  presentCustomSlide: vi.fn(async () => "presented"),
  presentImage: vi.fn(async () => "presented"),
  cancelPendingPresents: vi.fn(),
}))

import { remoteActions } from "./remote-actions"
import { followTranslationOnAir } from "@/hooks/use-live-translation-follow"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongStore } from "@/stores/song-store"
import type { QueueItem, SongWithSections, Verse } from "@/types"

const songItem = { id: "s1", kind: "song", song: { song_id: "song-1", title: "Amazing Grace", arrangement_id: "long", languages: ["en"] }, reference: "Amazing Grace", confidence: 1, source: "manual", added_at: 0 } as unknown as QueueItem
const verseItem = { id: "v1", verse: { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "t" }, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0 } as unknown as QueueItem
const verse: Verse = { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "t" }

describe("live stepping and following (audit fixes)", () => {
  beforeEach(() => {
    presentSlide.mockClear()
    presentVerse.mockClear()
    useQueueStore.setState({ items: [songItem, verseItem], activeIndex: 0 })
    useSongStore.setState({ songs: { "song-1": {} as SongWithSections } })
    useBroadcastStore.setState({
      isLive: true,
      rehearsal: false,
      liveVerse: { kind: "slide", reference: "Amazing Grace", segments: [], lines: ["x"] } as never,
      liveSlide: { itemId: "s1", songId: "song-1", index: 1, total: 4, arrangementId: "short", languages: ["en"] },
    })
  })

  it("steps within the live song in the arrangement it went live with, not one changed since", async () => {
    remoteActions.queueNext()
    await vi.waitFor(() => expect(presentSlide).toHaveBeenCalled())
    const [item, index] = presentSlide.mock.calls[0] as unknown as [{ song: { arrangement_id: string } }, number]
    expect(item.song.arrangement_id).toBe("short")
    expect(index).toBe(2)
  })

  it("a live song deleted from the library: Next moves on to the next item", async () => {
    useSongStore.setState({ songs: {} })
    remoteActions.queueNext()
    await vi.waitFor(() => expect(presentVerse).toHaveBeenCalled())
    expect(presentSlide).not.toHaveBeenCalled()
  })

  it("a translation change by speech moves the screen only when Auto is on; the operator's always does", () => {
    useBroadcastStore.setState({ liveSourceVerse: verse, liveItem: null, liveItemId: null, autoLive: false })
    followTranslationOnAir(true)
    expect(presentVerse).not.toHaveBeenCalled()
    followTranslationOnAir(false)
    expect(presentVerse).toHaveBeenCalledTimes(1)
    useBroadcastStore.setState({ autoLive: true })
    followTranslationOnAir(true)
    expect(presentVerse).toHaveBeenCalledTimes(2)
    // Follows never move the preview or cancel a present still loading.
    expect((presentVerse.mock.calls[0] as unknown as [unknown, { follow?: boolean }])[1].follow).toBe(true)
  })
})
