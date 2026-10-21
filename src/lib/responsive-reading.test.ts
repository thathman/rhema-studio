import { describe, expect, it } from "vitest"
import { hasReadingMarks, parseReading, readingPages } from "./responsive-reading"

const psalm = `L: Give thanks to the Lord, for he is good.
P: His love endures for ever.
Leader: Give thanks to the God of gods.
All: His love endures for ever.
L: To him who alone does great wonders,
who by his understanding made the heavens,
C: His love endures for ever.`

describe("responsive readings", () => {
  it("reads leader and people parts, unmarked lines continuing the part above", () => {
    expect(parseReading(psalm).map((l) => l.part)).toEqual(["leader", "people", "leader", "people", "leader", "leader", "people"])
    expect(parseReading("L: one\n\n  P:   two  ")[1]).toEqual({ part: "people", text: "two" })
  })

  it("makes one slide per exchange, labelling where each part starts", () => {
    expect(readingPages(psalm)).toEqual([
      "Leader: Give thanks to the Lord, for he is good.\nAll: His love endures for ever.",
      "Leader: Give thanks to the God of gods.\nAll: His love endures for ever.",
      "Leader: To him who alone does great wonders,\nwho by his understanding made the heavens,\nAll: His love endures for ever.",
    ])
    expect(readingPages("P: Amen.")).toEqual(["All: Amen."])
    expect(readingPages("L: x\nP: y", { leader: "Minister", people: "People" })[0]).toBe("Minister: x\nPeople: y")
  })

  it("only treats short labels followed by a colon or full stop as marks", () => {
    expect(hasReadingMarks("Lord, have mercy")).toBe(false)
    expect(hasReadingMarks("Love is patient")).toBe(false)
    expect(hasReadingMarks("All: Amen")).toBe(true)
  })

  it("keeps initials and abbreviations as text, and caps a slide at six lines", () => {
    const t = "L: As C. S. Lewis put it,\nP.S. bring a friend\nL.A. campus prays with us\nAll: Amen"
    expect(parseReading(t).map((l) => [l.part, l.text])).toEqual([["leader", "As C. S. Lewis put it,"], ["leader", "P.S. bring a friend"], ["leader", "L.A. campus prays with us"], ["people", "Amen"]])
    expect(hasReadingMarks("C. S. Lewis wrote this.")).toBe(false)
    const long = ["L: one", "two", "three", "four", "five", "six", "seven", "P: amen"].join("\n")
    expect(readingPages(long)).toEqual(["Leader: one\ntwo\nthree\nfour\nfive\nsix", "Leader: seven\nAll: amen"])
  })
})
