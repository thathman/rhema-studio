import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BroadcastOutput, QueueItem } from "@/types"

const invoke = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null)
const emitTo = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo }))

const { updateStageFinish, refreshStageCountdown } = await import("./stage-finish")
const { checkCountdownChime, playChime, startCountdownChime } = await import("./countdown-chime")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { DEFAULT_STAGE_STYLE } = await import("@/lib/stage-style")

/**
 * #196 R2: what "time until" clocks count to, kept by the host; the stage's countdown line; and
 * Timekeeper's chime, on this computer only.
 */
const slide = (id: string, planned_minutes: number): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 25, h, m, s).getTime()
const stageOut = { id: "stage-1", name: "Stage", role: "stage", type: "display", themeId: "" } as unknown as BroadcastOutput
const mainOut = { id: "main", name: "Main", role: "congregation", type: "display", themeId: "" } as unknown as BroadcastOutput
const stagePayloads = () => emitTo.mock.calls.filter((c) => c[0] === "output-stage-1" || String(c[0]).includes("stage-1")).map((c) => (c[2] as { stage?: { aux?: unknown[] } }).stage)

beforeEach(() => {
  vi.useFakeTimers()
  // Welcome started at 10:20 (20 min late) and runs 5 min: Worship is expected at 10:25.
  vi.setSystemTime(at(10, 22, 50))
  useQueueStore.setState({ items: [slide("Welcome", 5), slide("Worship", 20)], headers: [{ id: "m", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }] })
  useEventClock.setState({ mode: "own", currentId: "Welcome", currentMomentId: "Welcome" })
  useJournalStore.setState({ entries: [{ at: at(10, 20), mono: 0, kind: "event", label: "Welcome", itemId: "Welcome" }] })
  useBroadcastStore.getState().loadThemes()
  useBroadcastStore.setState({ countdowns: null, stageCountdown: null, stageStyle: DEFAULT_STAGE_STYLE, outputs: [stageOut, mainOut], rehearsal: false })
  useSettingsStore.setState({ timekeeperCountdown: { to: "next", chime: false, chimeMinutes: 2 } })
  updateStageFinish()
  invoke.mockClear()
  emitTo.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("countdown targets on the host", () => {
  it("the next item's expected start, worked out from the run of show", () => {
    expect(useBroadcastStore.getState().countdowns?.next).toEqual({ label: "Worship", at: at(10, 25) })
    expect(useBroadcastStore.getState().countdowns?.end).toEqual({ label: "End of the main service", at: at(10, 45) })
  })

  it("the stage shows a countdown line only when its design asks for one", () => {
    refreshStageCountdown(at(10, 22, 50))
    expect(useBroadcastStore.getState().stageCountdown).toBeNull()
    useBroadcastStore.getState().saveStageStyle({ ...DEFAULT_STAGE_STYLE, countdown: "next" })
    refreshStageCountdown(at(10, 22, 50))
    expect(useBroadcastStore.getState().stageCountdown).toEqual({ label: "Next: Worship in", text: "2:10", tone: "ok" })
    // It reaches the stage output first on the timers' line, and the congregation output never.
    expect(stagePayloads().at(-1)?.aux?.[0]).toEqual({ label: "Next: Worship in", text: "2:10", tone: "ok" })
    const toMain = emitTo.mock.calls.filter((c) => String(c[0]).includes("main")).map((c) => JSON.stringify(c[2]))
    expect(toMain.some((p) => p.includes("Next: Worship"))).toBe(false)
  })
})

describe("Timekeeper's chime (fake timers)", () => {
  it("is off by default: nothing plays", () => {
    const play = vi.fn()
    const stop = startCountdownChime(play)
    vi.advanceTimersByTime(3 * 60_000)
    stop()
    expect(play).not.toHaveBeenCalled()
  })

  it("chimes at 2 minutes before the next item and at zero, once each", () => {
    useSettingsStore.getState().setTimekeeperCountdown({ chime: true })
    const play = vi.fn()
    const stop = startCountdownChime(play)
    vi.advanceTimersByTime(9_000) // 10:22:59
    expect(play).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2_000) // past 10:23:00
    expect(play.mock.calls).toEqual([["before"]])
    vi.advanceTimersByTime(2 * 60_000) // past 10:25:00
    expect(play.mock.calls).toEqual([["before"], ["zero"]])
    vi.advanceTimersByTime(60_000)
    expect(play).toHaveBeenCalledTimes(2)
    stop()
  })

  it("follows Timekeeper's milestone, and 'at zero only'", () => {
    useSettingsStore.getState().setTimekeeperCountdown({ chime: true, to: "end", chimeMinutes: 0 })
    const play = vi.fn()
    const stop = startCountdownChime(play)
    vi.advanceTimersByTime(5 * 60_000)
    expect(play).not.toHaveBeenCalled()
    vi.setSystemTime(at(10, 44, 58))
    checkCountdownChime(at(10, 44, 58), play)
    vi.advanceTimersByTime(3_000)
    expect(play.mock.calls).toEqual([["zero"]])
    stop()
  })

  it("never goes to an output: no frame, feed or NDI is sent for it", () => {
    useSettingsStore.getState().setTimekeeperCountdown({ chime: true })
    const play = vi.fn()
    const stop = startCountdownChime(play)
    vi.advanceTimersByTime(3 * 60_000)
    stop()
    expect(play).toHaveBeenCalledTimes(2)
    expect(emitTo).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("plays a short tone in this window's own audio: one before, two at zero", async () => {
    vi.useRealTimers()
    const oscillators: { start: number }[] = []
    const destination = {}
    class FakeAudio {
      currentTime = 5
      destination = destination
      resume = vi.fn(async () => {})
      createOscillator() {
        const o = { frequency: { value: 0 }, connect: (g: { connect: (d: unknown) => unknown }) => g, start: (t: number) => oscillators.push({ start: t }), stop: () => {} }
        return o
      }
      createGain() {
        return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (d: unknown) => { expect(d).toBe(destination); return d } }
      }
    }
    vi.stubGlobal("AudioContext", FakeAudio)
    playChime("before")
    await vi.waitFor(() => expect(oscillators).toHaveLength(1))
    playChime("zero")
    await vi.waitFor(() => expect(oscillators).toHaveLength(3))
    vi.unstubAllGlobals()
  })
})
