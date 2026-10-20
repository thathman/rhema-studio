import { describe, expect, it } from "vitest"
import { signageActive, signageFrame, signageIndex } from "./signage"

describe("signage loop", () => {
  it("rotates round-robin by seconds from the start, and is -1 with nothing to show", () => {
    expect(signageIndex(0, 0, 5_000, 10)).toBe(-1)
    expect(signageIndex(3, 1_000, 1_000, 10)).toBe(0)
    expect(signageIndex(3, 1_000, 10_999, 10)).toBe(0)
    expect(signageIndex(3, 1_000, 11_000, 10)).toBe(1)
    expect(signageIndex(3, 1_000, 31_000, 10)).toBe(0)
    expect(signageIndex(3, 1_000, 0, 10)).toBe(0) // clock before start: first picture, never negative
    expect(signageIndex(2, 0, 1_500, 0)).toBe(1) // seconds floor at 1
  })

  it("makes a full-frame picture", () => {
    expect(signageFrame("data:x")).toMatchObject({ kind: "image", image: { url: "data:x", fit: "cover" } })
  })

  it("runs inside its window on its days, crosses midnight, and never blanks on a bad schedule", () => {
    const sun = (h: number, m = 0) => new Date(2026, 9, 25, h, m) // Sunday 25 Oct 2026, local time
    const mon = (h: number, m = 0) => new Date(2026, 9, 26, h, m)
    expect(signageActive(undefined, sun(10))).toBe(true)
    const sundayMorning = { days: [0], from: "08:00", to: "12:30" }
    expect(signageActive(sundayMorning, sun(8))).toBe(true)
    expect(signageActive(sundayMorning, sun(12, 29))).toBe(true)
    expect(signageActive(sundayMorning, sun(12, 30))).toBe(false)
    expect(signageActive(sundayMorning, sun(7, 59))).toBe(false)
    expect(signageActive(sundayMorning, mon(9))).toBe(false)
    expect(signageActive({ days: [], from: "08:00", to: "12:30" }, mon(9))).toBe(true)
    const vigil = { days: [0], from: "22:00", to: "02:00" }
    expect(signageActive(vigil, sun(23))).toBe(true)
    expect(signageActive(vigil, mon(1))).toBe(true) // tail of Sunday's window
    expect(signageActive(vigil, mon(3))).toBe(false)
    expect(signageActive(vigil, mon(23))).toBe(false)
    expect(signageActive({ days: [0], from: "8am", to: "noon" }, mon(3))).toBe(true) // unreadable: always on
    expect(signageActive({ days: [0], from: "09:00", to: "09:00" }, mon(3))).toBe(true)
  })
})
