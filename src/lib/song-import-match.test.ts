import { describe, expect, it } from "vitest"
import { existingSongFor } from "./song-files"
import type { SongInput, SongSummary } from "@/types"

/** #411: re-importing an OpenLyrics folder finds the songs already here instead of adding them again. */
const summary = (over: Partial<SongSummary>): SongSummary => ({ id: "s1", title: "Ọlọ́run Ọba", authors: "", licence: "public_domain", primary_language: "yo", languages: ["yo"], numbers: [], first_line: "Ọlọ́run Ọba ti o da wa", revision: 3, updated_at: "", ...over }) as SongSummary
const input = (over: Partial<SongInput> = {}): SongInput => ({ title: "Olorun Oba", primary_language: "yo", sections: [{ kind: "verse", label: "Verse 1", texts: { yo: "Olorun Oba ti o da wa\nLine two" } }], ...over }) as SongInput
const codeOf = (id: string) => (id === "book-sss" ? "SSS" : undefined)

describe("an OpenLyrics song matched to the library (#411)", () => {
  it("is the same song by title and first line, accents and case aside", () => {
    expect(existingSongFor(input(), [summary({})], codeOf)?.id).toBe("s1")
  })

  it("is the same hymn by title and one of its numbers", () => {
    const hymn = input({ sections: [{ kind: "verse", label: "Verse 1", texts: { yo: "A different first line" } }], numbers: [{ hymnbook_id: "book-sss", number: "245" }] })
    expect(existingSongFor(hymn, [summary({ numbers: ["SSS 245"] })], codeOf)?.id).toBe("s1")
  })

  it("is new when only the title is shared", () => {
    const other = input({ sections: [{ kind: "verse", label: "Verse 1", texts: { yo: "Something else entirely" } }] })
    expect(existingSongFor(other, [summary({})], codeOf)).toBeNull()
  })
})
