import { describe, expect, it } from "vitest"
import { churchLanguageTags, inChurchOrder, setChurchLanguageOrder } from "@/lib/church-languages"
import { songQueueItem } from "@/lib/lyrics"
import type { SongSummary } from "@/types"

describe("the church's languages (#446)", () => {
  it("reads what Setup was told, in order, with or without accents", () => {
    expect(churchLanguageTags("English, Yorùbá")).toEqual(["en", "yo"])
    expect(churchLanguageTags("Yoruba and English")).toEqual(["yo", "en"])
    expect(churchLanguageTags("yo / en / yo")).toEqual(["yo", "en"])
    expect(churchLanguageTags("")).toEqual([])
    expect(churchLanguageTags("Klingon")).toEqual([])
  })

  it("puts the church's languages first, then the song's own primary", () => {
    expect(inChurchOrder("en", ["en", "yo"], ["yo", "en"])).toEqual(["yo", "en"])
    expect(inChurchOrder("yo", ["yo", "en", "ig"], ["en"])).toEqual(["en", "yo", "ig"])
    expect(inChurchOrder("yo", ["yo"], ["en"])).toEqual(["yo"])
    expect(inChurchOrder("en", ["en", "yo"], [])).toEqual(["en", "yo"])
  })

  it("a new song item follows the church's order", () => {
    const song = { id: "s", title: "Abide", primary_language: "en", languages: ["en", "yo"], numbers: [], tags: "" } as unknown as SongSummary
    setChurchLanguageOrder(["yo", "en"])
    expect(songQueueItem(song).song.languages).toEqual(["yo", "en"])
    setChurchLanguageOrder([])
    expect(songQueueItem(song).song.languages).toEqual(["en", "yo"])
  })
})
