import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useTimerStore } = await import("@/stores/timer-store")
const { takeSnapshot, worthOffering, putBack, useRecovery, restoreJournal } = await import("@/lib/live-recovery")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

/** Recovery after an unexpected close (#246): offered, never automatic; puts back what was up. */
beforeEach(() => {
  const themeId = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, sources: {}, rehearsal: false, scenes: [], outputStatus: {},
    outputs: [{ id: MAIN_OUTPUT_ID, name: "Projector", type: "display", themeId, monitorIndex: 0, ndi: defaultNdiSettings() }],
  })
  useJournalStore.setState({ entries: [] })
})

describe("live recovery", () => {
  it("snapshots what is on the screens and offers it only when recent and something was up", () => {
    useBroadcastStore.getState().setLiveVerse({ reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" }, null, { goLive: true })
    useBroadcastStore.getState().setOutputStatus(MAIN_OUTPUT_ID, { previewOpen: true, ndiActive: false })
    const snap = takeSnapshot(1_000_000)
    expect(snap).toMatchObject({ v: 1, isLive: true, outputsOn: [MAIN_OUTPUT_ID] })
    expect(snap.liveVerse?.reference).toBe("Romans 8:28")
    expect(snap.sources.bible?.value.reference).toBe("Romans 8:28")
    expect(worthOffering(snap, 1_000_000 + 60_000)).toBe(true)
    expect(worthOffering(snap, 1_000_000 + 7 * 3_600_000)).toBe(false)
    expect(worthOffering({ ...snap, isLive: false, outputsOn: [] }, 1_000_000)).toBe(false)
    expect(worthOffering(null)).toBe(false)
    // A huge picture as data keeps the names only.
    useBroadcastStore.getState().setLiveVerse({ reference: "Notices", segments: [], content: "picture", image: { url: "data:image/png;base64," + "A".repeat(500_000) } } as never, null, { goLive: true })
    expect(takeSnapshot().liveVerse).toBeNull()
  })

  it("puts back the program, its sources and the event, and logs it", async () => {
    useBroadcastStore.getState().setLiveVerse({ reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" }, null, { goLive: true })
    useEventClock.setState({ currentId: null })
    const snap = { ...takeSnapshot(), eventId: null, outputsOn: [] }
    useBroadcastStore.setState({ isLive: false, liveVerse: null, sources: {} })
    useRecovery.setState({ offer: snap })
    useJournalStore.setState({ entries: [] })
    await putBack(snap)
    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(true)
    expect(b.liveVerse?.reference).toBe("Romans 8:28")
    expect(b.sources.bible?.on).toBe(true)
    expect(useRecovery.getState().offer).toBeNull()
    expect(useJournalStore.getState().entries.some((e) => e.kind === "recovery")).toBe(true)
  })

  it("puts the timer back, counting the time Rhema was closed while it ran", async () => {
    useTimerStore.getState().reset()
    const snap = { ...takeSnapshot(), at: Date.now() - 90_000, outputsOn: [], eventId: null, timer: { durationMs: 35 * 60_000, elapsedMs: 600_000, running: true } }
    await putBack(snap)
    const t = useTimerStore.getState().timer
    expect(t.durationMs).toBe(35 * 60_000)
    expect(t.startedAt).not.toBeNull()
    expect(Math.round(t.accumulatedMs / 1000)).toBe(690)
    // A timer started since is left alone.
    useTimerStore.setState({ timer: { durationMs: 60_000, accumulatedMs: 5_000, startedAt: null } })
    await putBack({ ...snap, timer: { durationMs: 1, elapsedMs: 1, running: false } })
    expect(useTimerStore.getState().timer.durationMs).toBe(60_000)
    useTimerStore.getState().reset()
  })

  it("a trimmed snapshot (pictures as data) leaves the sources on now alone", async () => {
    useBroadcastStore.getState().setLiveVerse({ reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" }, null, { goLive: true })
    const before = useBroadcastStore.getState().sources
    await putBack({ ...takeSnapshot(), liveVerse: null, sources: {}, trimmed: true, outputsOn: [], eventId: null })
    expect(useBroadcastStore.getState().sources).toBe(before)
  })

  it("brings back the service log after a crash, with durations still adding up", () => {
    const at = 1_000_000_000
    const kept = { v: 1 as const, at: at + 600_000, startItemIds: ["a", "b"], entries: [
      { at, mono: 5, kind: "event" as const, label: "Welcome", itemId: "a" },
      { at: at + 240_000, mono: 240_005, kind: "event" as const, label: "Sermon", itemId: "b" },
    ] }
    expect(restoreJournal(kept, at + 700_000, 1_000)).toBe(true)
    const { entries, startItemIds } = useJournalStore.getState()
    expect(startItemIds).toEqual(["a", "b"])
    expect(entries.map((e) => e.kind)).toEqual(["event", "event", "recovery"])
    // Rebased on this run's clock: 4 min apart as before.
    expect(entries[1].mono - entries[0].mono).toBe(240_000)
    expect(entries[0].mono).toBe(at - (at + 700_000 - 1_000))
    // Never over a log that has begun, never an old one.
    expect(restoreJournal(kept, at + 700_000, 1_000)).toBe(false)
    useJournalStore.setState({ entries: [] })
    expect(restoreJournal(kept, at + 7 * 3_600_000, 1_000)).toBe(false)
  })
})
