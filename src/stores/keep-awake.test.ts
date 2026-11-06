import { describe, expect, it, vi } from "vitest"

const invoke = vi.fn(async () => null)
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useTimerStore } = await import("@/stores/timer-store")
await import("@/stores/keep-awake")

const last = () => (invoke.mock.calls.at(-1) as unknown[] | undefined)?.[1]

describe("the computer stays awake while the service runs (#411 timing hunt)", () => {
  it("holds while on air, while the screens are off air for the sermon with the clock running, and lets go after", () => {
    useBroadcastStore.setState({ isLive: true })
    expect(last()).toEqual({ on: true })
    // Off air for the sermon: the service clock and timer keep going, so it stays awake.
    useEventClock.setState({ currentId: "sermon" })
    useBroadcastStore.setState({ isLive: false })
    expect(last()).toEqual({ on: true })
    useEventClock.setState({ currentId: null })
    expect(last()).toEqual({ on: false })
    // The timer alone, or an output alone, holds too.
    useTimerStore.setState({ timer: { ...useTimerStore.getState().timer, startedAt: 1 } })
    expect(last()).toEqual({ on: true })
    useTimerStore.setState({ timer: { ...useTimerStore.getState().timer, startedAt: null } })
    useBroadcastStore.setState({ outputStatus: { main: { previewOpen: true, ndiActive: false } } as never })
    expect(last()).toEqual({ on: true })
    const calls = invoke.mock.calls.length
    useBroadcastStore.setState({ stageMessage: "x" })
    expect(invoke.mock.calls.length).toBe(calls)
  })
})
