import { describe, expect, it } from "vitest"
import { clockAt, minutesOfDay, timeText, validTimeZone, wallParts, zonedInstant } from "./church-time"
import { clockInstant } from "./run-of-show"

const utc = (mo: number, d: number, h: number, m = 0) => Date.UTC(2026, mo, d, h, m)

describe("the church's clock (#196 R1.1)", () => {
  it("knows a real zone and turns anything else into the computer's own clock", () => {
    expect(validTimeZone("Africa/Lagos")).toBe("Africa/Lagos")
    expect(validTimeZone("Nowhere/Land")).toBe("")
    expect(validTimeZone("")).toBe("")
    expect(validTimeZone(undefined)).toBe("")
  })

  it("reads and makes times in a zone, whatever this computer's zone is", () => {
    // Lagos is one hour ahead of UTC all year.
    expect(wallParts(utc(9, 25, 9), "Africa/Lagos")).toEqual({ year: 2026, month: 9, day: 25, hour: 10, minute: 0 })
    expect(zonedInstant({ year: 2026, month: 9, day: 25, hour: 10, minute: 0 }, "Africa/Lagos")).toBe(utc(9, 25, 9))
    expect(clockAt(utc(9, 25, 23, 30), "Africa/Lagos")).toBe("00:30")
    expect(minutesOfDay(utc(9, 25, 9, 15), "Africa/Lagos")).toBe(10 * 60 + 15)
  })

  it("with no zone, is exactly the computer's clock, as before", () => {
    const t = new Date(2026, 9, 25, 10, 5).getTime()
    expect(wallParts(t)).toEqual({ year: 2026, month: 9, day: 25, hour: 10, minute: 5 })
    expect(clockAt(t)).toBe("10:05")
    expect(clockInstant(10 * 60, t)).toBe(new Date(2026, 9, 25, 10, 0).getTime())
    expect(timeText(t)).toBe(new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }))
  })

  it("a clock time nearest a moment is on the church's day, across midnight", () => {
    // 08:00 UTC is 09:00 in Lagos: the 10:00 service is an hour away.
    expect(clockInstant(10 * 60, utc(9, 25, 8), "Africa/Lagos")).toBe(utc(9, 25, 9))
    // 23:10 UTC is 00:10 in Lagos the next day: a 23:30 watchnight start is the night before's.
    expect(clockInstant(23 * 60 + 30, utc(9, 25, 23, 10), "Africa/Lagos")).toBe(utc(9, 25, 22, 30))
  })

  it("keeps the church's time across its clock change (25-hour day)", () => {
    // New York's clocks go back at 02:00 on 1 November 2026: 23:00 that evening is 04:00 UTC the next day.
    expect(clockInstant(23 * 60, utc(10, 2, 5, 30), "America/New_York")).toBe(utc(10, 2, 4))
    // And 09:00 that morning was still summer time (UTC−4).
    expect(clockInstant(9 * 60, utc(10, 1, 12), "America/New_York")).toBe(utc(10, 1, 14))
  })

  it("shows times on the church's clock in the computer's own style", () => {
    expect(timeText(utc(9, 25, 9), "Africa/Lagos")).toBe(new Date(utc(9, 25, 9)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }))
  })
})
