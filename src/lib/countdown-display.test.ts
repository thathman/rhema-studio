import { describe, expect, it } from "vitest"
import {
  activeStep, countdownFrame, countdownNow, countdownText, CountdownFade, DEFAULT_COUNTDOWN_LOOK, FADE_MS, itemCounting, itemWarnMs, lookCounting, MAX_FLASH_HZ, MAX_STEPS,
  mixColour, nextChangeIn, NO_COUNTDOWN_SOURCES, normalizeCountdownLook, parseTimeLeft, PULSE_DEPTH, PULSE_HZ, pulsed, pulseLevel, stepThresholds, timeLeftText, untilInstant,
} from "@/lib/countdown-display"
import { feedMotion } from "@/lib/feed-motion"
import type { CountdownFrame, CountdownStep } from "@/types"

const TEN = 10 * 60_000
const steps = DEFAULT_COUNTDOWN_LOOK.steps
const frame = (p: Partial<CountdownFrame>): CountdownFrame => ({ look: DEFAULT_COUNTDOWN_LOOK, label: "Service timer", totalMs: TEN, endsAt: null, leftMs: TEN, item: null, next: null, zone: "", ...p })

describe("countdown display steps (owner request: black, amber at 25 %, red at 10 %, Time's up at 0)", () => {
  it("a 10-minute timer: black to 2:30, amber from 2:30, red from 1:00, Time's up at 0:00 and through overtime", () => {
    expect(activeStep(steps, TEN, TEN)).toBe(-1)
    expect(activeStep(steps, TEN, 150_001)).toBe(-1)
    expect(activeStep(steps, TEN, 150_000)).toBe(0)
    expect(activeStep(steps, TEN, 60_001)).toBe(0)
    expect(activeStep(steps, TEN, 60_000)).toBe(1)
    expect(activeStep(steps, TEN, 1)).toBe(1)
    expect(activeStep(steps, TEN, 0)).toBe(2)
    expect(activeStep(steps, TEN, -42_000)).toBe(2)
    expect(activeStep(steps, TEN, -3 * 3_600_000)).toBe(2)
  })

  it("the screen at each place: colours, message, the time and the pulse", () => {
    const at = (left: number) => countdownNow(frame({ endsAt: 1_000_000 + left }), 1_000_000)
    expect(at(TEN)).toMatchObject({ background: "#000000", text: "#ffffff", message: "", time: "10:00", pulse: false, over: false })
    expect(at(120_000)).toMatchObject({ background: "#d97706", text: "#000000", time: "2:00" })
    // Red as the big time says 1:00.
    expect(at(60_000)).toMatchObject({ background: "#c81e1e", message: "Please wrap up", time: "1:00" })
    expect(at(0)).toMatchObject({ background: "#c81e1e", message: "Time's up", time: "0:00", pulse: true })
    expect(at(-42_400)).toMatchObject({ background: "#c81e1e", message: "Time's up", time: "+0:42", pulse: true, over: true })
  })

  it("the list's order does not matter; two steps at the same time: the later one in the list", () => {
    const shuffled = [steps[2], steps[0], steps[1]]
    for (const left of [TEN, 150_000, 90_000, 60_000, 30_000, 0, -5000]) {
      const a = activeStep(steps, TEN, left), b = activeStep(shuffled, TEN, left)
      expect(a === -1 ? null : steps[a]).toEqual(b === -1 ? null : shuffled[b])
    }
    const twins: CountdownStep[] = [{ ...steps[1], message: "first" }, { ...steps[1], when: "time", at: 60, message: "second" }]
    expect(twins[activeStep(twins, TEN, 30_000)].message).toBe("second")
  })

  it("a timer with no length counts up in the starting colours; no steps, nothing to count: none", () => {
    expect(activeStep(steps, 0, -65_000)).toBe(-1)
    expect(activeStep(steps, 0, 0)).toBe(-1)
    expect(countdownText(0, -65_000)).toBe("1:05")
    expect(countdownNow(frame({ totalMs: 0, endsAt: 0, leftMs: 0 }), 65_000)).toMatchObject({ background: "#000000", time: "1:05", over: false, pulse: false })
    expect(activeStep([], TEN, -1)).toBe(-1)
    expect(countdownNow(frame({ idle: "Set the service timer in Present" }), 0)).toMatchObject({ step: -1, time: "–:––", background: "#000000" })
  })

  it("a paused timer keeps its step's colours and message, but nothing moves (no pulse)", () => {
    expect(countdownNow(frame({ endsAt: null, leftMs: 0 }), 5_000)).toMatchObject({ background: "#c81e1e", message: "Time's up", pulse: false, running: false })
    expect(countdownNow(frame({ endsAt: null, leftMs: 45_000 }), 99_999)).toMatchObject({ time: "0:45", step: 1 })
    expect(nextChangeIn(frame({ endsAt: null }), 0)).toBe(Infinity)
  })

  it("an item's own warning (Prepare → Timing) moves the first step after the start, not the others", () => {
    const thirty = 30 * 60_000
    expect(stepThresholds(steps, thirty, 5 * 60_000)).toEqual([5 * 60_000, 3 * 60_000, 0])
    expect(activeStep(steps, thirty, 6 * 60_000, 5 * 60_000)).toBe(-1)
    expect(activeStep(steps, thirty, 5 * 60_000, 5 * 60_000)).toBe(0)
    expect(itemWarnMs({ timing: { warn_minutes: 1.5 } })).toBe(90_000)
    expect(itemWarnMs({ timing: { warn_minutes: -1 } })).toBeUndefined()
    expect(itemWarnMs({})).toBeUndefined()
  })

  it("the big time rounds up while counting down and counts on from +0:01 over", () => {
    expect([60_001, 60_000, 59_001, 999, 0, -999, -1000, -61_000].map((l) => countdownText(TEN, l))).toEqual(["1:01", "1:00", "1:00", "0:01", "0:00", "0:00", "+0:01", "+1:01"])
    expect(nextChangeIn(frame({ endsAt: 12_500 }), 10_000)).toBe(500)
    expect(nextChangeIn(frame({ endsAt: 12_000 }), 10_000)).toBe(1000)
  })
})

