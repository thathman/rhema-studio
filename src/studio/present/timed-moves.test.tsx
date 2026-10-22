// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { TimedMoves } from "./timed-moves"
import { useTimedAdvance } from "@/stores/timed-advance-store"

describe("timed moves countdown", () => {
  it("counts from when the move was set, not from when the switch first appeared", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<TimedMoves />))
    // The switch was shown long before this move was set.
    await act(async () => { vi.advanceTimersByTime(48_000) })
    act(() => useTimedAdvance.setState({ dueAt: Date.now() + 6_000 }))
    expect(el.querySelector("[role=timer]")?.textContent).toBe("Next in 0:06")
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(el.querySelector("[role=timer]")?.textContent).toBe("Next in 0:04")
    vi.useRealTimers()
  })
})
