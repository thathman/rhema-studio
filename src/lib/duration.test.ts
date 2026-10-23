import { describe, expect, it } from "vitest"
import { formatDuration, parseDuration } from "@/lib/run-of-show"

describe("durations as typed (#196)", () => {
  it("reads minutes, min:sec, h:mm:ss and h/m/s", () => {
    const cases: [string, number | null][] = [
      ["35", 35], ["35m", 35], ["35 min", 35], ["4.5", 4.5], ["4,5", 4.5], ["4:30", 4.5], ["0:45", 0.75],
      ["1:10:00", 70], ["1h10", 70], ["1h 10m", 70], ["2h", 120], ["90s", 1.5], ["1m30s", 1.5],
      ["", null], ["0", null], ["abc", null], ["4:75", null], ["601", null], ["10:00:00", 600], ["10:00:01", null], ["-5", null],
    ]
    for (const [text, want] of cases) expect([text, parseDuration(text)]).toEqual([text, want])
  })

  it("writes them back the way they read", () => {
    expect([35, 4.5, 70, 0.75, 120].map(formatDuration)).toEqual(["35", "4:30", "1:10:00", "0:45", "2:00:00"])
    for (const m of [35, 4.5, 70, 0.75, 599.5]) expect(parseDuration(formatDuration(m))).toBe(m)
  })
})
