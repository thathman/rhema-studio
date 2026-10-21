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
})
