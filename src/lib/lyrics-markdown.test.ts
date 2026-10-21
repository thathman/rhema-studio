import { describe, expect, it } from "vitest"
import type { SongWithSections } from "@/types"
import { matchHeading, parsePastedLyrics, songToMarkdown } from "./lyrics"

const song: SongWithSections = {
  song: { id: "s", title: "Amazing Grace", authors: "John Newton", copyright: "Public domain", ccli_number: "22025", licence: "public_domain", licence_note: "", primary_language: "en", tags: "", notes: "", key: "G", tempo: null, revision: 1, created_at: "", updated_at: "" },
  sections: [
    { id: "a", kind: "verse", label: "Verse 1", texts: { en: "Amazing grace how sweet the sound\nThat saved a wretch like me", yo: "Oore ofe" } },
    { id: "b", kind: "chorus", label: "", texts: { en: "My chains are gone" } },
    { id: "c", kind: "bridge", label: "Bridge", texts: { yo: "Only Yoruba" } },
  ],
  arrangements: [],
  numbers: [],
} as unknown as SongWithSections

describe("songs as Markdown text (FR-02)", () => {
  it("writes a title block and one heading per section in the chosen language", () => {
    expect(songToMarkdown(song)).toBe("# Amazing Grace\nJohn Newton\n© Public domain · CCLI 22025\n\n## Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\n## Chorus\nMy chains are gone\n")
    expect(songToMarkdown(song, "yo")).toContain("## Bridge\nOnly Yoruba")
  })

  it("pastes back into the same sections, without the title block", () => {
    expect(parsePastedLyrics(songToMarkdown(song))).toEqual([
      { kind: "verse", texts: { en: "Amazing grace how sweet the sound\nThat saved a wretch like me" } },
      { kind: "chorus", texts: { en: "My chains are gone" } },
    ])
  })

  it("reads Markdown and chord-sheet headings, not a parenthesised repeat marker", () => {
    expect(matchHeading("## Chorus")).toBe("chorus")
    expect(matchHeading("**Verse 2**")).toBe("verse")
    expect(matchHeading("[Bridge]")).toBe("bridge")
    expect(matchHeading("(Chorus)")).toBeNull()
    expect(parsePastedLyrics("[Verse 1]\nLine one\n\n[Chorus]\nLine two").map((s) => s.kind)).toEqual(["verse", "chorus"])
  })
})
