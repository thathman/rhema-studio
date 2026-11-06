import { describe, expect, it, vi } from "vitest"

const invoke = vi.fn(async () => null)
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
await import("@/stores/keep-awake")

describe("the computer stays awake while the service is live (#411 timing hunt)", () => {
  it("holds when the service goes live and lets go when it ends", () => {
    invoke.mockClear()
    useBroadcastStore.setState({ isLive: true })
    expect(invoke).toHaveBeenLastCalledWith("keep_awake", { on: true })
    useBroadcastStore.setState({ isLive: false })
    expect(invoke).toHaveBeenLastCalledWith("keep_awake", { on: false })
    const calls = invoke.mock.calls.length
    useBroadcastStore.setState({ stageMessage: "x" })
    expect(invoke.mock.calls.length).toBe(calls)
  })
})
