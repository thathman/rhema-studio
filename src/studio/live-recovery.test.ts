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
  kept.clear()
  const themeId = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, sources: {}, rehearsal: false, scenes: [], outputStatus: {},
    outputs: [{ id: MAIN_OUTPUT_ID, name: "Projector", type: "display", themeId, monitorIndex: 0, ndi: defaultNdiSettings() }],
  })
  useJournalStore.setState({ entries: [] })
  useRecovery.setState({ offer: null, dismissed: false, damaged: false })
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
    await putBack(snap)
    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(true)
    expect(b.liveVerse?.reference).toBe("Romans 8:28")
    expect(b.sources.bible?.on).toBe(true)
    expect(useRecovery.getState().offer).toBeNull()
    expect(useJournalStore.getState().entries.some((e) => e.kind === "recovery")).toBe(true)
  })

  it("restores the immutable scene and appearance captured at crash time", async () => {
    const originalScene = { id: "same-scene", name: "Approved at crash", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const editedScene = { ...originalScene, name: "Unapproved edit", background: "#ffffff", updatedAt: 3 }
    const theme = useBroadcastStore.getState().themes[0]
    const originalAppearance = {
      themes: { [theme.id]: { ...theme, background: { ...theme.background, color: "#112233" } } },
      logoUrl: null,
      approved: { programId: "service-at-crash", revision: 7, appearanceComplete: true, approvedAt: "2026-10-28T01:00:00Z", approvedBy: "Hendrix" },
    }
    const originalOutput = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({
      scenes: [originalScene],
      outputs: [{ ...originalOutput, sceneId: originalScene.id, sceneSnapshot: originalScene, sceneAppearanceSnapshot: originalAppearance }],
    })

    const snap = takeSnapshot()
    expect(snap.sceneSnapshots?.[MAIN_OUTPUT_ID]).toMatchObject({ scene: originalScene, appearance: originalAppearance })
    expect(snap.sceneSnapshots?.[MAIN_OUTPUT_ID].appearance.themes[theme.id].layout.mode).toBe("stacked")

    // The reusable scene and the hydrated output now point at an unapproved edit with the same ID.
    useBroadcastStore.setState({
      scenes: [editedScene],
      outputs: [{ ...originalOutput, sceneId: editedScene.id, sceneSnapshot: editedScene, sceneAppearanceSnapshot: { themes: {}, logoUrl: "new-logo.png" } }],
    })
    await putBack(snap)

    const restored = useBroadcastStore.getState().outputs[0]
    expect(restored.sceneId).toBe(originalScene.id)
    expect(restored.sceneSnapshot).toEqual(originalScene)
    expect(restored.sceneAppearanceSnapshot).toMatchObject({
      themes: { [theme.id]: { background: { color: "#112233" } } },
      logoUrl: null,
      approved: originalAppearance.approved,
    })
    expect(restored.sceneSnapshot?.background).not.toBe(editedScene.background)
  })

  it("restores a valid legacy v1 scene from the persisted output snapshot", async () => {
    const originalScene = { id: "legacy-scene", name: "Taken before crash", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const editedScene = { ...originalScene, name: "Later edit", background: "#ffffff", updatedAt: 3 }
    const theme = useBroadcastStore.getState().themes[0]
    const originalAppearance = { themes: { [theme.id]: theme }, logoUrl: null }
    const output = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({
      scenes: [editedScene],
      outputs: [{ ...output, sceneId: originalScene.id, sceneSnapshot: originalScene, sceneAppearanceSnapshot: originalAppearance }],
    })
    const legacy = { ...takeSnapshot() }
    delete legacy.sceneSnapshots
    await putBack(legacy)

    expect(useBroadcastStore.getState().outputs[0].sceneSnapshot).toEqual(originalScene)
    expect(useBroadcastStore.getState().outputs[0].sceneAppearanceSnapshot).toMatchObject({
      themes: { [theme.id]: { background: theme.background } },
      logoUrl: null,
    })
  })

  it("does not restore a legacy scene when its immutable output snapshot has no appearance capture", async () => {
    const scene = { id: "legacy-without-look", name: "Persisted scene", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const output = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({ scenes: [scene], outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene, sceneAppearanceSnapshot: undefined }], outputStatus: {} })
    const legacy = { ...takeSnapshot(), outputsOn: [MAIN_OUTPUT_ID] }
    delete legacy.sceneSnapshots
    const snapshotBefore = useBroadcastStore.getState().outputs[0].sceneSnapshot
    const sceneTakesBefore = useBroadcastStore.getState().sceneTakes
    vi.mocked(invoke).mockClear()

    await putBack(legacy)

    expect(useBroadcastStore.getState().outputs[0].sceneSnapshot).toBe(snapshotBefore)
    expect(useBroadcastStore.getState().sceneTakes).toBe(sceneTakesBefore)
    expect(invoke).not.toHaveBeenCalledWith("open_broadcast_window", expect.anything())
  })

  it("rejects a new scene snapshot with no captured appearance", async () => {
    const scene = { id: "scene-without-look", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const output = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({ scenes: [scene], outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene }] })
    const snap = takeSnapshot()
    const invalid = { ...snap, sceneSnapshots: { [MAIN_OUTPUT_ID]: { scene } } }
    const broadcastBefore = useBroadcastStore.getState()

    await putBack(invalid)

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("fails closed when a scene has no captured output theme", async () => {
    const scene = { id: "scene-with-empty-look", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const output = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({
      isLive: true,
      liveVerse: { reference: "Still live", segments: [{ text: "Current program" }] },
      scenes: [scene],
      outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene, sceneAppearanceSnapshot: { themes: {}, logoUrl: null } }],
      outputStatus: { [MAIN_OUTPUT_ID]: { previewOpen: true, ndiActive: false } },
    })
    const snapshot = takeSnapshot()
    expect(snapshot.scenes[MAIN_OUTPUT_ID]).toBe(scene.id)
    expect(snapshot.sceneSnapshots).not.toHaveProperty(MAIN_OUTPUT_ID)

    const broadcastBefore = useBroadcastStore.getState()
    await putBack({
      ...snapshot,
      sceneSnapshots: {
        [MAIN_OUTPUT_ID]: { scene, appearance: { themes: {}, logoUrl: null } },
      },
    })
    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })

    await putBack(snapshot)
    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("rejects malformed nested theme boxes without throwing or changing live state", async () => {
    const scene = { id: "scene-with-bad-theme", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({ scenes: [scene], outputs: [{ ...useBroadcastStore.getState().outputs[0], sceneId: scene.id, sceneSnapshot: scene }] })
    const snap = takeSnapshot()
    const invalid = {
      ...snap,
      sceneSnapshots: {
        [MAIN_OUTPUT_ID]: {
          scene,
          appearance: { themes: { [theme.id]: { ...theme, layout: { ...theme.layout, mode: "free", referenceBox: null } } }, logoUrl: null },
        },
      },
    }
    const broadcastBefore = useBroadcastStore.getState()

    await expect(putBack(invalid)).resolves.toBeUndefined()

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("rejects a free-layout theme with a missing box rather than downgrading its appearance", async () => {
    const scene = { id: "scene-with-incomplete-free-theme", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({ scenes: [scene], outputs: [{ ...useBroadcastStore.getState().outputs[0], sceneId: scene.id, sceneSnapshot: scene }] })
    const snap = takeSnapshot()
    const invalid = {
      ...snap,
      sceneSnapshots: {
        [MAIN_OUTPUT_ID]: {
          scene,
          appearance: {
            themes: { [theme.id]: { ...theme, layout: { ...theme.layout, mode: "free", referenceBox: { x: 0, y: 0, width: 100, height: 100 }, verseBox: undefined } } },
            logoUrl: null,
          },
        },
      },
    }
    const broadcastBefore = useBroadcastStore.getState()

    await expect(putBack(invalid)).resolves.toBeUndefined()

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("rejects a new appearance snapshot whose layout mode is missing", async () => {
    const scene = { id: "scene-with-missing-mode", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({ scenes: [scene], outputs: [{ ...useBroadcastStore.getState().outputs[0], sceneId: scene.id, sceneSnapshot: scene }] })
    const snap = takeSnapshot()
    const invalid = {
      ...snap,
      sceneSnapshots: {
        [MAIN_OUTPUT_ID]: {
          scene,
          appearance: { themes: { [theme.id]: { ...theme, layout: { ...theme.layout, mode: undefined } } }, logoUrl: null },
        },
      },
    }
    const broadcastBefore = useBroadcastStore.getState()

    await putBack(invalid)

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("rejects a new appearance snapshot when theme normalization would add styling defaults", async () => {
    const scene = { id: "scene-with-incomplete-theme", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const theme = useBroadcastStore.getState().themes[0]
    const output = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({
      isLive: true,
      liveVerse: { reference: "Current live", segments: [{ text: "Still on air" }] },
      scenes: [scene],
      outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene }],
      outputStatus: { [MAIN_OUTPUT_ID]: { previewOpen: true, ndiActive: false } },
    })
    const snap = takeSnapshot()
    const incompleteTheme = { ...theme }
    Reflect.deleteProperty(incompleteTheme, "verseNumbers")
    const invalid = {
      ...snap,
      sceneSnapshots: {
        [MAIN_OUTPUT_ID]: {
          scene,
          appearance: { themes: { [theme.id]: incompleteTheme }, logoUrl: null },
        },
      },
    }
    const broadcastBefore = useBroadcastStore.getState()

    await putBack(invalid)

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: true,
      liveVerse: { reference: "Current live" },
      outputs: [{ sceneId: scene.id, sceneSnapshot: scene }],
      outputStatus: { [MAIN_OUTPUT_ID]: { previewOpen: true, ndiActive: false } },
    })
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("rejects a free-layout percentage outside the design canvas", async () => {
    const scene = { id: "scene-with-outside-box", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({ scenes: [scene], outputs: [{ ...useBroadcastStore.getState().outputs[0], sceneId: scene.id, sceneSnapshot: scene }] })
    const snap = takeSnapshot()
    const invalid = {
      ...snap,
      sceneSnapshots: {
        [MAIN_OUTPUT_ID]: {
          scene,
          appearance: {
            themes: {
              [theme.id]: {
                ...theme,
                layout: {
                  ...theme.layout,
                  mode: "free",
                  referenceBox: { x: 101, y: 0, width: 40, height: 10 },
                  verseBox: { x: 0, y: 20, width: 80, height: 70 },
                },
              },
            },
            logoUrl: null,
          },
        },
      },
    }
    const broadcastBefore = useBroadcastStore.getState()

    await putBack(invalid)

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("rejects scene geometry or opacity that normalization would change", async () => {
    const scene = {
      id: "scene-with-invalid-opacity",
      name: "Saved",
      background: "#112233",
      layers: [{ id: "bad-opacity", name: "Invalid opacity", kind: "color" as const, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 3, visible: true, color: "#ffffff" }],
      createdAt: 1,
      updatedAt: 2,
    }
    const output = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({ scenes: [scene], outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene }] })
    const snap = takeSnapshot()
    const invalid = { ...snap, sceneSnapshots: { [MAIN_OUTPUT_ID]: { ...snap.sceneSnapshots?.[MAIN_OUTPUT_ID], scene } } }
    const broadcastBefore = useBroadcastStore.getState()

    await putBack(invalid)

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("does not use or re-enable an output with a scene omitted by size trimming", async () => {
    const originalScene = { id: "trimmed-scene", name: "On air at crash", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const editedScene = { ...originalScene, name: "Edited after crash", background: "#ffffff", updatedAt: 3 }
    const originalOutput = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({
      scenes: [originalScene],
      outputs: [{ ...originalOutput, sceneId: originalScene.id, sceneSnapshot: originalScene, sceneAppearanceSnapshot: { themes: {}, logoUrl: null } }],
    })
    const snap = takeSnapshot()
    const trimmed = { ...snap, liveVerse: null, sources: {}, sceneSnapshots: {}, outputsOn: [MAIN_OUTPUT_ID], trimmed: true }

    useBroadcastStore.setState({
      scenes: [editedScene],
      outputs: [{ ...originalOutput, sceneId: editedScene.id, sceneSnapshot: editedScene, sceneAppearanceSnapshot: { themes: {}, logoUrl: "changed-logo.png" } }],
      outputStatus: {},
    })
    const editedOutputSnapshot = useBroadcastStore.getState().outputs[0].sceneSnapshot
    const sceneTakesBefore = useBroadcastStore.getState().sceneTakes
    vi.mocked(invoke).mockClear()

    await putBack(trimmed)

    expect(useBroadcastStore.getState().outputs[0].sceneSnapshot).toBe(editedOutputSnapshot)
    expect(useBroadcastStore.getState().outputs[0].sceneAppearanceSnapshot?.logoUrl).toBe("changed-logo.png")
    expect(useBroadcastStore.getState().sceneTakes).toBe(sceneTakesBefore)
    expect(invoke).not.toHaveBeenCalledWith("open_broadcast_window", expect.anything())
  })

  it("Not now hides the offer but keeps it for the Desk menu until it is put back (#299 1.18)", async () => {
    const snap = { ...takeSnapshot(), eventId: null, outputsOn: [] }
    useRecovery.setState({ offer: snap, dismissed: false })
    dismissRecovery()
    expect(useRecovery.getState()).toMatchObject({ offer: snap, dismissed: true })
    await putBack(snap)
    expect(useRecovery.getState()).toEqual({ offer: null, dismissed: false, damaged: false })
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

  it("rejects a malformed captured scene before changing live or output state", async () => {
    const current = { reference: "Keep current Program", segments: [{ text: "Still on air" }], content: "bible" as const }
    useBroadcastStore.getState().setLiveVerse(current, null, { goLive: true })
    const scene = { id: "saved-scene", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const output = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({ scenes: [scene], outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene }] })
    const broadcastBefore = useBroadcastStore.getState()
    const snap = takeSnapshot()
    const invalid = {
      ...snap,
      liveVerse: { reference: "Do not apply", segments: [{ text: "Must not replace" }], content: "bible" as const },
      sceneSnapshots: { [MAIN_OUTPUT_ID]: { scene: { ...scene, layers: "corrupt" } } },
    }

    await putBack(invalid)

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

})
