import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))
const FIXED = 10 * 60 * 60_000
type Ev = { id: string; label: string; state: string; fixedStart: number | null; milestone: boolean; conflict: boolean }
const world = vi.hoisted(() => ({ now: 0, run: "running", mode: "own", events: [] as Ev[] }))
vi.mock("@/stores/timing-input", () => ({ timingInputNow: () => ({ now: world.now }), runStateNow: () => world.run }))
vi.mock("@/lib/timing-engine", () => ({ serviceTiming: () => ({ events: world.events }) }))
const start = vi.fn()
vi.mock("@/stores/event-clock-store", () => ({ useEventClock: { getState: () => ({ mode: world.mode, start }) } }))

import { checkFixedStarts, useFixedStartAuto } from "@/stores/fixed-start-auto-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useHold } from "@/stores/hold-store"

const ev = (id: string, state: string, fixedStart: number | null = null, more: Partial<Ev> = {}): Ev => ({ id, label: id, state, fixedStart, milestone: false, conflict: false, ...more })

beforeEach(() => {
  start.mockClear()
  Object.assign(world, { now: 0, run: "running", mode: "own", events: [ev("welcome", "live"), ev("sermon", "upcoming", FIXED)] })
  useFixedStartAuto.setState({ armed: null, started: [] })
  useBroadcastStore.setState({ rehearsal: false })
  if (useHold.getState().hold) useHold.getState().resume()
})

const arm = (at = FIXED - 60_000) => { vi.setSystemTime(at); useFixedStartAuto.getState().arm("Timekeeper"); vi.useRealTimers() }

describe("fixed starts kept by the clock (#196, ADR 25 §8.9)", () => {
  it("does nothing until armed, then starts the next event at its fixed start, once", () => {
    vi.useFakeTimers()
    world.now = FIXED
    checkFixedStarts()
    expect(start).not.toHaveBeenCalled()
    vi.useFakeTimers(); arm()
    world.now = FIXED - 1_000
    checkFixedStarts()
    world.now = FIXED + 1_000
    checkFixedStarts()
    checkFixedStarts()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith("sermon")
  })

  it("never late, never out of order, never a late or milestone event, never a start from before arming", () => {
    vi.useFakeTimers(); arm()
    world.now = FIXED + 3 * 60_000
    checkFixedStarts()
    world.now = FIXED + 1_000
    world.events = [ev("welcome", "live"), ev("notices", "upcoming"), ev("sermon", "upcoming", FIXED)]
    checkFixedStarts()
    world.events = [ev("welcome", "live"), ev("sermon", "upcoming", FIXED, { conflict: true })]
    checkFixedStarts()
    world.events = [ev("welcome", "live"), ev("sermon", "upcoming", FIXED, { milestone: true })]
    checkFixedStarts()
    expect(start).not.toHaveBeenCalled()
    useFixedStartAuto.setState({ armed: null })
    vi.useFakeTimers(); arm(FIXED + 30_000)
    world.events = [ev("welcome", "live"), ev("sermon", "upcoming", FIXED)]
    checkFixedStarts()
    expect(start).not.toHaveBeenCalled()
  })

  it("waits in rehearsal, on a Hold, when the screens drive the clock, before the service runs, and while untrusted", () => {
    vi.useFakeTimers(); arm()
    world.now = FIXED + 1_000
    useBroadcastStore.setState({ rehearsal: true })
    checkFixedStarts()
    useBroadcastStore.setState({ rehearsal: false })
    useHold.getState().start("Waiting")
    checkFixedStarts()
    useHold.getState().resume()
    world.mode = "screens"
    checkFixedStarts()
    world.mode = "own"
    for (const run of ["idle", "untrusted"]) { world.run = run; checkFixedStarts() }
    expect(start).not.toHaveBeenCalled()
    world.run = "running"
    checkFixedStarts()
    expect(start).toHaveBeenCalledTimes(1)
  })
})
