import { describe, expect, it } from "vitest"
import { assigneesShort, cleanAssignees, itemAssignees, knownPeople, MAX_ASSIGNEES, parseAssignees, preparedByText, withAssignees } from "./assignees"
import type { QueueItem } from "@/types"

const slide = { id: "s", kind: "slide", slide: { title: "Notices", body: "" }, reference: "Notices", confidence: 1, source: "manual", added_at: 0 } as QueueItem

describe("an item's people (#299 6.10)", () => {
  it("are short clean names, without blanks or repeats, at most twelve", () => {
    expect(cleanAssignees([" Tolu ", "", "tolu", "Ade\tOla", 4, null])).toEqual(["Tolu", "Ade Ola"])
    expect(cleanAssignees(Array.from({ length: 20 }, (_, n) => `P${n}`))).toHaveLength(MAX_ASSIGNEES)
    expect(cleanAssignees("Tolu")).toEqual([])
  })

  it("fall back to the 'prepared by' line of an older item as its one person", () => {
    expect(itemAssignees({ prepared_by: "Tolu (music)" })).toEqual(["Tolu (music)"])
    expect(itemAssignees({ assignees: ["Ade", "Bisi"], prepared_by: "Ade, Bisi" })).toEqual(["Ade", "Bisi"])
    expect(itemAssignees({ assignees: [], prepared_by: null })).toEqual([])
  })

  it("keep 'prepared by' as the joined names, within 60 characters", () => {
    const item = withAssignees(slide, ["Tolu", "Ade"])
    expect(item).toMatchObject({ assignees: ["Tolu", "Ade"], prepared_by: "Tolu, Ade" })
    expect(withAssignees(item, [])).toMatchObject({ assignees: null, prepared_by: null })
    const long = ["Oluwatoluwani Adebayo-Johnson", "Babajide Oluwaseun Ogundipe", "Ade"]
    expect(preparedByText(long)).toBe("Oluwatoluwani Adebayo-Johnson +2")
    expect(Array.from(preparedByText(["x".repeat(60), "y"])).length).toBeLessThanOrEqual(60)
  })

  it("read back only while the saved list still matches its 'prepared by' line", () => {
    expect(parseAssignees('{"assignees":["Tolu","Ade"],"prepared_by":"Tolu, Ade"}', "Tolu, Ade")).toEqual(["Tolu", "Ade"])
    expect(parseAssignees('{"assignees":["Tolu","Ade"],"prepared_by":"Bisi"}', "Bisi")).toBeNull()
    expect(parseAssignees('{"assignees":["Tolu"]}', null)).toBeNull()
    expect(parseAssignees("not json", null)).toBeNull()
  })

  it("show short in a row, and offer names already on the service", () => {
    expect(assigneesShort(["Tolu", "Ade", "Bisi"])).toEqual({ first: "Tolu", more: 2 })
    expect(assigneesShort([])).toBeNull()
    expect(knownPeople([{ prepared_by: "Tolu" }, { assignees: ["Ade", "tolu"] }], "Bisi")).toEqual(["Bisi", "Tolu", "Ade"])
  })
})
