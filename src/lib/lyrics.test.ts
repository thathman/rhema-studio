import { describe, expect, it } from "vitest"
import { buildSlides, copyrightFooter, matchHeading, parsePastedLyrics, splitBody, splitEvenly, toLyricRenderData } from "./lyrics"
import type { SongWithSections } from "@/types"

function song(overrides: Partial<SongWithSections> = {}): SongWithSections {
  return {
    song: {
      id: "s1", title: "Amazing Grace", authors: "John Newton", copyright: "", ccli_number: null, licence: "public_domain",
      licence_note: "", primary_language: "en", tags: "", notes: "", key: "", tempo: null, revision: 1, created_at: "", updated_at: "",
    },
    sections: [
      { id: "v1", kind: "verse", label: "Verse 1", texts: { en: "Amazing grace\nhow sweet the sound", yo: "Oore-ọ̀fẹ́ ìyanu\nohùn dídùn" } },
      { id: "c", kind: "chorus", label: "Chorus", texts: { en: "Praise God\npraise God\npraise God" } },
      { id: "v2", kind: "verse", label: "Verse 2", texts: { yo: "Ẹsẹ kejì" } },
    ],
    arrangements: [{ id: "a1", name: "Default", sequence: ["v1", "c", "v2", "c"], is_default: true }],
    numbers: [],
    ...overrides,
  }
}

describe("paste parser", () => {
  it("splits on blank lines and recognises English and Yoruba headings", () => {
    const text = `Amazing grace, how sweet the sound\nthat saved a wretch like me\n\nChorus\nPraise God\n\nVerse 2\n'Twas grace that taught\n\nẸgbẹ́ orin\nYìn Ọlọ́run\n\nBridge:\nla la`
    const sections = parsePastedLyrics(text)
    expect(sections.map((s) => s.kind)).toEqual(["verse", "chorus", "verse", "chorus", "bridge"])
    expect(sections[0].texts.en).toBe("Amazing grace, how sweet the sound\nthat saved a wretch like me")
    expect(sections[3].texts.en).toBe("Yìn Ọlọ́run")
  })

  it("parses Windows line endings and a heading with no following blank line", () => {
    const sections = parsePastedLyrics("Verse 1\r\nline a\r\nline b\r\nChorus\r\nchorus line\r\n", "yo")
    expect(sections).toEqual([
      { kind: "verse", texts: { yo: "line a\nline b" } },
      { kind: "chorus", texts: { yo: "chorus line" } },
    ])
  })

  it("treats a long line as lyrics, not a heading", () => {
    expect(matchHeading("Chorus")).toBe("chorus")
    expect(matchHeading("chorus 2:")).toBe("chorus")
    expect(matchHeading("Verse")).toBe("verse")
    expect(matchHeading("Chorus of angels sang that night")).toBeNull()
    expect(parsePastedLyrics("")).toEqual([])
  })
})

