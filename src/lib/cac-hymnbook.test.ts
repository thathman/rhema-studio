import { describe, expect, it } from "vitest"
import { cacHymnbookFromJson, cacNumber, pairSections, CAC_TAG } from "./cac-hymnbook"

const v = (label: string, ...lines: string[]) => ({ label, lines })

describe("pairSections", () => {
  it("pairs by label, not position: an English chorus with no Yorùbá one stays English only", () => {
    const s = pairSections([v("1", "Verse one"), v("chorus", "Chorus"), v("2", "Verse two")], [v("1", "Ẹsẹ kinni"), v("2", "Ẹsẹ keji")])
    expect(s.map((x) => [x.kind, x.texts.en ?? null, x.texts.yo ?? null])).toEqual([
      ["verse", "Verse one", "Ẹsẹ kinni"],
      ["chorus", "Chorus", null],
      ["verse", "Verse two", "Ẹsẹ keji"],
    ])
  })
  it("pairs repeated choruses in turn, places a Yorùbá-only verse after its neighbour, keeps an unlabelled opening", () => {
    const s = pairSections([v("", "Opening"), v("chorus", "C1"), v("1", "V1"), v("chorus", "C2")], [v("", "Ibẹrẹ"), v("chorus", "Ègbè1"), v("1", "Ẹ1"), v("2", "Ẹ2"), v("chorus", "Ègbè2")])
    expect(s.map((x) => `${x.kind}:${x.texts.en ?? "-"}/${x.texts.yo ?? "-"}`)).toEqual(["other:Opening/Ibẹrẹ", "chorus:C1/Ègbè1", "verse:V1/Ẹ1", "verse:-/Ẹ2", "chorus:C2/Ègbè2"])
  })
})

describe("cacHymnbookFromJson", () => {
  const hymn = (number: number, series: string, en = "Great shepherd") => ({
    id: number, number, series,
    english: { title: en, tune: "ST. STEPHEN C.M.", category: "Morning", verses: [v("1", "Great shepherd of thy people hear,", "Thy presence now display,")] },
    yoruba: { title: "Olus'agutan eni Re", verses: [v("1", "Olus'agutan eni Re", "Fi ara Re han wa,")] },
  })
  it("splits the two parts into their own books, tagged and numbered", () => {
    const { parts, skipped } = cacHymnbookFromJson([hymn(1, "main"), hymn(2, "main", "O God of Bethel"), hymn(1, "V", "O bless our homes")])
    expect(skipped).toBe(0)
    expect(parts.map((p) => [p.book.code, p.songs.map((s) => s.number)])).toEqual([["CAC", ["1", "2"]], ["CACV", ["1"]]])
    const song = parts[0].songs[0].song
    expect(song).toMatchObject({ title: "Great shepherd", primary_language: "yo", tags: CAC_TAG, licence: "custom", licence_note: "CAC Gospel Hymn Book 1" })
    expect(parts[1].songs[0].song.licence_note).toBe("CAC Gospel Hymn Book V1")
    expect(song.notes).toContain("Yorùbá: Olus'agutan eni Re")
    expect(song.sections[0].texts).toEqual({ en: "Great shepherd of thy people hear,\nThy presence now display,", yo: "Olus'agutan eni Re\nFi ara Re han wa," })
  })
  it("skips what it cannot use and refuses a file that is not the hymn book", () => {
    const { parts, skipped } = cacHymnbookFromJson([hymn(1, "main"), hymn(1, "main"), { number: 3, series: "X" }, { series: "main" }, null])
    expect(parts[0].songs.length).toBe(1)
    expect(skipped).toBe(4)
    expect(() => cacHymnbookFromJson({ hymns: [] })).toThrow(/not the hymn book/)
  })
})

describe("cacNumber", () => {
  it("reads the part from the book code", () => {
    expect(cacNumber({ numbers: ["CAC 245"] })).toEqual({ part: 1, number: 245 })
    expect(cacNumber({ numbers: ["SSS 12", "CACV 3"] })).toEqual({ part: 2, number: 3 })
    expect(cacNumber({ numbers: ["SSS 12"] })).toBeNull()
  })
})
