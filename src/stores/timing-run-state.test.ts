import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} })) }))

const { useHold, holdSpans } = await import("@/stores/hold-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useTimingTrust } = await import("@/stores/timing-trust-store")
const { useServiceOffset } = await import("@/stores/service-offset-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { restoreJournal, putBack } = await import("@/lib/live-recovery")
const { eventPlanStarts, eventTimes, serviceFinishedAt } = await import("@/lib/journal")
const { runStateNow, timingInputNow, churchTimeZone } = await import("@/stores/timing-input")
const { serviceTiming } = await import("@/lib/timing-engine")
const { monotonicNow } = await import("@/stores/timer-store")

const item = (id: string, planned_minutes: number): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes }) as unknown as QueueItem
const MIN = 60_000

describe("the run state, holds, finishing and trust after a restart (#196 R2.10, R3.7, R3.8)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] })
    vi.setSystemTime(new Date(2026, 9, 25, 9, 55))
    useQueueStore.setState({ items: [item("a", 5), item("b", 20), item("c", 30)], headers: [{ id: "main", type: "phase", name: "Service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }] })
    useBroadcastStore.setState({ isLive: false, liveItemId: null, rehearsal: false, stageMessage: "" })
    useEventClock.setState({ mode: "own", currentId: null, currentMomentId: null })
    useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0 })
    useHold.setState({ hold: null, past: [] })
    useTimingTrust.setState({ untrusted: null })
    useServiceOffset.setState({ minutes: 0, by: null, mode: "absorb" })
  })
  afterEach(() => vi.useRealTimers())

  it("goes idle → running → held → running → finished, and refuses what makes no sense", () => {
    expect(runStateNow()).toBe("idle")
    expect(useEventClock.getState().finish()).toBe("Nothing has started yet.")
    useEventClock.getState().start("a")
    expect(runStateNow()).toBe("running")
    vi.advanceTimersByTime(2 * MIN)
    expect(useHold.getState().start("Pulpit mic")).toBeNull()
    expect(runStateNow()).toBe("held")
    expect(useHold.getState().start("again")).toBe("Already on hold.")
    expect(useEventClock.getState().finish()).toBe("Resume first: the service is on hold.")
    vi.advanceTimersByTime(3 * MIN)
    useHold.getState().resume()
    expect(runStateNow()).toBe("running")
    expect(holdSpans()).toEqual([{ since: new Date(2026, 9, 25, 9, 57).getTime(), until: new Date(2026, 9, 25, 10, 0).getTime() }])
    useEventClock.getState().start("b")
    vi.advanceTimersByTime(10 * MIN)
    expect(useEventClock.getState().finish("Femi")).toBeNull()
    expect(runStateNow()).toBe("finished")
    expect(useEventClock.getState().currentId).toBeNull()
    expect(useHold.getState().start("late")).toBe("The service has finished.")
    // The finish stops the last item's clock; what never started is skipped.
    const entries = useJournalStore.getState().entries
    expect(serviceFinishedAt(entries)).toBe(Date.now())
    vi.advanceTimersByTime(5 * MIN)
    expect(eventTimes(entries, monotonicNow()).get("b")).toBe(10 * MIN)
    const t = serviceTiming(timingInputNow())!
    expect(t.events.map((e) => e.state)).toEqual(["done", "done", "skipped"])
    // Starting an item again opens the service again.
    useEventClock.getState().start("c")
    expect(runStateNow()).toBe("running")
  })

  it("holds feed the expected times through the one snapshot every view uses", () => {
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0))
    useEventClock.getState().start("a")
    useEventClock.getState().start("b")
    vi.advanceTimersByTime(5 * MIN)
    useHold.getState().start("Waiting")
    vi.advanceTimersByTime(4 * MIN)
    // Worship from 10:00 for 20 min, 4 min held so far: expected to end 10:24, the Sermon after it.
    const t = serviceTiming(timingInputNow())!
    expect(t.events[1]).toMatchObject({ heldMs: 4 * MIN, expectedEnd: new Date(2026, 9, 25, 10, 24).getTime() })
    expect(t.held).toBe(true)
  })

  it("event duration owns the service schedule while moments inside it change", () => {
    useQueueStore.setState({
      items: [item("sermon-scripture", 3), item("sermon-slides", 7), item("closing", 5)],
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, role: "main", starts_at: "10:00" },
        { id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1, duration_minutes: 40, approval: "approved" } },
        { id: "post", type: "phase", name: "Post-service", at: 2, role: "post" },
      ],
    })
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0))
    useEventClock.getState().start("sermon-scripture")
    vi.advanceTimersByTime(5 * MIN)
    useEventClock.getState().start("sermon-slides")

    const input = timingInputNow()
    expect(input.items.map((row) => [row.id, row.reference, row.planned_minutes])).toEqual([
      ["sermon", "Sermon", 40],
      ["closing", "closing", 5],
    ])
    expect(input.liveItemId).toBe("sermon")
    const timing = serviceTiming(input)!
    expect(timing.events[0]).toMatchObject({ id: "sermon", plannedEnd: new Date(2026, 9, 25, 10, 40).getTime(), state: "live" })
    expect(timing.sections.find((section) => section.id === "post")?.plannedStart).toBe(new Date(2026, 9, 25, 10, 40).getTime())
    expect(useEventClock.getState()).toMatchObject({ currentId: "sermon", currentMomentId: "sermon-slides" })
    expect(eventPlanStarts(useJournalStore.getState().entries).get("sermon")).toBe(new Date(2026, 9, 25, 10, 0).getTime())
    expect(eventTimes(useJournalStore.getState().entries, monotonicNow()).get("sermon")).toBe(5 * MIN)
    expect(useJournalStore.getState().entries.filter((entry) => entry.kind === "event")).toHaveLength(1)
  })

  it("uses the church's time zone from Setup when one is set", () => {
    useSettingsStore.getState().setSetup({ timeZone: "Africa/Lagos" })
    try {
      expect(churchTimeZone()).toBe("Africa/Lagos")
      expect(timingInputNow().timeZone).toBe("Africa/Lagos")
      useSettingsStore.getState().setSetup({ timeZone: "Not/AZone" })
      expect(churchTimeZone()).toBe("")
    } finally {
      useSettingsStore.getState().setSetup({ timeZone: "" })
    }
  })

  it("after a restart: the running item is not trusted until confirmed, and putting the screens back is not taking it again", async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 10, 20))
    const at = (m: number) => new Date(2026, 9, 25, 10, m).getTime()
    const kept = { v: 1 as const, at: at(19), startItemIds: null, entries: [
      { kind: "event" as const, label: "a", itemId: "a", at: at(0), mono: 0 },
      { kind: "event" as const, label: "b", itemId: "b", at: at(5), mono: 5 * MIN },
    ] }
    expect(restoreJournal(kept)).toBe(true)
    expect(useTimingTrust.getState().untrusted).toMatchObject({ itemId: "b", label: "b", lastSeen: at(19), restartedAt: at(20) })
    expect(runStateNow()).toBe("untrusted")
    const t = serviceTiming(timingInputNow())!
    expect(t.events[1]).toMatchObject({ state: "live", untrusted: true, actualStart: at(5) })
    // Putting the screens back starts the same event: still not trusted.
    await putBack({ v: 1, at: at(19), service: null, isLive: false, liveVerse: null, liveItemId: null, sources: {}, outputsOn: [], scenes: {}, eventId: "b" })
    expect(useEventClock.getState().currentId).toBe("b")
    expect(useTimingTrust.getState().untrusted).not.toBeNull()
    // "The time is right": trusted, and in the log.
    expect(useTimingTrust.getState().confirm("Femi")).toBeNull()
    expect(useTimingTrust.getState().untrusted).toBeNull()
    expect(runStateNow()).toBe("running")
    expect(useJournalStore.getState().entries.at(-1)!.label).toBe("Femi: time for b confirmed after Rhema Studio restarted")
    expect(useTimingTrust.getState().confirm()).toBe("Nothing to confirm.")
  })

  it("taking the item again clears the flag; a finished service had nothing running", () => {
    const at = (m: number) => new Date(2026, 9, 25, 10, m).getTime()
    vi.setSystemTime(new Date(2026, 9, 25, 10, 20))
    restoreJournal({ v: 1, at: at(19), startItemIds: null, entries: [{ kind: "event", label: "b", itemId: "b", at: at(5), mono: 0 }] })
    expect(useTimingTrust.getState().untrusted?.itemId).toBe("b")
    useEventClock.getState().retake("b")
    expect(useTimingTrust.getState().untrusted).toBeNull()

    useJournalStore.setState({ entries: [] })
    restoreJournal({ v: 1, at: at(19), startItemIds: null, entries: [{ kind: "event", label: "b", itemId: "b", at: at(5), mono: 0 }, { kind: "event", label: "Service finished", at: at(18), mono: 13 * MIN }] })
    expect(useTimingTrust.getState().untrusted).toBeNull()
  })

  it("the delay mode is logged with who chose it", () => {
    useServiceOffset.getState().setMode("push", "Femi")
    expect(useServiceOffset.getState().mode).toBe("push")
    expect(useJournalStore.getState().entries.at(-1)!.label).toMatch(/^Femi: lateness now pushes everything/)
    expect(timingInputNow().offsetMode).toBe("push")
  })
})