describe("slide splitting", () => {
  it("splits on blank-line hints then evenly over the limit", () => {
    expect(splitBody("a\nb\n\nc\nd")).toEqual([["a", "b"], ["c", "d"]])
    expect(splitBody("1\n2\n3\n4\n5\n6\n7\n8", 6)).toEqual([["1", "2", "3", "4"], ["5", "6", "7", "8"]])
    expect(splitEvenly(["1", "2", "3", "4", "5", "6", "7"], 3)).toEqual([["1", "2", "3"], ["4", "5", "6"], ["7"]])
  })

  it("follows the arrangement and skips sections with no text in the chosen languages", () => {
    const slides = buildSlides(song(), null, ["en"])
    expect(slides.map((s) => s.sectionLabel)).toEqual(["Verse 1", "Chorus", "Chorus"])
    expect(slides.map((s) => s.index)).toEqual([0, 1, 2])
    expect(slides.every((s) => s.total === 3)).toBe(true)
    expect(slides[0].lines).toEqual(["Amazing grace", "how sweet the sound"])
    expect(slides[0].secondaryLines).toBeUndefined()
  })

  it("aligns two languages per section and reports a missing language", () => {
    const slides = buildSlides(song(), "a1", ["en", "yo"])
    expect(slides.map((s) => s.sectionLabel)).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus"])
    expect(slides[0].secondaryLines).toEqual(["Oore-ọ̀fẹ́ ìyanu", "ohùn dídùn"])
    expect(slides[0].missing).toEqual([])
    expect(slides[1].secondaryLines).toBeUndefined()
    expect(slides[1].missing).toEqual(["yo"])
    // Verse 2 only exists in Yoruba: it is shown, with English reported missing.
    expect(slides[2].lines).toEqual(["Ẹsẹ kejì"])
    expect(slides[2].missing).toEqual(["en"])
  })

  it("splits a bilingual section only when both exceed the limit, into the same number of parts", () => {
    const long = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`).join("\n")
    const s = song({
      sections: [{ id: "v1", kind: "verse", label: "Verse 1", texts: { en: long("e", 8), yo: long("y", 9) } }],
      arrangements: [],
    })
    const slides = buildSlides(s, null, ["en", "yo"], 6)
    expect(slides).toHaveLength(2)
    expect(slides[0].lines).toEqual(["e1", "e2", "e3", "e4"])
    expect(slides[0].secondaryLines).toEqual(["y1", "y2", "y3", "y4", "y5"])
    expect(slides[1].secondaryLines).toEqual(["y6", "y7", "y8", "y9"])
    // Only one side long: keep the section whole so the languages stay aligned.
    const uneven = song({ sections: [{ id: "v1", kind: "verse", label: "Verse 1", texts: { en: long("e", 8), yo: "short" } }], arrangements: [] })
    expect(buildSlides(uneven, null, ["en", "yo"], 6)).toHaveLength(1)
  })

  it("falls back to the primary language and to authoring order", () => {
    const slides = buildSlides(song({ arrangements: [] }), "missing-arrangement", [])
    expect(slides.map((s) => s.sectionId)).toEqual(["v1", "c"])
  })
})

describe("render data", () => {
  it("carries lines, secondary lines and a footer only when the licence needs one", () => {
    const s = song()
    const [slide] = buildSlides(s, null, ["en", "yo"])
    const data = toLyricRenderData(s, slide)
    expect(data.kind).toBe("lyric")
    expect(data.reference).toBe("Amazing Grace · Verse 1")
    expect(data.lines).toEqual(["Amazing grace", "how sweet the sound"])
    expect(data.secondaryLines).toEqual(["Oore-ọ̀fẹ́ ìyanu", "ohùn dídùn"])
    expect(data.footer).toBeUndefined()
    expect(data.segments[0].text).toContain("Amazing grace")

    const ccli = song({ song: { ...s.song, licence: "ccli", ccli_number: "12345", copyright: "© 1990 Someone" } })
    expect(copyrightFooter(ccli.song)).toBe("Amazing Grace · John Newton · © 1990 Someone · CCLI 12345")
    expect(copyrightFooter({ ...ccli.song, licence: "unknown", ccli_number: null, copyright: "" })).toBe("Amazing Grace · John Newton")
  })

  it("recognises Yorùbá headings however they were typed, and every Markdown heading (round trip)", () => {
    const yo = parsePastedLyrics("Ẹsẹ̀ 1\nOore-ọ̀fẹ́\n\nÈgbè\nỌlọ́run\n\nÈGBÈ\nlẹ́ẹ̀kan sí i\n\n" + "E\u0300gbe\u0300\nNFD")
    expect(yo.map((s) => s.kind)).toEqual(["verse", "chorus", "chorus", "chorus"])
    expect(yo[1].texts.en).toBe("Ọlọ́run")
    const md = parsePastedLyrics("# Song\n\n## Section\nwords\n\n## Verse 1 (Yoruba)\nmore")
    expect(md.map((s) => [s.kind, s.texts.en])).toEqual([["other", "words"], ["verse", "more"]])
  })
})

