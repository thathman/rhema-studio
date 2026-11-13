import { describe, expect, it } from "vitest"
import { inChurchOrder, setChurchFirstLanguage } from "@/lib/church-languages"
import { songQueueItem } from "@/lib/lyrics"
import type { SongSummary } from "@/types"

describe("the church's first language (#446)", () => {
  it("comes first when the song has it, then the song's own primary", () => {
    expect(inChurchOrder("en", ["en", "yo"], "yo")).toEqual(["yo", "en"])
    expect(inChurchOrder("yo", ["yo", "en", "ig"], "en")).toEqual(["en", "yo", "ig"])
    expect(inChurchOrder("yo", ["yo"], "en")).toEqual(["yo"])
    expect(inChurchOrder("en", ["en", "yo"], null)).toEqual(["en", "yo"])
  })

  it("a new song item follows the church's setting, as hymns do", () => {
    const song = { id: "s", title: "Abide", primary_language: "en", languages: ["en", "yo"], numbers: [], tags: "" } as unknown as SongSummary
    setChurchFirstLanguage("yo")
    expect(songQueueItem(song).song.languages).toEqual(["yo", "en"])
    setChurchFirstLanguage(null)
    expect(songQueueItem(song).song.languages).toEqual(["en", "yo"])
  })
})
