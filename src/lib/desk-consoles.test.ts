import { describe, expect, it } from "vitest"
import { chorusesOf, chorusTarget, sectionsOf } from "@/lib/desk-consoles"
import { crewWords, passageFrom } from "@/lib/desk-console-words"

const slide = (sectionId: string, sectionLabel: string) => ({ sectionId, sectionLabel })

describe("desk consoles (#197)", () => {
  it("a song's sections follow its slides: a long verse is one section, a chorus sung twice is two", () => {
    const slides = [slide("v1", "Verse 1"), slide("v1", "Verse 1"), slide("c", "Chorus"), slide("v2", "Verse 2"), slide("c", "Chorus")]
    expect(sectionsOf(slides, 0)).toEqual({ starts: [0, 2, 3, 4], labels: ["Verse 1", "Chorus", "Verse 2", "Chorus"], ids: ["v1", "c", "v2", "c"], at: 0 })
    expect(sectionsOf(slides, 1).at).toBe(0)
    expect(sectionsOf(slides, 2).at).toBe(1)
    expect(sectionsOf(slides, 4).at).toBe(3)
    expect(sectionsOf([], 0)).toEqual({ starts: [], labels: [], ids: [], at: 0 })
  })

  it("repeat chorus goes to the last chorus sung, else the song's first; none without a chorus", () => {
    const song = { sections: [{ id: "v1", kind: "verse" }, { id: "c", kind: "chorus" }, { id: "v2", kind: "verse" }] } as never
    const choruses = chorusesOf(song, ["v1", "c", "v2", "c"])
    expect(choruses).toEqual([1, 3])
    expect(chorusTarget(choruses, 2)).toBe(1)
    expect(chorusTarget(choruses, 3)).toBe(3)
    expect(chorusTarget(choruses, 0)).toBe(1)
    expect(chorusTarget([], 2)).toBeNull()
  })

  it("a passage preview is the verse asked for and the two after it", () => {
    const ch = [1, 2, 3, 4, 5].map((verse) => ({ book: 43, bookName: "John", chapter: 3, verse, text: `v${verse}` }))
    expect(passageFrom(ch, 2).map((v) => v.verse)).toEqual([2, 3, 4])
    expect(passageFrom(ch, 5).map((v) => v.verse)).toEqual([5])
    expect(passageFrom(ch, 9)).toEqual([])
  })

  it("the director's board says who is connected in plain words", () => {
    const now = 10 * 60_000
    expect(crewWords({ name: "A", role: "bible", connected: true, lastSeenMs: now }, now)).toBe("Connected")
    expect(crewWords({ name: "A", role: "bible", connected: false, lastSeenMs: null }, now)).toBe("Not connected")
    expect(crewWords({ name: "A", role: "bible", connected: false, lastSeenMs: now - 20_000 }, now)).toBe("Seen just now")
    expect(crewWords({ name: "A", role: "bible", connected: false, lastSeenMs: now - 4 * 60_000 }, now)).toBe("Seen 4 min ago")
  })
})
