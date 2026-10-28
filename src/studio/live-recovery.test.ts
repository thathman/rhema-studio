import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []), getAllWindows: vi.fn(async () => []) }))
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn(async () => {}), error: vi.fn(async () => {}) }))
/** recovery.json, in memory. */
const kept = new Map<string, unknown>()
const fakeStore = { get: vi.fn(async (k: string) => kept.get(k)), set: vi.fn(async (k: string, v: unknown) => void kept.set(k, v)), save: vi.fn(async () => {}) }
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => fakeStore) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useTimerStore } = await import("@/stores/timer-store")
const { takeSnapshot, worthOffering, putBack, useRecovery, restoreJournal, restoreNotices, startLiveRecovery, dismissRecovery, acceptPartialRecovery, parseLiveSnapshot } = await import("@/lib/live-recovery")
const { useNotices } = await import("@/stores/notices-store")
const { invoke } = await import("@tauri-apps/api/core")
const { getAllWindows } = await import("@tauri-apps/api/window")
const { MAIN_OUTPUT_ID, defaultNdiSettings, outputWindowLabel } = await import("@/types")

/** Recovery after an unexpected close (#246): offered, never automatic; puts back what was up. */
beforeEach(() => {
  kept.clear()
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockImplementation(async () => null)
  vi.mocked(getAllWindows).mockReset()
  vi.mocked(getAllWindows).mockResolvedValue([])
  const themeId = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, sources: {}, rehearsal: false, scenes: [], outputStatus: {},
    outputs: [{ id: MAIN_OUTPUT_ID, name: "Projector", type: "display", themeId, monitorIndex: 0, ndi: defaultNdiSettings() }],
  })
  useJournalStore.setState({ entries: [] })
  useEventClock.setState({ mode: "screens", currentId: null, currentMomentId: null })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null })
  useTimerStore.getState().reset()
  useRecovery.setState({ offer: null, dismissed: false, damaged: false, restoreError: null })
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
    useEventClock.setState({ currentId: null, currentMomentId: null })
    const snap = { ...takeSnapshot(), eventId: null, outputsOn: [] }
    useBroadcastStore.setState({ isLive: false, liveVerse: null, sources: {} })
    useRecovery.setState({ offer: snap })
    useJournalStore.setState({ entries: [] })
    expect(await putBack(snap)).toBe(true)
    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(true)
    expect(b.liveVerse?.reference).toBe("Romans 8:28")
    expect(b.sources.bible?.on).toBe(true)
    expect(useRecovery.getState().offer).toBeNull()
    expect(useJournalStore.getState().entries.some((e) => e.kind === "recovery")).toBe(true)
  })

  it("keeps recovery pending when an output cannot be brought back", async () => {
    const snap = {
      ...takeSnapshot(),
      isLive: true,
      liveVerse: { reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" as const },
      outputsOn: [MAIN_OUTPUT_ID],
      eventId: null,
    }
    useRecovery.setState({ offer: snap, dismissed: false })
    useJournalStore.setState({ entries: [] })

    expect(await putBack(snap)).toBe(false)

    expect(useRecovery.getState().offer).toMatchObject(snap)
    expect(useJournalStore.getState().entries.some((entry) => entry.kind === "recovery")).toBe(false)
    expect(useBroadcastStore.getState().outputStatus[MAIN_OUTPUT_ID]?.previewOpen).toBe(false)
  })

  it("restores the event clock and timer on the first partial attempt without restarting them on retry", async () => {
    useQueueStore.setState({
      items: [{ id: "recovery-event", kind: "slide", slide: { title: "Service", body: "" }, reference: "Service", confidence: 1, source: "manual", added_at: 0 } as never],
      headers: [],
      activeIndex: null,
    })
    const snap = {
      ...takeSnapshot(),
      isLive: true,
      liveVerse: { reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" as const },
      liveItemId: null,
      outputsOn: [MAIN_OUTPUT_ID],
      eventId: "recovery-event",
      timer: { durationMs: 600_000, elapsedMs: 120_000, running: true },
    }
    useRecovery.setState({ offer: snap, dismissed: false })

    expect(await putBack(snap)).toBe(false)
    expect(useEventClock.getState().currentId).toBe("recovery-event")
    const startedAt = useTimerStore.getState().timer.startedAt
    expect(startedAt).not.toBeNull()
    expect(useTimerStore.getState().timer.durationMs).toBe(600_000)
    expect(useJournalStore.getState().entries.filter((entry) => entry.kind === "event")).toHaveLength(1)

    expect(await putBack(snap)).toBe(false)
    expect(useEventClock.getState().currentId).toBe("recovery-event")
    expect(useTimerStore.getState().timer.startedAt).toBe(startedAt)
    expect(useJournalStore.getState().entries.filter((entry) => entry.kind === "event")).toHaveLength(1)
  })

  it("reports an output from the snapshot that is no longer configured", async () => {
    const snap = { ...takeSnapshot(), isLive: false, outputsOn: ["removed-projector"], eventId: null }
    useRecovery.setState({ offer: snap, dismissed: false })
    useJournalStore.setState({ entries: [] })

    expect(await putBack(snap)).toBe(false)

    expect(useRecovery.getState().offer).toMatchObject(snap)
    expect(useRecovery.getState().restoreError).toContain("Saved output configuration is no longer available for removed-projector")
    expect(useRecovery.getState().restoreError).not.toContain("Check the display or device connection")
    expect(useJournalStore.getState().entries.some((entry) => entry.kind === "recovery")).toBe(false)
  })

  it("reports a missing saved scene separately from an output that failed to start", async () => {
    const snap = { ...takeSnapshot(), eventId: null, outputsOn: [], scenes: { [MAIN_OUTPUT_ID]: "removed-scene" } }
    useRecovery.setState({ offer: snap, dismissed: false })

    expect(await putBack(snap)).toBe(false)

    expect(useRecovery.getState().restoreError).toContain("The saved scene is no longer available")
    expect(useRecovery.getState().restoreError).toContain("Projector (ID: removed-scene)")
    expect(useRecovery.getState().restoreError).not.toContain("Check the display or device connection")
    expect(useJournalStore.getState().entries.some((entry) => entry.kind === "recovery")).toBe(false)
  })

  it("retries only unresolved outputs without duplicating scene or source activations", async () => {
    const state = useBroadcastStore.getState()
    const sideOutput = { ...state.outputs[0], id: "side-display", name: "Side Projector", monitorIndex: 1 }
    useBroadcastStore.setState({ outputs: [...state.outputs, sideOutput] })
    const { newScene, SCENE_PRESETS } = await import("@/lib/scenes")
    const scene = newScene("Pulpit", SCENE_PRESETS[0])
    useBroadcastStore.getState().saveScene(scene)
    const live = { reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" as const }
    useBroadcastStore.getState().setLiveVerse(live, null, { goLive: true })
    const snap = { ...takeSnapshot(), outputsOn: [MAIN_OUTPUT_ID, sideOutput.id], scenes: { [MAIN_OUTPUT_ID]: scene.id }, eventId: null }
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, sources: {}, outputStatus: {} })
    useRecovery.setState({ offer: snap, dismissed: false })
    useJournalStore.setState({ entries: [] })
    const visible = new Set([MAIN_OUTPUT_ID])
    vi.mocked(getAllWindows).mockImplementation(async () => [...visible].map((id) => ({ label: outputWindowLabel(id), isVisible: async () => true } as never)))

    expect(await putBack(snap)).toBe(false)
    expect(useRecovery.getState().offer).toMatchObject(snap)
    expect(useRecovery.getState().restoreError).toContain("Side Projector")
    const sceneRevision = useBroadcastStore.getState().sceneTakes[MAIN_OUTPUT_ID]?.revision
    const sourceRevision = useBroadcastStore.getState().sources.bible?.revision

    visible.add(sideOutput.id)
    expect(await putBack(snap)).toBe(true)

    expect(useRecovery.getState().offer).toBeNull()
    expect(useJournalStore.getState().entries.filter((entry) => entry.kind === "recovery")).toHaveLength(1)
    expect(useBroadcastStore.getState().sceneTakes[MAIN_OUTPUT_ID]?.revision).toBe(sceneRevision)
    expect(useBroadcastStore.getState().sources.bible?.revision).toBe(sourceRevision)
    const opened = vi.mocked(invoke).mock.calls.filter(([command]) => command === "open_broadcast_window").map(([, args]) => (args as { outputId: string }).outputId)
    expect(opened).toEqual([MAIN_OUTPUT_ID, sideOutput.id, sideOutput.id])
  })

  it("Not now hides the offer but preserves its failed-output reason for the Desk menu", async () => {
    const snap = { ...takeSnapshot(), eventId: null, outputsOn: [MAIN_OUTPUT_ID] }
    useRecovery.setState({ offer: snap, dismissed: false })
    expect(await putBack(snap)).toBe(false)
    const error = useRecovery.getState().restoreError
    expect(error).toContain("Projector")
    dismissRecovery()
    expect(useRecovery.getState()).toMatchObject({ offer: snap, dismissed: true, restoreError: error })
    vi.mocked(getAllWindows).mockResolvedValue([{ label: outputWindowLabel(MAIN_OUTPUT_ID), isVisible: async () => true } as never])
    expect(await putBack(snap)).toBe(true)
    expect(useRecovery.getState()).toEqual({ offer: null, dismissed: false, damaged: false, restoreError: null })
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

  it("a trimmed snapshot leaves current sources alone and needs explicit acceptance as incomplete", async () => {
    useBroadcastStore.getState().setLiveVerse({ reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" }, null, { goLive: true })
    const before = useBroadcastStore.getState().sources
    const snap = { ...takeSnapshot(), liveVerse: null, sources: {}, trimmed: true, outputsOn: [], eventId: null }
    useRecovery.setState({ offer: snap, dismissed: false })
    expect(await putBack(snap)).toBe(false)
    expect(useBroadcastStore.getState().sources).toBe(before)
    expect(useRecovery.getState().offer).toMatchObject(snap)
    expect(useRecovery.getState().restoreError).toContain("shortened to fit storage")
    expect(useJournalStore.getState().entries.some((entry) => entry.kind === "recovery")).toBe(false)

    acceptPartialRecovery()
    expect(useRecovery.getState().offer).toBeNull()
    expect(useJournalStore.getState().entries.some((entry) => entry.kind === "recovery" && entry.label.startsWith("Continued after incomplete recovery:"))).toBe(true)
  })

  it("rejects an untrimmed live snapshot with no program content", () => {
    const impossible = { ...takeSnapshot(), isLive: true, liveVerse: null, trimmed: undefined }
    expect(parseLiveSnapshot(impossible)).toBeNull()
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

  it("does not offer or apply a malformed saved recovery snapshot", async () => {
    const live = { reference: "Keep the current Program", segments: [{ text: "Still on air" }], content: "bible" as const }
    useBroadcastStore.getState().setLiveVerse(live, null, { goLive: true })
    const broadcastBefore = useBroadcastStore.getState()
    const journalBefore = useJournalStore.getState()
    const invalid = { ...takeSnapshot(), isLive: true, liveVerse: live, sources: "corrupt", outputsOn: "not-an-array" }
    kept.set("snapshot", invalid)
    kept.set("journal", { v: 1, at: Date.now() - 60_000, startItemIds: ["saved-event"], entries: [{ at: Date.now() - 60_000, mono: 1, kind: "event", label: "Must not be restored", itemId: "saved-event" }] })
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "last_exit_unclean" ? true : null))

    expect(worthOffering(invalid)).toBe(false)
    const stop = await startLiveRecovery()
    expect(useRecovery.getState().offer).toBeNull()
    expect(useRecovery.getState()).toMatchObject({ damaged: true })
    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useJournalStore.getState()).toBe(journalBefore)

    useRecovery.setState({ offer: invalid as never, damaged: false } as never)
    await putBack(invalid as never)
    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
    expect(useJournalStore.getState().entries.some((entry) => entry.kind === "recovery")).toBe(false)
    stop()
    vi.mocked(invoke).mockImplementation(async () => null)
  })

})
