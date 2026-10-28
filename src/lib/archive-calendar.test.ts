import { describe, expect, it } from "vitest"
import { archiveMonthAt, formatServiceCalendarDate, serviceDateInMonth } from "./archive-calendar"

describe("the Archive calendar", () => {
  it("uses the church calendar month at a UTC month boundary", () => {
    const now = Date.parse("2026-11-01T00:30:00.000Z")

    expect(archiveMonthAt(now, "America/Los_Angeles")).toMatchObject({ year: 2026, month: 10, monthName: "October" })
    expect(archiveMonthAt(now, "Asia/Tokyo")).toMatchObject({ year: 2026, month: 11, monthName: "November" })
  })

  it("changes month on the church date through the New York daylight-saving fallback", () => {
    const justBeforeChurchMidnight = Date.parse("2026-11-01T03:30:00.000Z")
    const afterFallback = Date.parse("2026-11-01T06:30:00.000Z")

    const october = archiveMonthAt(justBeforeChurchMidnight, "America/New_York")
    const november = archiveMonthAt(afterFallback, "America/New_York")
    expect(october).toMatchObject({ year: 2026, month: 10, monthName: "October" })
    expect(november).toMatchObject({ year: 2026, month: 11, monthName: "November" })
    expect(serviceDateInMonth("2026-10-31", october)).toBe(true)
    expect(serviceDateInMonth("2026-11-01", october)).toBe(false)
    expect(serviceDateInMonth("2026-11-01", november)).toBe(true)
  })

  it("shows a saved calendar date the same on operator laptops in different timezones", () => {
    const previous = process.env.TZ
    try {
      process.env.TZ = "Pacific/Kiritimati"
      const east = formatServiceCalendarDate("2026-11-01", { day: "numeric", month: "short", year: "numeric" }, "en-US")
      process.env.TZ = "Pacific/Honolulu"
      const west = formatServiceCalendarDate("2026-11-01", { day: "numeric", month: "short", year: "numeric" }, "en-US")

      expect(east).toBe("Nov 1, 2026")
      expect(west).toBe(east)
      expect(formatServiceCalendarDate("2026-02-30", { day: "numeric" }, "en-US")).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })
})
