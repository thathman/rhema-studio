// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { parseOpenLyrics, toOpenLyrics } from "./openlyrics"
import type { SongWithSections } from "@/types"

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.8" createdIn="OpenLP 3.0">
  <properties>
    <titles><title>Amazing Grace</title><title lang="yo">Oore-ọ̀fẹ́ Ìyanu</title></titles>
    <authors><author>John Newton</author><author type="translation">Anon</author></authors>
    <copyright>Public Domain</copyright>
    <ccliNo>22025</ccliNo>
    <songbooks><songbook name="SSS" entry="245"/><songbook name="Unknown Book" entry="9"/></songbooks>
    <verseOrder>v1 c v2 c x9</verseOrder>
    <tempo type="bpm">90</tempo>
    <comments><comment>Sing slowly</comment></comments>
  </properties>
  <lyrics>
    <verse name="v1" lang="en"><lines>Amazing <chord name="G"/>grace, how sweet the sound<br/>that saved a wretch like me</lines><lines>I once was lost</lines></verse>
    <verse name="v1" lang="yo"><lines>Oore-ọ̀fẹ́ ìyanu<br/>ohùn dídùn</lines></verse>
    <verse name="c"><lines>Praise God<br/>praise God</lines></verse>
    <verse name="v2" lang="en"><lines>'Twas grace that taught</lines></verse>
  </lyrics>
</song>`

describe("OpenLyrics import", () => {
  it("maps titles, authors, numbers, verses per language, slide hints and verse order", () => {
    const { input, report } = parseOpenLyrics(sample, { SSS: "book-sss" })
    expect(input.title).toBe("Amazing Grace")
    expect(input.authors).toBe("John Newton; Anon")
    expect(input.ccli_number).toBe("22025")
    expect(input.licence).toBe("ccli")
    expect(input.copyright).toBe("Public Domain")
    expect(input.primary_language).toBe("en")
    expect(input.notes).toBe("Sing slowly")
    expect(input.sections.map((s) => s.kind)).toEqual(["verse", "chorus", "verse"])
    expect(input.sections[0].texts.en).toBe("Amazing grace, how sweet the sound\nthat saved a wretch like me\n\nI once was lost")
    expect(input.sections[0].texts.yo).toBe("Oore-ọ̀fẹ́ ìyanu\nohùn dídùn")
    expect(input.sections[1].texts.en).toBe("Praise God\npraise God")
    expect(input.arrangements).toEqual([{ name: "Default", sequence: ["#0", "#1", "#2", "#1"], is_default: true }])
    expect(input.numbers).toEqual([{ hymnbook_id: "book-sss", number: "245" }])
    expect(report.ignored).toEqual([
      "verseOrder names not in the song: x9",
      'songbook "Unknown Book" 9 (no hymnbook with that name or code here)',
      "<tempo>",
    ])
  })

  it("rejects files that are not OpenLyrics", () => {
    expect(() => parseOpenLyrics("<html><body>hi</body></html>")).toThrow(/OpenLyrics/)
    expect(() => parseOpenLyrics("not xml at all <")).toThrow()
  })

  it("defaults: no verseOrder → no arrangement (crate generates one), unknown licence without CCLI", () => {
    const { input } = parseOpenLyrics(`<song xmlns="http://openlyrics.info/namespace/2009/song"><properties><titles><title>X</title></titles></properties><lyrics><verse name="v1"><lines>a</lines></verse></lyrics></song>`)
    expect(input.arrangements).toEqual([])
    expect(input.licence).toBe("unknown")
    expect(input.sections[0].texts).toEqual({ en: "a" })
  })

  it("exports a song that imports back unchanged", () => {
    const song: SongWithSections = {
      song: { id: "s", title: "Amazing Grace", authors: "John Newton; Anon", copyright: "Public Domain", ccli_number: "22025", licence: "ccli", licence_note: "", primary_language: "en", tags: "", notes: "Sing slowly", key: "G", tempo: 72, revision: 1, created_at: "", updated_at: "" },
      sections: [
        { id: "v1", kind: "verse", label: "Verse 1", texts: { en: "Amazing grace, how sweet\n\nI once was lost", yo: "Oore-ọ̀fẹ́ <ìyanu>" } },
        { id: "c", kind: "chorus", label: "Chorus", texts: { en: "Praise God" } },
      ],
      arrangements: [{ id: "a", name: "Default", sequence: ["v1", "c", "v1"], is_default: true }],
      numbers: [{ hymnbook_id: "b", hymnbook_code: "SSS", number: "245" }],
    }
    const xml = toOpenLyrics(song)
    expect(xml).toContain('<verse name="v1" lang="yo">')
    expect(xml).toContain("&lt;ìyanu&gt;")
    const { input, report } = parseOpenLyrics(xml, { SSS: "b" })
    expect(report.ignored).toEqual([])
    expect(input.title).toBe("Amazing Grace")
    expect(input.authors).toBe("John Newton; Anon")
    expect(input.sections[0].texts).toEqual({ en: "Amazing grace, how sweet\n\nI once was lost", yo: "Oore-ọ̀fẹ́ <ìyanu>" })
    expect(input.arrangements).toEqual([{ name: "Default", sequence: ["#0", "#1", "#0"], is_default: true }])
    expect(input.numbers).toEqual([{ hymnbook_id: "b", number: "245" }])
    expect(input.notes).toBe("Sing slowly")
  })
})
