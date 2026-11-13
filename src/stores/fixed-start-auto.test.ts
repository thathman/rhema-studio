import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))
const clock = vi.hoisted(() => ({ now: 0 }))
const FIXED = 10 * 60 * 60_000
vi.mock("@/stores/timing-input", () => ({ timingInputNow: () => ({ now: clock.now }) }))
vi.mock("@/lib/timing-engine", () => ({
  serviceTiming: () => ({ events: [
    { id: "welcome", label: "Welcome", state: "live", fixedStart: null },
    { id: "sermon", label: "Sermon", state: "upcoming", fixedStart: FIXED },
  ] }),
}))
const start = vi.fn()
vi.mock("@/stores/event-clock-store", () => ({ useEventClock: { getState: () => ({ currentId: "welcome", start }) } }))

import { checkFixedStarts, useFixedStartAuto } from "@/stores/fixed-start-auto-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useHold } from "@/stores/hold-store"

beforeEach(() => {
  start.mockClear()
  useFixedStartAuto.setState({ armed: null, started: [] })
  useBroadcastStore.setState({ rehearsal: false })
  if (useHold.getState().hold) useHold.getState().resume()
})

describe("fixed starts kept by the clock (#196)", () => {
  it("does nothing until armed, then starts the event at its fixed start, once", () => {
    clock.now = FIXED
    checkFixedStarts()
    expect(start).not.toHaveBeenCalled()
    useFixedStartAuto.getState().arm("Timekeeper")
    clock.now = FIXED - 1_000
    checkFixedStarts()
    expect(start).not.toHaveBeenCalled()
    clock.now = FIXED + 1_000
    checkFixedStarts()
    checkFixedStarts()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith("sermon")
  })

  it("never late: past two minutes it leaves the event to the Timekeeper", () => {
    useFixedStartAuto.getState().arm("Timekeeper")
    clock.now = FIXED + 3 * 60_000
    checkFixedStarts()
    expect(start).not.toHaveBeenCalled()
  })

  it("waits in rehearsal and on a Hold", () => {
    useFixedStartAuto.getState().arm("Timekeeper")
    clock.now = FIXED + 1_000
    useBroadcastStore.setState({ rehearsal: true })
    checkFixedStarts()
    useBroadcastStore.setState({ rehearsal: false })
    useHold.getState().start("Waiting")
    checkFixedStarts()
    expect(start).not.toHaveBeenCalled()
    useHold.getState().resume()
    checkFixedStarts()
    expect(start).toHaveBeenCalledTimes(1)
  })
})
