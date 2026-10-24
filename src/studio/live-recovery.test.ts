import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }))
/** recovery.json, in memory. */
const kept = new Map<string, unknown>()
const fakeStore = { get: vi.fn(async (k: string) => kept.get(k)), set: vi.fn(async (k: string, v: unknown) => void kept.set(k, v)), save: vi.fn(async () => {}) }
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => fakeStore) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useTimerStore } = await import("@/stores/timer-store")
const { takeSnapshot, worthOffering, putBack, useRecovery, restoreJournal, restoreNotices, startLiveRecovery, dismissRecovery } = await import("@/lib/live-recovery")
const { useNotices } = await import("@/stores/notices-store")
const { invoke } = await import("@tauri-apps/api/core")
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

  it("Not now hides the offer but keeps it for the Desk menu until it is put back (#299 1.18)", async () => {
    const snap = { ...takeSnapshot(), eventId: null, outputsOn: [] }
    useRecovery.setState({ offer: snap, dismissed: false })
    dismissRecovery()
    expect(useRecovery.getState()).toMatchObject({ offer: snap, dismissed: true })
    await putBack(snap)
    expect(useRecovery.getState()).toEqual({ offer: null, dismissed: false })
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
    // This run logged a scene at start-up before the kept log was read: it stays, after them.
    useJournalStore.getState().add({ kind: "scene", label: "Main Display: Pulpit camera" })
    expect(restoreJournal(kept, at + 700_000, 1_000)).toBe(true)
    const { entries, startItemIds } = useJournalStore.getState()
    expect(startItemIds).toEqual(["a", "b"])
    expect(entries.map((e) => e.kind)).toEqual(["event", "event", "scene", "recovery"])
    // Rebased on this run's clock: 4 min apart as before.
    expect(entries[1].mono - entries[0].mono).toBe(240_000)
    expect(entries[0].mono).toBe(at - (at + 700_000 - 1_000))
    // Only once, never an old one.
    expect(restoreJournal(kept, at + 700_000, 1_000)).toBe(false)
    expect(useJournalStore.getState().entries).toHaveLength(4)
    useJournalStore.setState({ entries: [] })
    expect(restoreJournal(kept, at + 7 * 3_600_000, 1_000)).toBe(false)
  })

  it("keeps the last 100 notices with their answers and brings them back once after a crash (Comms)", async () => {
    const now = Date.now()
    const notice = (id: string, at: number) => ({ id, from: "Main desk", to: "bible" as const, priority: "normal" as const, text: `Notice ${id}`, event: null, action: null, at, answers: [{ by: "Ade", state: "ready" as const, at }] })
    const before = { v: 1 as const, at: now - 60_000, notices: [notice("b", now - 90_000), notice("a", now - 120_000)], read: ["a"] }
    // Never an old one or an empty one.
    expect(restoreNotices({ ...before, at: now - 7 * 3_600_000 }, now)).toBe(false)
    expect(restoreNotices({ ...before, notices: [] }, now)).toBe(false)
    useNotices.setState({ notices: [], read: [] })
    const since = useNotices.getState().send({ from: "Femi", to: "host", text: "Sent since the restart" })!
    kept.set("notices", before)
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "last_exit_unclean" ? true : null))
    const stop = await startLiveRecovery()
    // Back behind what was sent since, answers and all; read stays read.
    expect(useNotices.getState().notices.map((n) => n.id)).toEqual([since.id, "b", "a"])
    expect(useNotices.getState().notices[1].answers).toEqual(before.notices[0].answers)
    expect(useNotices.getState().read).toEqual(["a"])
    expect(restoreNotices(before, now)).toBe(false)
    expect(useNotices.getState().notices).toHaveLength(3)

    // Kept as they change, bounded like the host's own list.
    vi.useFakeTimers()
    try {
      for (let i = 0; i < 110; i++) useNotices.getState().send({ from: "x", text: `n${i}` })
      vi.advanceTimersByTime(3000)
      const saved = kept.get("notices") as { v: number; notices: unknown[]; read: string[] }
      expect(saved.v).toBe(1)
      expect(saved.notices).toHaveLength(100)
      expect(saved.read).toEqual([])
    } finally {
      vi.useRealTimers()
      stop()
      vi.mocked(invoke).mockImplementation(async () => null)
    }
  })
})