describe("never flashing (accessibility: no more than 3 flashes a second)", () => {
  it("the pulse rises and falls once a second, smoothly, and darkens gently", () => {
    expect(PULSE_HZ).toBeLessThan(MAX_FLASH_HZ)
    // Count the pulse's peaks over 10 seconds, sampled every 10 ms.
    let peaks = 0
    for (let t = 10; t < 10_000; t += 10) if (pulseLevel(t) > pulseLevel(t - 10) && pulseLevel(t) >= pulseLevel(t + 10)) peaks++
    expect(peaks / 10).toBeLessThanOrEqual(MAX_FLASH_HZ)
    expect(peaks / 10).toBeCloseTo(PULSE_HZ, 1)
    // Never a jump: one 10 ms step moves it a few per cent at most.
    for (let t = 0; t < 2000; t += 10) expect(Math.abs(pulseLevel(t + 10) - pulseLevel(t))).toBeLessThan(0.05)
    expect(PULSE_DEPTH).toBeLessThanOrEqual(0.35)
    expect(pulsed("#c81e1e", 0)).toBe("#c81e1e")
    expect(pulsed("#c81e1e", 500)).toBe(mixColour("#c81e1e", "#000000", PULSE_DEPTH))
  })

  it("a change of step blends over about 300 ms, then holds still", () => {
    const fade = new CountdownFade()
    expect(fade.colours({ background: "#000000", text: "#ffffff" }, 0)).toEqual({ background: "#000000", text: "#ffffff", moving: false })
    expect(fade.colours({ background: "#000000", text: "#ffffff" }, 5000)).toMatchObject({ moving: false })
    const mid = fade.colours({ background: "#c81e1e", text: "#ffffff" }, 10_000 + 0)
    expect(mid).toMatchObject({ background: "#000000", moving: true })
    expect(fade.colours({ background: "#c81e1e", text: "#ffffff" }, 10_000 + FADE_MS / 2)).toMatchObject({ background: mixColour("#000000", "#c81e1e", 0.5), moving: true })
    expect(fade.colours({ background: "#c81e1e", text: "#ffffff" }, 10_000 + FADE_MS)).toEqual({ background: "#c81e1e", text: "#ffffff", moving: false })
  })

  it("a browser feed animates only while a countdown pulses or blends; otherwise it waits for the next second", () => {
    const s = { now: 0, hostNow: 0, fading: false, cameraInCanvas: false, strips: new Set<string>() }
    expect(feedMotion({}, s)).toEqual({ picture: false, crawl: false })
    expect(feedMotion({}, { ...s, countdown: true })).toEqual({ picture: true, crawl: false })
  })
})

