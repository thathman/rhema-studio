import { beforeEach, describe, expect, it, vi } from "vitest"

const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...a: unknown[]) => emitTo(...a), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

/** The words a stage window was last sent. */
const stageTitle = (label: string) => {
  const call = emitTo.mock.calls.filter((c) => c[0] === label).at(-1)
  return (call?.[2] as { stage?: { current: { title: string } | null } } | undefined)?.stage?.current?.title ?? null
}

/** A stage display that follows chosen sources (ADR 0001, ARCH-001). */
beforeEach(() => {
  emitTo.mockClear()
  const themeId = useBroadcastStore.getState().themes[0].id
  const out = (id: string, shows?: ("bible" | "hymn")[]) => ({ id, name: id, type: "display" as const, role: "stage" as const, themeId, monitorIndex: 0, ndi: defaultNdiSettings(), ...(shows ? { shows } : {}) })
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, sources: {}, rehearsal: false,
    outputs: [{ ...out(MAIN_OUTPUT_ID), role: "congregation" }, out("pulpit", ["bible"]), out("band")],
    outputStatus: { pulpit: { previewOpen: true, ndiActive: false }, band: { previewOpen: true, ndiActive: false } },
  })
})

describe("a stage display", () => {
  it("that follows the Bible keeps the verse while a hymn is on air; one following everything shows the hymn", () => {
    const b = useBroadcastStore.getState()
    b.setLiveVerse({ reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" }, null, { goLive: true })
    b.setLiveVerse({ kind: "lyric", content: "hymn", reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace"] }, null, { goLive: true })
    expect(stageTitle("broadcast-pulpit")).toBe("Romans 8:28")
    expect(stageTitle("broadcast-band")).toBe("Amazing Grace · Verse 1")
  })
})

describe("the service log", () => {
  it("tags what went on air with its source and records a source changing beside the program", async () => {
    const { useJournalStore, journalText } = await import("@/stores/journal-store")
    useJournalStore.setState({ entries: [] })
    const b = useBroadcastStore.getState()
    b.setLiveVerse({ kind: "lyric", content: "hymn", reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace"] }, null, { goLive: true })
    b.activateSource({ reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" })
    useBroadcastStore.getState().clearSource("bible")
    useBroadcastStore.getState().restoreSource("bible")
    const entries = useJournalStore.getState().entries
    expect(entries.map((e) => [e.kind, e.label, e.source])).toEqual([
      ["live", "Amazing Grace · Verse 1", "Hymns"],
      ["source", "Bible: Romans 8:28", "Bible"],
      ["source", "Bible off: Romans 8:28", "Bible"],
      ["source", "Bible back: Romans 8:28", "Bible"],
    ])
    expect(journalText()).toMatch(/LIVE\s+Amazing Grace · Verse 1 .*· Hymns/)
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Amazing Grace · Verse 1")
  })

  it("records a scene taken to an output and released, as SCENE lines", async () => {
    const { useJournalStore, journalText } = await import("@/stores/journal-store")
    const { newScene, SCENE_PRESETS } = await import("@/lib/scenes")
    useJournalStore.setState({ entries: [] })
    const scene = { ...newScene("Sermon split", SCENE_PRESETS[0]) }
    useBroadcastStore.getState().saveScene(scene)
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    useBroadcastStore.getState().releaseScene(MAIN_OUTPUT_ID)
    expect(useJournalStore.getState().entries.map((e) => [e.kind, e.label])).toEqual([
      ["scene", `${MAIN_OUTPUT_ID}: Sermon split`],
      ["scene", `${MAIN_OUTPUT_ID}: back to its own feed`],
    ])
    expect(journalText()).toMatch(/SCENE\s+main: Sermon split/)
  })
})
