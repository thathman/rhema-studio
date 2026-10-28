import { describe, expect, it } from "vitest"
import type { QueueItem } from "@/types"
import { currentSong } from "./backing-tracks"

const song = (id: string) => ({ id, kind: "song", song: { song_id: `s-${id}`, title: id, arrangement_id: null, languages: ["en"] }, reference: id }) as unknown as QueueItem
const verse = (id: string) => ({ id, reference: id, verse: {} }) as unknown as QueueItem

describe("backing track for the current song (FR-06)", () => {
  it("prefers the song on air, then the rundown item the operator is on; nothing for other items", () => {
    const items = [song("a"), verse("v"), song("b")]
    expect(currentSong(items, "b", 0)?.id).toBe("b")
    expect(currentSong(items, "v", 0)?.id).toBe("a")
    expect(currentSong(items, null, 2)?.id).toBe("b")
    expect(currentSong(items, "v", 1)).toBeNull()
    expect(currentSong(items, null, null)).toBeNull()
  })
})