describe("the look as saved", () => {
  it("anything missing or broken falls back to the built-in look; a saved look loads unchanged", () => {
    expect(normalizeCountdownLook(undefined)).toEqual(DEFAULT_COUNTDOWN_LOOK)
    expect(normalizeCountdownLook({ counts: "nonsense" as never, background: "red", leadMinutes: 9999, steps: [{ when: "time", at: -5 } as never, null as never, { when: "soon" } as never] })).toMatchObject({
      counts: "timer", background: "#000000", leadMinutes: 240, steps: [{ when: "time", at: 0, background: "#000000", text: "#ffffff", message: "", pulse: false }],
    })
    const many = Array.from({ length: 9 }, (_, i) => ({ ...steps[0], at: i }))
    expect(normalizeCountdownLook({ steps: many }).steps).toHaveLength(MAX_STEPS)
    const mine = normalizeCountdownLook({ counts: "aux", auxLabel: "Communion prep", until: "10:00", steps: [{ ...steps[2], message: "Stop now" }], showNext: true })
    expect(normalizeCountdownLook(JSON.parse(JSON.stringify(mine)))).toEqual(mine)
    expect(normalizeCountdownLook({ until: "25:00" }).until).toBe("")
  })

  it("a time left is typed as m:ss or seconds", () => {
    expect(parseTimeLeft("1:30")).toBe(90)
    expect(parseTimeLeft(" 45 ")).toBe(45)
    expect(parseTimeLeft("1:75")).toBeNull()
    expect(parseTimeLeft("soon")).toBeNull()
    expect(timeLeftText(60)).toBe("1:00")
    expect(timeLeftText(0)).toBe("0:00")
  })
})

