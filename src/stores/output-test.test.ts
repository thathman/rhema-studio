import { beforeEach, describe, expect, it, vi } from "vitest"

const emitToMock = vi.fn()
const invokeMock = vi.fn()
vi.mock("@tauri-apps/api/event", () => ({ emitTo: emitToMock }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

const verse = (reference: string) => ({ reference, segments: [{ text: "For God so loved the world", verseNumber: 16 }] })
const ndi = { sourceName: "Rhema Stream", resolution: "r1080p", frameRate: "fps30", alphaMode: "straightAlpha" } as const
const PATTERN = { theme: { id: "screen-test" }, verse: null, overlay: null, ticker: null, sound: false }

/** The frames each output window was sent, in order. */
const sentTo = (label: string) => emitToMock.mock.calls.filter((c) => c[0] === label && c[1] === "broadcast:verse-update").map((c) => c[2] as Record<string, unknown>)

/** Screen test (#298 scenario F): the pattern holds one output only, and ending it puts back exactly what it would show. */
describe("screen test hold", () => {
  beforeEach(() => {
    emitToMock.mockReset()
    emitToMock.mockResolvedValue(undefined)
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
    vi.resetModules()
  })

  async function store() {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    s.addOutput({ id: "stream", name: "Stream", type: "ndi", themeId: s.themes[0].id, monitorIndex: 0, ndi })
    useBroadcastStore.setState({ isLive: true, liveVerse: verse("John 3:16") })
    s.syncBroadcastOutput()
    emitToMock.mockClear()
    return useBroadcastStore
  }

  it("shows the pattern on the chosen output only", async () => {
    const b = await store()
    b.getState().startOutputTest("main", PATTERN)
    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(sentTo("broadcast-main")).toEqual([PATTERN])
    expect(b.getState().outputTests.main).toBeTypeOf("number")
    expect(b.getState().outputTests.stream).toBeUndefined()
  })

  it("holds program changes back from the tested output while every other output keeps getting them", async () => {
    const b = await store()
    b.getState().startOutputTest("main", PATTERN)
    emitToMock.mockClear()
    b.setState({ liveVerse: verse("Romans 8:28") })
    b.getState().syncBroadcastOutput()
    expect(sentTo("broadcast-main")).toEqual([])
    expect(sentTo("broadcast-stream")[0]).toMatchObject({ verse: { reference: "Romans 8:28" } })
    // The operator's own view still follows the program.
    expect(b.getState().outputFrames.main?.verse).toMatchObject({ reference: "Romans 8:28" })
  })

  it("End test sends the newest program frame, not the one from before the test, without a latency stamp", async () => {
    const b = await store()
    b.getState().startOutputTest("main", PATTERN)
    b.setState({ liveVerse: verse("Romans 8:28") })
    b.getState().syncBroadcastOutput()
    emitToMock.mockClear()
    b.getState().endOutputTest("main")
    const back = sentTo("broadcast-main")
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ verse: { reference: "Romans 8:28" } })
    expect(back[0]).not.toHaveProperty("sentAt")
    expect(sentTo("broadcast-stream")).toEqual([])
    expect(b.getState().outputTests.main).toBeUndefined()
  })

  it("rehearsal: the frozen screen comes back as it was (nothing rehearsed leaks out)", async () => {
    const b = await store()
    b.getState().setRehearsal(true)
    b.getState().startOutputTest("main", PATTERN)
    b.setState({ liveVerse: verse("Psalm 23:1") })
    b.getState().syncBroadcastOutput()
    emitToMock.mockClear()
    b.getState().endOutputTest("main")
    expect(sentTo("broadcast-main")).toHaveLength(1)
    expect(sentTo("broadcast-main")[0]).toMatchObject({ verse: { reference: "John 3:16" } })
  })

  it("an output that never had a frame gets its plain look back", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    useBroadcastStore.setState({ rehearsal: true })
    s.startOutputTest("main", PATTERN)
    emitToMock.mockClear()
    s.endOutputTest("main")
    expect(sentTo("broadcast-main")).toEqual([expect.objectContaining({ verse: null, overlay: null, ticker: null })])
  })

  it("ending a test that is not running sends nothing; removing a tested output forgets the test", async () => {
    const b = await store()
    b.getState().endOutputTest("main")
    expect(emitToMock).not.toHaveBeenCalled()
    b.getState().startOutputTest("stream", PATTERN)
    b.getState().removeOutput("stream")
    expect(b.getState().outputTests.stream).toBeUndefined()
    b.getState().startOutputTest("nope", PATTERN)
    expect(b.getState().outputTests.nope).toBeUndefined()
  })

  it("a browser feed gets the pattern through its feed, only while the feed is on", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const s = useBroadcastStore.getState()
    s.addOutput({ id: "tv", name: "Lobby TV", type: "browser", themeId: s.themes[0].id, monitorIndex: 0, ndi, feedToken: "0123456789abcdef0123" })
    s.setOutputStatus("tv", { previewOpen: false, ndiActive: false, feedActive: true })
    invokeMock.mockClear()
    s.startOutputTest("tv", PATTERN)
    const published = invokeMock.mock.calls.filter((c) => c[0] === "feed_publish")
    expect(published).toHaveLength(1)
    expect(JSON.parse(published[0][1].json)).toMatchObject({ theme: { id: "screen-test" }, verse: null })
  })
})
