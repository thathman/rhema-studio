import { describe, expect, it } from "vitest"
import { elapsedMs, formatMs, idleTimer, isRunning, pause, remainingMs, reset, setDuration, start, timerTone } from "./timer"

describe("monotonic timer", () => {
  it("counts only the running stretches and ignores the wall clock entirely", () => {
    let t = setDuration(idleTimer(), 10 * 60_000)
    t = start(t, 1_000)
    expect(isRunning(t)).toBe(true)
    expect(elapsedMs(t, 61_000)).toBe(60_000)
    t = pause(t, 61_000)
    expect(isRunning(t)).toBe(false)
    // Time passes while paused; the wall clock could jump by hours here and it would not matter,
    // because nothing in the engine ever reads Date.
    expect(elapsedMs(t, 999_999)).toBe(60_000)
    t = start(t, 1_000_000)
    expect(elapsedMs(t, 1_030_000)).toBe(90_000)
    expect(remainingMs(t, 1_030_000)).toBe(510_000)
    expect(start(t, 5).startedAt).toBe(1_000_000) // starting a running timer is a no-op
    t = reset(t)
    expect(elapsedMs(t, 2_000_000)).toBe(0)
    expect(t.durationMs).toBe(600_000)
  })

  it("never goes backwards if the clock is read out of order", () => {
    const t = start(idleTimer(), 500)
    expect(elapsedMs(t, 400)).toBe(0)
  })

  it("formats and colours", () => {
    expect(formatMs(0)).toBe("0:00")
    expect(formatMs(754_000)).toBe("12:34")
    expect(formatMs(3_723_000)).toBe("1:02:03")
    expect(formatMs(-45_000)).toBe("−0:45")
    const t = start(setDuration(idleTimer(), 300_000), 0)
    expect(timerTone(t, 0)).toBe("ok")
    expect(timerTone(t, 200_000)).toBe("warn")
    expect(timerTone(t, 301_000)).toBe("over")
    expect(timerTone(start(idleTimer(), 0), 9e9)).toBe("ok")
  })
})