describe("what it counts, on the host", () => {
  const timer = { durationMs: TEN, startedAt: 1000, accumulatedMs: 0 }

  it("the service timer: running, its end on the wall clock; held; not set", () => {
    // 4 minutes into a 10-minute timer: it ends 6 minutes from now.
    expect(lookCounting(DEFAULT_COUNTDOWN_LOOK, NO_COUNTDOWN_SOURCES, timer, 1000 + 240_000, 50_000_000)).toEqual({ label: "Service timer", totalMs: TEN, endsAt: 50_000_000 + 360_000, leftMs: 360_000 })
    expect(lookCounting(DEFAULT_COUNTDOWN_LOOK, NO_COUNTDOWN_SOURCES, { ...timer, startedAt: null, accumulatedMs: 240_000 }, 0, 0)).toMatchObject({ endsAt: null, leftMs: 360_000 })
    expect(lookCounting(DEFAULT_COUNTDOWN_LOOK, NO_COUNTDOWN_SOURCES, { durationMs: 0, startedAt: null, accumulatedMs: 0 }, 0, 0).idle).toMatch(/service timer/)
    expect(lookCounting(DEFAULT_COUNTDOWN_LOOK, { ...NO_COUNTDOWN_SOURCES, itemWarnMs: 60_000 }, timer, 1000, 0).warnMs).toBe(60_000)
  })

  it("an extra timer by its name (any case), else the first; none: says where to add one", () => {
    const aux = [{ label: "Interpreter", totalMs: 60_000, endsAt: null, leftMs: 60_000 }, { label: "Communion prep", totalMs: 300_000, endsAt: 9, leftMs: 0 }]
    const look = { ...DEFAULT_COUNTDOWN_LOOK, counts: "aux" as const }
    expect(lookCounting({ ...look, auxLabel: "communion PREP" }, { ...NO_COUNTDOWN_SOURCES, aux }, timer, 0, 0).label).toBe("Communion prep")
    expect(lookCounting(look, { ...NO_COUNTDOWN_SOURCES, aux }, timer, 0, 0).label).toBe("Interpreter")
    expect(lookCounting({ ...look, auxLabel: "Choir" }, NO_COUNTDOWN_SOURCES, timer, 0, 0).idle).toMatch(/No extra timer called “Choir”/)
  })

  it("a time of day: today's, or tomorrow's once today's is long gone; percentages over the minutes before it", () => {
    const now = new Date(2026, 9, 25, 9, 40).getTime()
    expect(untilInstant("10:00", now)).toBe(new Date(2026, 9, 25, 10, 0).getTime())
    expect(untilInstant("08:00", new Date(2026, 9, 25, 21, 0).getTime())).toBe(new Date(2026, 9, 26, 8, 0).getTime())
    expect(untilInstant("nope", now)).toBeNull()
    const c = lookCounting({ ...DEFAULT_COUNTDOWN_LOOK, counts: "until", until: "10:00", leadMinutes: 30 }, NO_COUNTDOWN_SOURCES, timer, 0, now)
    expect(c).toMatchObject({ label: "Until 10:00", totalMs: 30 * 60_000, endsAt: new Date(2026, 9, 25, 10, 0).getTime() })
    // 20 minutes to go of the last 30: two thirds left, still black; at 3 minutes (10 %) red.
    expect(countdownNow(frame({ ...c, look: DEFAULT_COUNTDOWN_LOOK }), now).step).toBe(-1)
    expect(countdownNow(frame({ ...c, look: DEFAULT_COUNTDOWN_LOOK }), new Date(2026, 9, 25, 9, 57).getTime()).step).toBe(1)
    expect(lookCounting({ ...DEFAULT_COUNTDOWN_LOOK, counts: "start" }, NO_COUNTDOWN_SOURCES, timer, 0, now).idle).toMatch(/no start time/)
  })

  it("the item on now: its planned minutes from when it started, cut short by its end-by", () => {
    const ev = { state: "live", label: "Sermon", plannedStart: 0, plannedEnd: 30 * 60_000, actualStart: 1_000_000, hardStop: null as number | null }
    expect(itemCounting({ events: [ev] })).toEqual({ label: "Sermon", totalMs: 30 * 60_000, endsAt: 1_000_000 + 30 * 60_000, leftMs: 0 })
    expect(itemCounting({ events: [{ ...ev, hardStop: 1_000_000 + 20 * 60_000 }] })).toMatchObject({ totalMs: 20 * 60_000, endsAt: 1_000_000 + 20 * 60_000 })
    expect(itemCounting({ events: [{ ...ev, actualStart: null }] })).toEqual({ label: "Sermon", totalMs: 30 * 60_000, endsAt: null, leftMs: 30 * 60_000 })
    expect(itemCounting({ events: [{ ...ev, plannedEnd: 0 }] })).toBeNull()
    expect(itemCounting({ events: [{ ...ev, state: "done" }] })).toBeNull()
    expect(itemCounting(null)).toBeNull()
  })

  it("the frame carries what a screen needs to count by itself", () => {
    const f = countdownFrame(DEFAULT_COUNTDOWN_LOOK, { label: "Service timer", totalMs: TEN, endsAt: 123, leftMs: 0, warnMs: 60_000 }, { item: "Sermon", next: "Offering", zone: "Africa/Lagos" })
    expect(f).toEqual({ look: DEFAULT_COUNTDOWN_LOOK, label: "Service timer", totalMs: TEN, endsAt: 123, leftMs: 0, warnMs: 60_000, item: "Sermon", next: "Offering", zone: "Africa/Lagos" })
    expect(JSON.parse(JSON.stringify(f))).toEqual(f)
  })
})
