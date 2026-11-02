import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/song-request", () => ({ findSongByTitle: vi.fn(async (t: string) => (t === "Amazing Grace" ? song("amazing", "Amazing Grace") : null)) }))

import { songQueueItem } from "@/lib/lyrics"
import { applyWorshipSet } from "@/lib/worship-set"
import { useQueueStore } from "@/stores/queue-store"
import type { SongSummary } from "@/types"

function song(id: string, title: string): SongSummary {
  return { id, title, authors: "", licence: "public_domain" as never, primary_language: "en", languages: ["en"], numbers: [], first_line: "", revision: 1, updated_at: "" }
}

const titles = () => useQueueStore.getState().items.map((i) => ("song" in i ? i.song.title : "?") + ((i as { hidden?: boolean }).hidden ? " (hidden)" : ""))

beforeEach(() => {
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, highlightedId: null, addTarget: null })
  for (const [id, t] of [["c", "Three"], ["b", "Two"], ["a", "One"]] as const) useQueueStore.getState().addItem(songQueueItem(song(id, t), id))
})

describe("a Worship desk's change to today's song order (remote:worship_set)", () => {
  it("moves a song before another, or to the end of the set", async () => {
    expect(titles()).toEqual(["One", "Two", "Three"])
    expect(await applyWorshipSet({ op: "move", item: "c", before: "a" })).toBeNull()
    expect(titles()).toEqual(["Three", "One", "Two"])
    expect(await applyWorshipSet({ op: "move", item: "c" })).toBeNull()
    expect(titles()).toEqual(["One", "Two", "Three"])
  })

  it("leaves a song out today without removing it, and sings one again right after itself", async () => {
    expect(await applyWorshipSet({ op: "skip", item: "b" })).toBeNull()
    expect(titles()).toEqual(["One", "Two (hidden)", "Three"])
    expect(await applyWorshipSet({ op: "repeat", item: "a" })).toBeNull()
    expect(titles()).toEqual(["One", "One", "Two (hidden)", "Three"])
  })

  it("adds a library song where asked, and says why when it cannot", async () => {
    expect(await applyWorshipSet({ op: "insert", item: "a", song: "Amazing Grace", before: "b" })).toBeNull()
    expect(titles()).toEqual(["One", "Amazing Grace", "Two", "Three"])
    expect(await applyWorshipSet({ op: "insert", item: "a", song: "Unknown" })).toBe("that song is not in the library")
    expect(await applyWorshipSet({ op: "move", item: "gone" })).toBe("that song is no longer in the service")
    expect(await applyWorshipSet({ op: "move", item: "a", before: "gone" })).toBe("that place in the song order is gone")
    expect(titles()).toEqual(["One", "Amazing Grace", "Two", "Three"])
  })
})
