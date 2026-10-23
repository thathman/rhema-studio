import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { cueImpact } from "@/lib/cues"
import { resetTimerLogged } from "@/lib/timer-reset"
import { leaveRehearsal } from "@/stores/approval-gate-store"
import { tickerForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { useTimerStore } from "@/stores/timer-store"

/**
 * Rehearsal is a sandbox for the whole host (ADR 0001): the lower third, the ticker, the stage
 * message and the service timer come back as they were, and the service log keeps only what was real.
 */
beforeEach(() => {
  useBroadcastStore.setState({ rehearsal: false, rehearsalReturn: null, isLive: false, liveVerse: null, lowerThird: null, ticker: null, tickerItems: ["Prayer meeting Wednesday 6:30 PM"], stageMessage: "" })
  useJournalStore.setState({ entries: [] })
  useTimerStore.getState().reset()
})

describe("rehearsal is a sandbox (ARCH-003)", () => {
  it("a lower third, ticker and stage message set in rehearsal are gone after it; the real ones stay", () => {
    const b = useBroadcastStore.getState()
    b.setLowerThird({ line1: "Pastor Tolu", line2: "Senior pastor" })
    b.setRehearsal(true)
    b.setLowerThird({ line1: "Guest speaker", line2: "" })
    b.setStageMessage("Rehearsal note")
    b.setTicker({ backing: null })
    expect(tickerForScreens(useBroadcastStore.getState())).toBeNull()
    leaveRehearsal()
    const s = useBroadcastStore.getState()
    expect(s.lowerThird?.line1).toBe("Pastor Tolu")
    expect(s.stageMessage).toBe("")
    expect(s.ticker).toBeNull()
  })

  it("a ticker running before rehearsal keeps running on the screens through it", () => {
    const b = useBroadcastStore.getState()
    b.setTicker({ backing: null })
    const real = useBroadcastStore.getState().ticker
    b.setRehearsal(true)
    b.setTicker(null)
    expect(tickerForScreens(useBroadcastStore.getState())).toBe(real)
    leaveRehearsal()
    expect(useBroadcastStore.getState().ticker).toBe(real)
  })

  it("a timer reset in rehearsal touches neither the real timer nor the service log", () => {
    useTimerStore.getState().start()
    const real = useTimerStore.getState().timer
    useBroadcastStore.getState().setRehearsal(true)
    resetTimerLogged()
    useTimerStore.getState().start()
    leaveRehearsal()
    expect(useTimerStore.getState().timer).toEqual(real)
    expect(useJournalStore.getState().entries.map((e) => e.kind)).toEqual(["rehearsal", "rehearsal"])
  })
})

describe("cue steps say what they touch (C04)", () => {
  it("names each kind of effect once, in order, before the cue runs", () => {
    expect(cueImpact(["rehearsal.off", "timer.fresh", "quick.welcome"])).toEqual([
      "Leaves rehearsal: the real program comes back",
      "Changes the service timer",
      "Puts a screen over what the main screens show",
    ])
    expect(cueImpact(["quick.black", "ticker.stop"])).toEqual(["Covers every screen and feed", "Starts or stops the ticker"])
    expect(cueImpact(["next", "showLive"])).toEqual(["Changes what the main screens show"])
  })
})
