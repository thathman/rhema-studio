import { describe, expect, it } from "vitest"
import { editDistance, fold, fuzzyScore, fuzzySongs } from "./fuzzy"
import type { SongSummary } from "@/types"

const song = (title: string, first_line = "", authors = ""): SongSummary => ({
  id: title, title, authors, licence: "unknown", primary_language: "en", languages: ["en"], numbers: [], first_line, revision: 1, updated_at: "",
})

describe("typo-tolerant song search", () => {
  it("folds Yoruba marks and measures edits", () => {
    expect(fold("Ọlọ́run Ṣe")).toBe("olorun se")
    expect(editDistance("amazing", "amzaing")).toBe(2)
    expect(editDistance("grace", "grace")).toBe(0)
    expect(editDistance("abc", "abcdefgh", 2)).toBe(3)
  })

  it("forgives a typo per word and prefixes, and refuses unrelated words", () => {
    const songs = [song("Amazing Grace", "Amazing grace how sweet the sound", "John Newton"), song("Blessed Assurance"), song("Ọlọ́run mi")]
    expect(fuzzySongs("amzing grce", songs).map((s) => s.title)).toEqual(["Amazing Grace"])
    expect(fuzzySongs("blesed asurance", songs).map((s) => s.title)).toEqual(["Blessed Assurance"])
    expect(fuzzySongs("olorun", songs).map((s) => s.title)).toEqual(["Ọlọ́run mi"])
    expect(fuzzySongs("newton", songs).map((s) => s.title)).toEqual(["Amazing Grace"])
    expect(fuzzySongs("xylophone", songs)).toEqual([])
    expect(fuzzyScore("", songs[0])).toBeNull()
    // Exact beats near: both match "bless", the exact one scores lower.
    const ranked = fuzzySongs("bless", [song("Blessing"), song("Blessed Assurance"), song("Bliss")])
    expect(ranked.map((s) => s.title)).toEqual(["Blessed Assurance", "Blessing", "Bliss"])
  })
})
