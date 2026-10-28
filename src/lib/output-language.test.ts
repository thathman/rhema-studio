import { describe, expect, it } from "vitest"
import { forOutputLanguage, isOutputLanguageFallback } from "./output-language"

const verse = { reference: "John 3:16", segments: [{ text: "For God so loved" }], translationLines: ["For God so loved", "Nítorí Ọlọ́run fẹ́"] }
const lyric = { kind: "lyric" as const, reference: "Amazing Grace", segments: [], lines: ["Amazing grace"], secondaryLines: ["Oore-ọ̀fẹ́"] }

describe("per-output language", () => {
  it("keeps both by default and drops the second language for first-only outputs", () => {
    expect(forOutputLanguage(verse)).toBe(verse)
    expect(forOutputLanguage(verse, "first")).toEqual({ reference: "John 3:16", segments: [{ text: "For God so loved" }] })
    expect(forOutputLanguage(lyric, "first")).toEqual({ kind: "lyric", reference: "Amazing Grace", segments: [], lines: ["Amazing grace"] })
  })

  it("shows only the second language when there is one, and never blanks when there is not", () => {
    expect(forOutputLanguage(verse, "second")).toEqual({ reference: "John 3:16", segments: [{ text: "Nítorí Ọlọ́run fẹ́" }] })
    expect(forOutputLanguage(lyric, "second")).toEqual({ kind: "lyric", reference: "Amazing Grace", segments: [], lines: ["Oore-ọ̀fẹ́"] })
    const single = { reference: "Ps 23:1", segments: [{ text: "The LORD is my shepherd" }] }
    expect(forOutputLanguage(single, "second")).toBe(single)
    expect(forOutputLanguage({ ...lyric, secondaryLines: [] }, "second")).toEqual({ ...lyric, secondaryLines: [] })
    expect(forOutputLanguage(null, "second")).toBeNull()
  })

  it("identifies visible-text fallback without flagging images or non-second outputs", () => {
    const singleLanguage = { reference: "Psalm 23:1", segments: [{ text: "The LORD is my shepherd" }] }
    expect(isOutputLanguageFallback(singleLanguage, "second")).toBe(true)
    expect(isOutputLanguageFallback({ kind: "lyric", reference: "Single-language song", segments: [], lines: ["Amazing grace"] }, "second")).toBe(true)
    expect(isOutputLanguageFallback(lyric, "second")).toBe(false)
    expect(isOutputLanguageFallback(verse, "first")).toBe(false)
    expect(isOutputLanguageFallback({ kind: "image", reference: "Church photo", segments: [] }, "second")).toBe(false)
    expect(isOutputLanguageFallback({ kind: "slide", screen: "black", reference: "Black", segments: [] }, "second")).toBe(false)
    expect(isOutputLanguageFallback({ reference: "Empty", segments: [] }, "second")).toBe(false)
  })
})
