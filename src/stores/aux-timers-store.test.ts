import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

const { MAX_AUX_TIMERS, stageAuxLines, useAuxTimers } = await import("./aux-timers-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { isRunning } = await import("@/lib/timer")

describe("auxiliary timers (issue #196 R2.5)", () => {
  it("count down on their own, amber in the last two minutes, red and negative once over", () => {
    const t = { id: "c", label: "Communion prep", onStage: true, owner: "", timer: { durationMs: 5 * 60_000, startedAt: 0, accumulatedMs: 0 } }
    expect(stageAuxLines([t], 4 * 60_000)).toEqual([{ label: "Communion prep", text: "1:00", tone: "warn" }])
    expect(stageAuxLines([t], 6 * 60_000)).toEqual([{ label: "Communion prep", text: "−1:00", tone: "over" }])
    expect(stageAuxLines([{ ...t, onStage: false }], 0)).toEqual([])
  })

  it("start and pause one without touching the others; at most four; the stage gets the ones marked", () => {
    for (const n of ["A", "B", "C", "D", "E"]) useAuxTimers.getState().add(n, 5)
    const timers = useAuxTimers.getState().timers
    expect(timers.map((t) => t.label)).toEqual(["A", "B", "C", "D"].slice(0, MAX_AUX_TIMERS))
    useAuxTimers.getState().toggle(timers[0].id)
    expect(useAuxTimers.getState().timers.map((t) => isRunning(t.timer))).toEqual([true, false, false, false])
    useAuxTimers.getState().setOnStage(timers[1].id, true)
    expect(useBroadcastStore.getState().stageAux).toEqual([{ label: "B", text: "5:00", tone: "ok" }])
    useAuxTimers.getState().remove(timers[1].id)
    expect(useBroadcastStore.getState().stageAux).toEqual([])
    useAuxTimers.getState().toggle(timers[0].id)
    expect(isRunning(useAuxTimers.getState().timers[0].timer)).toBe(false)
  })
})
