import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
const presented: Array<{ slide: unknown; songAs: unknown }> = []
vi.mock("@/lib/remote-actions", async (orig) => ({
  ...(await orig<typeof import("@/lib/remote-actions")>()),
  presentQueueItem: vi.fn(async (_i: number, slide: unknown, songAs: unknown) => { presented.push({ slide, songAs }) }),
}))

const { stepLiveSection } = await import("@/lib/desk-consoles")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")

const section = (id: string, kind: string, label: string, lines: string[]) => ({ id, kind, label, texts: { en: lines.join("\n") } })
const song = {
  song: { id: "s1", title: "Amazing Grace", authors: "John Newton", primary_language: "en", key: "G" },
  sections: [section("v1", "verse", "Verse 1", ["a", "b"]), section("c", "chorus", "Chorus", ["c", "d"]), section("v2", "verse", "Verse 2", ["e", "f"])],
  arrangements: [{ id: "arr", name: "Default", sequence: ["v1", "c", "v2", "c"], is_default: true }],
  numbers: [],
} as never

describe("desk section steps count the title slide (#411 songs hunt)", () => {
  it("Repeat chorus from Verse 2 lands on the chorus, not one slide early", async () => {
    useQueueStore.setState({ items: [{ id: "i1", kind: "song", song: { song_id: "s1", arrangement_id: "arr", languages: ["en"], title_slide: true }, reference: "Amazing Grace", confidence: 1, source: "manual", added_at: 0 } as never], activeIndex: 0 })
    // On screen: Title (0), Verse 1 (1), Chorus (2), Verse 2 (3), Chorus (4).
    useBroadcastStore.setState({ isLive: true, liveVerse: { kind: "lyric", reference: "", segments: [], content: "song" } as never, liveSlide: { itemId: "i1", songId: "s1", index: 3, total: 5, arrangementId: "arr", languages: ["en"], song, titleSlide: true } })
    expect(await stepLiveSection("chorus")).toBeNull()
    expect(presented.at(-1)?.slide).toBe(2)
    expect(presented.at(-1)?.songAs).toMatchObject({ title_slide: true })
  })
})
