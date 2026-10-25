import { describe, expect, it } from "vitest"
import { isChoir, songKindLabel, withChoir } from "./song-kind"
import type { SongQueueItem } from "@/types"

describe("choir ministrations", () => {
  it("are marked by the choir tag, other tags kept", () => {
    expect(isChoir("Choir, harvest")).toBe(true)
    expect(isChoir("harvest")).toBe(false)
    expect(withChoir("harvest", true)).toBe("choir, harvest")
    expect(withChoir("choir, harvest", false)).toBe("harvest")
    expect(withChoir("", true)).toBe("choir")
  })
})

describe("song identity labels (#388)", () => {
  it("labels a numbered service item as a hymn with its number", () => {
    const item = {
      kind: "song",
      song: { song_id: "cac-245", title: "Grace", arrangement_id: null, languages: ["en"], hymn_numbers: ["CAC 245"] },
    } as unknown as SongQueueItem

    expect(songKindLabel(item)).toBe("Hymn · CAC 245")
  })

  it("can label a legacy item from its loaded library numbers", () => {
    const item = {
      kind: "song",
      song: { song_id: "legacy", title: "Grace", arrangement_id: null, languages: ["en"] },
    } as SongQueueItem

    expect(songKindLabel(item, ["SSS 110"])).toBe("Hymn · SSS 110")
    expect(songKindLabel(item)).toBe("Song")
  })
})
