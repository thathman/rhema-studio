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
  useJournalStore.setState({ entries: [], startItemIds: null, added: 0, keptAt: 0, runContext: null, runStatus: "none", checkpointStatus: "idle", checkpointError: null, finalizedLogId: null })
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

  it("restores the output theme selection captured with a scene", async () => {
    const state = useBroadcastStore.getState()
    const primaryTheme = state.themes[0]
    const scriptureTheme = { ...primaryTheme, id: "recovery-scripture-theme", name: "Scripture look" }
    const scene = {
      id: "scene-with-output-selection",
      name: "Saved",
      background: "#112233",
      layers: [{ id: "feed", name: "Bible", kind: "feed" as const, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true, shows: ["bible" as const] }],
      createdAt: 1,
      updatedAt: 2,
    }
    const output = { ...state.outputs[0], themeId: primaryTheme.id, themeFor: { bible: scriptureTheme.id } }
    useBroadcastStore.setState({ themes: [...state.themes, scriptureTheme], scenes: [scene], outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene }] })
    const snapshot = takeSnapshot()
    const captured = snapshot.sceneSnapshots?.[MAIN_OUTPUT_ID]
    expect(captured).toMatchObject({ themeId: primaryTheme.id, themeFor: { bible: scriptureTheme.id } })

    useBroadcastStore.setState({
      outputs: [{ ...useBroadcastStore.getState().outputs[0], themeId: scriptureTheme.id, themeFor: { bible: primaryTheme.id } }],
    })
    await putBack(snapshot)

    expect(useBroadcastStore.getState().outputs[0]).toMatchObject({
      themeId: primaryTheme.id,
      themeFor: { bible: scriptureTheme.id },
      sceneId: scene.id,
      sceneSnapshot: scene,
      sceneAppearanceSnapshot: captured?.appearance,
    })
  })

  it("rejects a scene snapshot missing an explicit layer theme capture", async () => {
    const state = useBroadcastStore.getState()
    const primaryTheme = state.themes[0]
    const explicitTheme = { ...primaryTheme, id: "recovery-explicit-theme", name: "Explicit look" }
    const scene = {
      id: "scene-with-explicit-theme",
      name: "Saved",
      background: "#112233",
      layers: [{ id: "feed", name: "Bible", kind: "feed" as const, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true, themeId: explicitTheme.id }],
      createdAt: 1,
      updatedAt: 2,
    }
    const output = { ...state.outputs[0], themeId: primaryTheme.id }
    useBroadcastStore.setState({ themes: [...state.themes, explicitTheme], scenes: [scene], outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene }] })
    const snapshot = takeSnapshot()
    const captured = snapshot.sceneSnapshots?.[MAIN_OUTPUT_ID]
    expect(captured?.appearance.themes[explicitTheme.id]).toBeDefined()
    const invalid = {
      ...snapshot,
      sceneSnapshots: {
        [MAIN_OUTPUT_ID]: {
          ...captured!,
          appearance: { ...captured!.appearance, themes: { [primaryTheme.id]: captured!.appearance.themes[primaryTheme.id] } },
        },
      },
    }
    const broadcastBefore = useBroadcastStore.getState()

    await putBack(invalid)

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("rejects a scene snapshot missing a selected per-content theme capture", async () => {
    const state = useBroadcastStore.getState()
    const primaryTheme = state.themes[0]
    const scriptureTheme = { ...primaryTheme, id: "recovery-selected-theme", name: "Selected look" }
    const scene = {
      id: "scene-with-selected-theme",
      name: "Saved",
      background: "#112233",
      layers: [{ id: "feed", name: "Bible", kind: "feed" as const, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true, shows: ["bible" as const] }],
      createdAt: 1,
      updatedAt: 2,
    }
    const output = { ...state.outputs[0], themeId: primaryTheme.id, themeFor: { bible: scriptureTheme.id } }
    useBroadcastStore.setState({ themes: [...state.themes, scriptureTheme], scenes: [scene], outputs: [{ ...output, sceneId: scene.id, sceneSnapshot: scene }] })
    const snapshot = takeSnapshot()
    const captured = snapshot.sceneSnapshots?.[MAIN_OUTPUT_ID]
    expect(captured?.appearance.themes[scriptureTheme.id]).toBeDefined()
    const invalid = {
      ...snapshot,
      sceneSnapshots: {
        [MAIN_OUTPUT_ID]: {
          ...captured!,
          appearance: { ...captured!.appearance, themes: { [primaryTheme.id]: captured!.appearance.themes[primaryTheme.id] } },
        },
      },
    }
    const broadcastBefore = useBroadcastStore.getState()

    await putBack(invalid)

    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
  })

  it("skips legacy restore when the output selects a theme missing from its immutable appearance", async () => {
    const state = useBroadcastStore.getState()
    const primaryTheme = state.themes[0]
    const scriptureTheme = { ...primaryTheme, id: "legacy-selected-theme", name: "Selected look" }
    const scene = { id: "legacy-missing-selected-theme", name: "Saved", background: "#112233", layers: [], createdAt: 1, updatedAt: 2 }
    const output = {
      ...state.outputs[0],
      themeId: primaryTheme.id,
      themeFor: { bible: scriptureTheme.id },
      sceneId: scene.id,
      sceneSnapshot: scene,
      sceneAppearanceSnapshot: { themes: { [primaryTheme.id]: primaryTheme }, logoUrl: null },
    }
    useBroadcastStore.setState({ themes: [...state.themes, scriptureTheme], scenes: [scene], outputs: [output], outputStatus: {} })
    const legacy = { ...takeSnapshot(), outputsOn: [MAIN_OUTPUT_ID] }
    delete legacy.sceneSnapshots
    vi.mocked(invoke).mockClear()

    await putBack(legacy)

    expect(useBroadcastStore.getState().outputs[0].sceneSnapshot).toEqual(scene)
    expect(useBroadcastStore.getState().outputs[0].sceneAppearanceSnapshot).toEqual(output.sceneAppearanceSnapshot)
    expect(useBroadcastStore.getState().outputs[0].themeFor).toEqual({ bible: scriptureTheme.id })
    expect(invoke).not.toHaveBeenCalledWith("open_broadcast_window", expect.anything())
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

    await expect(putBack(invalid)).resolves.toBe(false)

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

    await expect(putBack(invalid)).resolves.toBe(false)

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

  it("does not re-enable a no-scene output after trimming removed its live program", async () => {
    const output = useBroadcastStore.getState().outputs[0]
    useBroadcastStore.setState({
      isLive: true,
      liveVerse: { reference: "Romans 8:28", segments: [{ text: "Current program" }] },
      sources: {},
      outputs: [output],
      outputStatus: { [MAIN_OUTPUT_ID]: { previewOpen: true, ndiActive: false } },
    })
    const full = takeSnapshot()
    expect(full.scenes).toEqual({})
    expect(full.outputsOn).toContain(MAIN_OUTPUT_ID)
    const trimmed = { ...full, liveVerse: null, sources: {}, sceneSnapshots: {}, trimmed: true }
    useRecovery.setState({ offer: trimmed, dismissed: false, damaged: false, restoreError: null })
    useBroadcastStore.setState({ isLive: false, liveVerse: null, sources: {}, outputStatus: {} })
    const outputStatusBefore = useBroadcastStore.getState().outputStatus
    vi.mocked(invoke).mockClear()

    expect(await putBack(trimmed)).toBe(false)

    expect(useBroadcastStore.getState().outputStatus).toBe(outputStatusBefore)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(invoke).not.toHaveBeenCalledWith("open_broadcast_window", expect.anything())
    expect(useRecovery.getState()).toMatchObject({ offer: trimmed, restoreError: expect.stringContaining("shortened") })
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
    delete snap.sceneSnapshots
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
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    const live = { reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" as const }
    useBroadcastStore.getState().setLiveVerse(live, null, { goLive: true })
    const snap = { ...takeSnapshot(), outputsOn: [MAIN_OUTPUT_ID, sideOutput.id], eventId: null }
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

  it("restores the service journal after a crash without counting unknown outage time", () => {
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
    expect(entries.map((e) => e.kind)).toEqual(["event", "event", "recovery", "scene", "recovery"])
    // Rebased on this run's clock: 4 min apart as before.
    expect(entries[1].mono - entries[0].mono).toBe(240_000)
    expect(entries[0].mono).toBe(at - (at + 700_000 - 1_000))
    // Only once, never an old one.
    expect(restoreJournal(kept, at + 700_000, 1_000)).toBe(false)
    expect(useJournalStore.getState().entries).toHaveLength(5)
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
    const invalid = { ...takeSnapshot(), isLive: true, liveVerse: live, sources: "corrupt", outputsOn: "not-an-array" }
    kept.set("snapshot", invalid)
    kept.set("journal", { v: 1, at: Date.now() - 60_000, startItemIds: ["saved-event"], entries: [{ at: Date.now() - 60_000, mono: 1, kind: "event", label: "Must not be restored", itemId: "saved-event" }] })
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "last_exit_unclean" ? true : null))

    expect(worthOffering(invalid)).toBe(false)
    const stop = await startLiveRecovery()
    expect(useRecovery.getState().offer).toBeNull()
    expect(useRecovery.getState()).toMatchObject({ damaged: true })
    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useJournalStore.getState().entries.some((entry) => entry.kind === "event" && entry.label === "Must not be restored")).toBe(true)
    const journalAfterHistoryRecovery = useJournalStore.getState()

    useRecovery.setState({ offer: invalid as never, damaged: false } as never)
    await putBack(invalid as never)
    expect(useBroadcastStore.getState()).toBe(broadcastBefore)
    expect(useRecovery.getState()).toMatchObject({ offer: null, damaged: true })
    expect(useJournalStore.getState()).toBe(journalAfterHistoryRecovery)
    expect(useJournalStore.getState().entries.some((entry) => entry.kind === "event" && entry.label === "Must not be restored")).toBe(true)
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
