import { describe, expect, it } from "vitest"
import { localDate, todaysService } from "./todays-service"
import type { Program } from "@/types"

const p = (id: string, service_date: string | null, approved: boolean): Program => ({ id, title: id, service_date, revision: 4, approved_revision: approved ? 4 : 2, approved_at: null, created_at: "", updated_at: "", item_count: 3 })

describe("today's service", () => {
  it("prefers approved today, then today, then the next approved; never undated or past", () => {
    const today = "2026-10-25"
    expect(todaysService([p("a", "2026-10-25", false), p("b", "2026-10-25", true)], today)).toMatchObject({ program: { id: "b" }, why: "approved today" })
    expect(todaysService([p("a", "2026-10-25", false)], today)).toMatchObject({ program: { id: "a" }, why: "today" })
    expect(todaysService([p("old", "2026-10-18", true), p("later", "2026-11-08", true), p("soon", "2026-11-01", true), p("u", null, true)], today)).toMatchObject({ program: { id: "soon" }, why: "next approved" })
    expect(todaysService([p("old", "2026-10-18", true), p("u", null, true), p("later-unapproved", "2026-11-01", false)], today)).toBeNull()
  })

  it("formats the local date like service_date", () => {
    expect(localDate(new Date(2026, 9, 5))).toBe("2026-10-05")
  })
})
