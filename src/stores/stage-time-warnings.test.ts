import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useTimerStore } = await import("@/stores/timer-store")
const { checkStageWarnings } = await import("@/stores/stage-time-warnings")
const { DEFAULT_STAGE_STYLE } = await import("@/lib/stage-style")
const MIN = 60_000

/** A 10-minute timer started at monotonic 0. */
function timer(durationMin = 10) {
  useTimerStore.setState({ timer: { durationMs: durationMin * MIN, accumulatedMs: 0, startedAt: 0 } })
}

describe("time warnings on the stage (#196 R6)", () => {
  beforeEach(() => {
    useBroadcastStore.setState({ stageMessage: "", rehearsal: false, stageStyle: { ...DEFAULT_STAGE_STYLE, warnAtMinutes: 5, warnWhenOver: true } })
    useTimerStore.setState({ timer: { durationMs: 0, accumulatedMs: 0, startedAt: null } })
    checkStageWarnings(0)
  })

  it("says it once as each is crossed", () => {
    timer()
    checkStageWarnings(4 * MIN)
    expect(useBroadcastStore.getState().stageMessage).toBe("")
    checkStageWarnings(5 * MIN + 1000)
    expect(useBroadcastStore.getState().stageMessage).toBe("5 minutes left")
    useBroadcastStore.setState({ stageMessage: "" })
    checkStageWarnings(5 * MIN + 2000)
    expect(useBroadcastStore.getState().stageMessage).toBe("")
    // Its own warning is replaced by the next.
    useBroadcastStore.setState({ stageMessage: "5 minutes left" })
    checkStageWarnings(10 * MIN + 1000)
    expect(useBroadcastStore.getState().stageMessage).toBe("Time is up")
  })

  it("never covers a person's message, never in rehearsal, never when started past it, off by default", () => {
    timer()
    useBroadcastStore.setState({ stageMessage: "Wrap up after this point" })
    checkStageWarnings(5 * MIN + 1000)
    expect(useBroadcastStore.getState().stageMessage).toBe("Wrap up after this point")
    useBroadcastStore.setState({ stageMessage: "", rehearsal: true })
    checkStageWarnings(10 * MIN + 1000)
    expect(useBroadcastStore.getState().stageMessage).toBe("")
    useBroadcastStore.setState({ rehearsal: false })
    timer(3) // a 3-minute timer starts with less than 5 left
    checkStageWarnings(1000)
    expect(useBroadcastStore.getState().stageMessage).toBe("")
    useBroadcastStore.setState({ stageStyle: DEFAULT_STAGE_STYLE })
    timer(7)
    checkStageWarnings(2 * MIN + 1000)
    checkStageWarnings(7 * MIN + 1000)
    expect(useBroadcastStore.getState().stageMessage).toBe("")
  })
})
