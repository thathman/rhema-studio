import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SongWithSections } from "@/types"

const song = (revision: number, words: string): SongWithSections =>
  ({ song: { id: "s1", title: "Grace", authors: "", primary_language: "en", revision }, sections: [{ id: "v1", kind: "verse", label: "Verse 1", texts: { en: words } }], arrangements: [] }) as unknown as SongWithSections

const invoke = vi.fn(async (cmd: string) => (cmd === "content_approved_songs" ? [song(1, "Approved words")] : cmd === "content_get_song" ? song(2, "Edited words") : null))
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invoke(cmd) }))

const { loadSongPins, pinnedSong, serviceSongNow, useSongPins } = await import("./song-pins-store")
const { useSongStore } = await import("./song-store")

describe("the approved service's songs (#193)", () => {
  beforeEach(async () => {
    useSongStore.setState({ songs: {} })
    await useSongStore.getState().load("s1")
  })

  it("a service never approved has no pins: Present uses the library", async () => {
    await loadSongPins({ id: "p", approved_revision: null })
    expect(pinnedSong("s1")).toBeUndefined()
    expect(serviceSongNow("s1")?.song.revision).toBe(2)
  })

  it("an approved one keeps its approved words, unless the operator chooses the new ones", async () => {
    await loadSongPins({ id: "p", approved_revision: 3 })
    expect(serviceSongNow("s1")?.sections[0].texts.en).toBe("Approved words")
    useSongPins.getState().setLatest("s1", true)
    expect(serviceSongNow("s1")?.sections[0].texts.en).toBe("Edited words")
    // Approved again (or another service): the choice does not carry over.
    await loadSongPins({ id: "p", approved_revision: 4 })
    expect(useSongPins.getState().latest).toEqual([])
    await loadSongPins({ id: "q", approved_revision: null })
    expect(useSongPins.getState().pins).toEqual({})
  })
})
