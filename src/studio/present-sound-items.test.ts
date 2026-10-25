import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ImageQueueItem, SlideQueueItem, Verse, VerseQueueItem } from "@/types"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a), convertFileSrc: (p: string) => `asset://${p}` }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))

import { presentActions } from "./present-actions"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMediaStore } from "@/stores/media-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSoundStore } from "@/stores/sound-store"
import { presentQueueItem } from "@/lib/remote-actions"

const flush = () => new Promise((r) => setTimeout(r, 0))
const slide = (id: string, title: string): SlideQueueItem => ({ id, kind: "slide", slide: { title, body: "" }, reference: title, confidence: 1, source: "manual", added_at: 0 })
const sound = (id: string, media_id: string, name: string): ImageQueueItem => ({ id, kind: "image", image: { media_id, name, fit: "cover" }, reference: name, confidence: 1, source: "manual", added_at: 0 })
const asset = (id: string, present = true) => ({ id, kind: "audio", name: id, present, path: `/m/${id}.mp3`, hash: id, size: 1, mime: "audio/mpeg", width: null, height: null, duration_ms: null, created_at: "" })

const played: string[] = []
beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue(null)
  played.length = 0
  useMediaStore.setState({ assets: [asset("walkin"), asset("gone", false)] as never, loaded: true })
  useSoundStore.setState({ assetId: null, playing: false, play: async ({ id }: { id: string }) => { played.push(id); useSoundStore.setState({ assetId: id, playing: true }); return true } } as never)
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, presentWarning: null, rehearsal: false })
  useQueueStore.setState({ items: [slide("s1", "Welcome"), sound("a1", "walkin", "Walk-in"), slide("s2", "Announcements"), sound("a2", "gone", "Old track")], activeIndex: null })
})

describe("sound items in the service (MD-002)", () => {
  it("play when reached, leave the screens alone, and Next carries on after them", async () => {
    await presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Welcome")
    await presentActions.next()
    await flush()
    expect(played).toEqual(["walkin"])
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Welcome")
    expect(useQueueStore.getState().activeIndex).toBe(1)
    await presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Announcements")
    expect(useSoundStore.getState().assetId).toBe("walkin")
  })

  it("does not restart a sound already playing, reports a missing file, and stays silent in rehearsal", async () => {
    useQueueStore.getState().setActive(0)
    await presentActions.next()
    await flush()
    await presentActions.prev()
    await flush()
    await presentActions.next()
    await flush()
    expect(played).toEqual(["walkin"])

    useQueueStore.getState().setActive(2)
    await presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().presentWarning).toContain("missing")

    useSoundStore.setState({ assetId: null, playing: false })
    useBroadcastStore.setState({ rehearsal: true, presentWarning: null })
    useQueueStore.getState().setActive(0)
    presentActions.next()
    await flush()
    expect(played).toEqual(["walkin"])
    expect(useBroadcastStore.getState().presentWarning).toContain("Rehearsal")
  })

  it("Previous steps over a sound item, and a sound item does not cancel a verse still loading", async () => {
    useQueueStore.getState().setActive(2)
    presentActions.prev()
    await flush()
    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(played).toEqual([])

    let resolve!: (v: Verse) => void
    mockInvoke.mockImplementation((cmd: string) => (cmd === "get_verse" ? new Promise<Verse>((r) => { resolve = r }) : Promise.resolve(null)))
    const v: Verse = { id: 0, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "", chapter: 3, verse: 16, text: "For God so loved" }
    const verseItem: VerseQueueItem = { id: "v1", verse: v, reference: "John 3:16", confidence: 1, source: "manual", added_at: 0 }
    useQueueStore.setState({ items: [verseItem, sound("a1", "walkin", "Walk-in")], activeIndex: null })
    const verseTake = presentActions.next()
    await flush()
    expect(useQueueStore.getState().activeIndex).toBeNull()
    await presentQueueItem(1)
    expect(played).toEqual(["walkin"])
    expect(useQueueStore.getState().activeIndex).toBe(1)
    resolve(v)
    await verseTake
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("3:16")
    expect(useQueueStore.getState().activeIndex).toBe(0)
  })

  it("does not let late audio playback move the rundown back after a later visual Take", async () => {
    let startPlayback!: () => void
    useSoundStore.setState({
      assetId: null,
      playing: false,
      play: () => new Promise<boolean>((resolve) => {
        startPlayback = () => {
          useSoundStore.setState({ assetId: "walkin", playing: true })
          resolve(true)
        }
      }),
    } as never)
    useQueueStore.setState({
      items: [slide("s1", "Welcome"), sound("a1", "walkin", "Walk-in"), slide("s2", "Announcements")],
      activeIndex: 0,
    })

    const audioTake = presentQueueItem(1)
    expect(useQueueStore.getState().activeIndex).toBe(0)

    await presentQueueItem(2)
    expect(useQueueStore.getState().activeIndex).toBe(2)
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Announcements")

    startPlayback()
    await audioTake
    expect(useQueueStore.getState().activeIndex).toBe(2)
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Announcements")
  })
})
