import { describe, expect, it } from "vitest"
import { yorubaBibleIn } from "./use-broadcast"

const translations = [
  { id: 4, abbreviation: "KJV", language: "en" },
  { id: 2, abbreviation: "OYCB", language: "yo" },
]

describe("yorubaBibleIn (quick screens in Yorùbá too)", () => {
  it("is the operator's active or second Bible", () => {
    expect(yorubaBibleIn(translations, [4, 2], [])).toBe(true)
    expect(yorubaBibleIn(translations, [4, null], [])).toBe(false)
  })
  it("is a verse of the open service saved in a Yorùbá Bible, on an English set-up", () => {
    expect(yorubaBibleIn(translations, [4, null], [{ kind: "verse", translation: "OYCB", secondary_translation: "KJV" }])).toBe(true)
    expect(yorubaBibleIn(translations, [4, null], [{ kind: "verse", translation: "KJV", secondary_translation: null }, { kind: "song" }])).toBe(false)
  })
})
