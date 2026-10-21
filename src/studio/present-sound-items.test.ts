import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ImageQueueItem, SlideQueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null), convertFileSrc: (p: string) => `asset://${p}` }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))

import { presentActions } from "./present-actions"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMediaStore } from "@/stores/media-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSoundStore } from "@/stores/sound-store"

const flush = () => new Promise((r) => setTimeout(r, 0))
const slide = (id: string, title: string): SlideQueueItem => ({ id, kind: "slide", slide: { title, body: "" }, reference: title, confidence: 1, source: "manual", added_at: 0 })
const sound = (id: string, media_id: string, name: string): ImageQueueItem => ({ id, kind: "image", image: { media_id, name, fit: "cover" }, reference: name, confidence: 1, source: "manual", added_at: 0 })
const asset = (id: string, present = true) => ({ id, kind: "audio", name: id, present, path: `/m/${id}.mp3`, hash: id, size: 1, mime: "audio/mpeg", width: null, height: null, duration_ms: null, created_at: "" })

const played: string[] = []
beforeEach(() => {
  played.length = 0
  useMediaStore.setState({ assets: [asset("walkin"), asset("gone", false)] as never, loaded: true })
  useSoundStore.setState({ assetId: null, playing: false, play: async ({ id }: { id: string }) => { played.push(id); useSoundStore.setState({ assetId: id, playing: true }) } } as never)
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, presentWarning: null, rehearsal: false })
  useQueueStore.setState({ items: [slide("s1", "Welcome"), sound("a1", "walkin", "Walk-in"), slide("s2", "Announcements"), sound("a2", "gone", "Old track")], activeIndex: null })
})

describe("sound items in the service (MD-002)", () => {
  it("play when reached, leave the screens alone, and Next carries on after them", async () => {
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Welcome")
    presentActions.next()
    await flush()
    expect(played).toEqual(["walkin"])
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Welcome")
    expect(useQueueStore.getState().activeIndex).toBe(1)
    presentActions.next()
    await flush()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Announcements")
    expect(useSoundStore.getState().assetId).toBe("walkin")
  })

  it("does not restart a sound already playing, reports a missing file, and stays silent in rehearsal", async () => {
    useQueueStore.getState().setActive(0)
    presentActions.next()
    await flush()
    presentActions.prev()
    await flush()
    presentActions.next()
    await flush()
    expect(played).toEqual(["walkin"])

    useQueueStore.getState().setActive(2)
    presentActions.next()
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
})
