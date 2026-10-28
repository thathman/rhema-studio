// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { buildLiveState, type LiveStateV1 } from "@/lib/live-state"
import { isRunning } from "@/lib/timer"
import { mayRunAuxTimer, timerPlans, timersFromPlans, useAuxTimers } from "@/stores/aux-timers-store"
import { useJoin } from "@/stores/join-store"
import { useJournalStore } from "@/stores/journal-store"
import { useServiceOffset } from "@/stores/service-offset-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { timeChangeWords, useTimeChange } from "@/stores/time-change-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { checkCountdownChime } from "@/stores/countdown-chime"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import type { Program } from "@/types"

/** #196 (stage-062): extra timers kept with the service and sent to desks, who changed the time last, the overtime chime. */
const program = (id: string): Program => ({ id, title: id, service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 })

let root: Root | null = null
beforeEach(() => {
  useServiceStore.setState({ current: null })
  useAuxTimers.setState({ timers: [] })
  useSettingsStore.setState({ serviceTimers: {}, joinAddress: "192.168.1.20:8080", joinToken: "t", timekeeperCountdown: { to: "next", chime: false, chimeMinutes: 2 } })
  useTimeChange.getState().clear()
  useJournalStore.setState({ entries: [] })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("extra timers saved with the service (R2.5)", () => {
  it("names, lengths, owners and on stage are kept with the open service and come back when it opens again", () => {
    useServiceStore.setState({ current: program("9am") })
    useAuxTimers.getState().add("Communion prep", 5, "worship")
    useAuxTimers.getState().add("Interpreter", 2.5)
    const [communion] = useAuxTimers.getState().timers
    useAuxTimers.getState().setOnStage(communion.id, true)
    useAuxTimers.getState().toggle(communion.id)
    expect(useSettingsStore.getState().serviceTimers["9am"]).toEqual([
      { id: communion.id, label: "Communion prep", minutes: 5, owner: "worship", onStage: true },
      { id: expect.any(String), label: "Interpreter", minutes: 2.5 },
    ])
    // Another service: its own (none); back again: the same timers, ready to start.
    useServiceStore.setState({ current: program("11am") })
    expect(useAuxTimers.getState().timers).toEqual([])
    useServiceStore.setState({ current: program("9am") })
    const back = useAuxTimers.getState().timers
    expect(back.map((t) => [t.id, t.label, t.owner, t.onStage, isRunning(t.timer), t.timer.durationMs])).toEqual([[communion.id, "Communion prep", "worship", true, false, 5 * 60_000], [expect.any(String), "Interpreter", "", false, false, 150_000]])
  })

  it("without a service they last for the session; older saved plans and odd values read safely", () => {
    useAuxTimers.getState().add("Prayer", 3)
    expect(useSettingsStore.getState().serviceTimers).toEqual({})
    expect(timersFromPlans([{ id: "a", label: "  Long  ", minutes: 9999 }])[0]).toMatchObject({ label: "Long", owner: "", onStage: false, timer: { durationMs: 600 * 60_000 } })
    expect(timerPlans(timersFromPlans([{ id: "a", label: "A", minutes: 1, owner: "stage" }]))).toEqual([{ id: "a", label: "A", minutes: 1, owner: "stage" }])
  })

  it("who may run one: the timekeeping desks always, its own role too, nobody else", () => {
    expect(["timekeeper", "present", "configure"].every((r) => mayRunAuxTimer(r, "worship"))).toBe(true)
    expect(mayRunAuxTimer("worship", "worship")).toBe(true)
    expect(mayRunAuxTimer("bible", "worship")).toBe(false)
    expect(mayRunAuxTimer("worship", "")).toBe(false)
  })

  it("a desk's start, pause and reset (checked by the host's server) are logged with who", () => {
    useAuxTimers.getState().add("Communion prep", 5, "worship")
    const id = useAuxTimers.getState().timers[0].id
    useAuxTimers.getState().remote(id, "start", "Worship desk")
    expect(isRunning(useAuxTimers.getState().timers[0].timer)).toBe(true)
    useAuxTimers.getState().remote(id, "start", "Worship desk") // already running: nothing more
    useAuxTimers.getState().remote(id, "pause", "Timekeeper")
    useAuxTimers.getState().remote(id, "delete", "Timekeeper") // not an action
    expect(useJournalStore.getState().entries.map((e) => e.label)).toEqual(["Worship desk: extra timer “Communion prep” started", "Timekeeper: extra timer “Communion prep” paused"])
  })
})

describe("joined desks get the extra timers and who changed the time (R2.5, R2.9)", () => {
  async function renderDesk(live: LiveStateV1, role: string) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useJoin.setState({ status: "connected", me: { name: "Desk", role }, live, receivedAt: performance.now(), clockSkewMs: 0, error: null, paused: false, note: null })
    const el = document.body.appendChild(document.createElement("div"))
    root = createRoot(el)
    await act(async () => root!.render(<OperatorsPanel />))
    return el
  }

  it("the Live State carries each timer with its owner and how far it has run, and the last change", () => {
    useAuxTimers.getState().add("Communion prep", 5, "worship")
    useServiceOffset.getState().adjust(5, "Desk A")
    const live = buildLiveState()
    expect(live.auxTimers).toEqual([{ id: expect.any(String), label: "Communion prep", owner: "worship", durationMs: 5 * 60_000, elapsedMs: 0, running: false }])
    expect(live.timeChange).toMatchObject({ what: "+5 min (running 5 min late)", by: "Desk A" })
    useServiceOffset.getState().reset("Desk A")
  })

  it("read only on a Bible desk; Start and Reset on the worship desk that owns it and on the Timekeeper", async () => {
    useAuxTimers.getState().add("Communion prep", 5, "worship")
    const live = buildLiveState()
    for (const [role, buttons] of [["bible", 0], ["worship", 2], ["timekeeper", 2]] as const) {
      const el = await renderDesk(live, role)
      const section = el.querySelector<HTMLElement>('section[aria-label="Extra timers"]')
      expect(section?.textContent).toContain("Communion prep")
      expect(section!.querySelectorAll("button")).toHaveLength(buttons)
      if (!buttons) expect(section!.textContent).toContain("read only")
      act(() => root?.unmount())
      root = null
      document.body.innerHTML = ""
    }
  })

  it("the Timekeeper desk says who last changed the time and when", async () => {
    useTimerStore.getState().adjustMinutes(-1, "Femi")
    const el = await renderDesk(buildLiveState(), "timekeeper")
    const line = el.querySelector('[aria-label="Last change to the time"]')
    expect(line?.textContent).toMatch(/^Last change: timer corrected by −1 min · by Femi at .+ \(just now\)$/)
    expect(timeChangeWords({ what: "+5 min", by: null, at: 0 }, 3 * 60_000, () => "10:00")).toBe("+5 min · by the main desk at 10:00 (3 min ago)")
  })
})

describe("the overtime chime (R2.8)", () => {
  it("plays once as the running service timer reaches zero, only when turned on", () => {
    const play = vi.fn()
    const now = Date.now()
    // A 1-minute timer started 59.5 s ago: it reaches zero half a second from now.
    useTimerStore.setState({ timer: { durationMs: 60_000, startedAt: monotonicNow() - 59_500, accumulatedMs: 0 } })
    checkCountdownChime(now, play)
    checkCountdownChime(now + 1000, play)
    expect(play).not.toHaveBeenCalled()
    useSettingsStore.getState().setTimekeeperCountdown({ overtimeChime: true })
    // Looked at with half a second to go, then a second later (half a second over), then again.
    const runFor = (ms: number) => useTimerStore.setState({ timer: { durationMs: 60_000, startedAt: monotonicNow() - ms, accumulatedMs: 0 } })
    runFor(59_500)
    checkCountdownChime(now + 2000, play)
    expect(play).not.toHaveBeenCalled()
    runFor(60_500)
    checkCountdownChime(now + 3000, play)
    runFor(61_500)
    checkCountdownChime(now + 4000, play)
    expect(play.mock.calls).toEqual([["over"]])
  })
})
