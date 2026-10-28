import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => { calls.push({ cmd, args }); return null }) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...a: unknown[]) => emitTo(...a), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { enableOutput, disableOutput } = await import("@/lib/broadcast-output-control")
const { outputOnAir } = await import("@/lib/output-on-air")
const { startBrowserFeeds, feedUrl, feedHealthLabel, beginTvKey, endTvKey, revokeTv, noteFeedShown, resetFeedShown } = await import("@/lib/browser-feeds")
const { looksForBackup, restoreLooksFromBackup } = await import("@/stores/broadcast-store")
const { useJournalStore } = await import("@/stores/journal-store")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

/** Browser feeds (ARCH-002): an output drawn by a LAN web page; published only while on. */
beforeEach(() => {
  calls.length = 0
  emitTo.mockClear()
  const themeId = useBroadcastStore.getState().themes[0].id
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, sources: {}, rehearsal: false, outputStatus: {},
    outputs: [
      { id: MAIN_OUTPUT_ID, name: "Projector", type: "display", themeId, monitorIndex: 0, ndi: defaultNdiSettings() },
      { id: "tv", name: "Foyer TV", type: "browser", themeId, monitorIndex: 0, ndi: defaultNdiSettings() },
    ],
  })
})

describe("browser feeds", () => {
  it("get a secret and are known to the listener; a new secret replaces the old", () => {
    const stop = startBrowserFeeds()
    const tv = useBroadcastStore.getState().outputs.find((o) => o.id === "tv")!
    expect(tv.feedToken).toMatch(/^[0-9a-f]{32}$/)
    expect(calls.find((c) => c.cmd === "feeds_set")?.args).toEqual({ feeds: [{ id: "tv", token: tv.feedToken, tvs: [] }] })
    useBroadcastStore.getState().updateOutput("tv", { feedToken: "f".repeat(32) })
    expect(calls.filter((c) => c.cmd === "feeds_set").at(-1)?.args).toEqual({ feeds: [{ id: "tv", token: "f".repeat(32), tvs: [] }] })
    expect(feedUrl("192.168.1.20", 8080, "tv", "abc")).toBe("http://192.168.1.20:8080/feed/tv?k=abc")
    expect(feedUrl("192.168.1.20", 8081, "tv", "abc", true)).toBe("https://192.168.1.20:8081/feed/tv?k=abc")
    stop()
  })

  it("publish frames only while on, never to a window; the projector still gets its window", async () => {
    const tv = useBroadcastStore.getState().outputs.find((o) => o.id === "tv")!
    useBroadcastStore.getState().setLiveVerse({ reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" }, null, { goLive: true })
    expect(calls.filter((c) => c.cmd === "feed_publish")).toEqual([])
    expect(emitTo.mock.calls.map((c) => c[0])).toEqual(["broadcast-main"])
    await enableOutput(tv)
    expect(outputOnAir(tv, useBroadcastStore.getState().outputStatus.tv)).toBe(true)
    const sent = calls.filter((c) => c.cmd === "feed_publish").at(-1)!
    expect(sent.args.id).toBe("tv")
    expect(JSON.parse(sent.args.json as string).verse.reference).toBe("Romans 8:28")
    expect(emitTo.mock.calls.some((c) => c[0] === "broadcast-tv")).toBe(false)
    await disableOutput(tv)
    expect(JSON.parse(calls.filter((c) => c.cmd === "feed_publish").at(-1)!.args.json as string)).toEqual({ off: true })
    expect(outputOnAir(tv, useBroadcastStore.getState().outputStatus.tv)).toBe(false)
    const before = calls.length
    useBroadcastStore.getState().setLiveVerse({ reference: "Romans 8:29", segments: [{ text: "For whom" }], content: "bible" }, null, { goLive: true })
    expect(calls.slice(before).filter((c) => c.cmd === "feed_publish")).toEqual([])
  })

  it("publishes the taken scene revision to an enabled TV feed after a saved edit", async () => {
    const { newScene, SCENE_PRESETS } = await import("@/lib/scenes")
    const tv = useBroadcastStore.getState().outputs.find((o) => o.id === "tv")!
    const scene = { ...newScene("TV program", SCENE_PRESETS[0]), background: "#000000" }
    useBroadcastStore.getState().saveScene(scene)
    useBroadcastStore.getState().takeScene("tv", scene.id)
    useBroadcastStore.getState().saveScene({ ...scene, background: "#123456" })

    await enableOutput(tv)

    const published = JSON.parse(calls.filter((c) => c.cmd === "feed_publish").at(-1)!.args.json as string)
    expect(published.scene.background).toBe("#000000")
  })

  it("say in plain words whether a page shows the latest frame (receiver trust)", () => {
    expect(feedHealthLabel(null)).toBeNull()
    expect(feedHealthLabel({ watching: 0, current: false, behind: false })).toBe("No page is showing it")
    expect(feedHealthLabel({ watching: 1, current: true, behind: false })).toBe("1 page · showing the latest")
    expect(feedHealthLabel({ watching: 2, current: false, behind: true })).toBe("2 pages · behind: not showing the latest")
  })

  it("give each TV its own key, known before its link goes, kept only when the send works (#198)", async () => {
    const stop = startBrowserFeeds()
    const lastKeys = () => (calls.filter((c) => c.cmd === "feeds_set").at(-1)!.args.feeds as { id: string; token: string; tvs: { id: string; token: string }[] }[])[0]
    const key = await beginTvKey("tv", " 192.168.1.40:8095 ")
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(lastKeys().tvs).toEqual([{ id: "192.168.1.40:8095", token: key }])
    // The TV refused (a wrong code): the key goes, nothing is remembered.
    await endTvKey("tv", key!)
    expect(lastKeys().tvs).toEqual([])
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "tv")!.tvs).toBeUndefined()
    // It worked: remembered with its key (as Show on TV does), then the send ends; the key stays.
    const key2 = (await beginTvKey("tv", "192.168.1.40:8095"))!
    useBroadcastStore.getState().updateOutput("tv", { tvs: [{ name: "Hall TV", address: "192.168.1.40:8095", sentAt: 1, token: key2 }, { name: "Old TV", address: "192.168.1.41:8095", sentAt: 1 }] })
    await endTvKey("tv", key2)
    expect(lastKeys().tvs, "a TV sent the shared link has no key of its own").toEqual([{ id: "192.168.1.40:8095", token: key2 }])
    // Revoke: its key is withdrawn at once; the shared-link TV is untouched.
    await revokeTv("tv", "192.168.1.40:8095")
    expect(lastKeys().tvs).toEqual([])
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "tv")!.tvs!.map((t) => t.name)).toEqual(["Old TV"])
    // A feed not saved yet gets no key of its own (its link is the feed's).
    expect(await beginTvKey("nope", "192.168.1.42:8095")).toBeNull()
    stop()
  })

  it("keep TV keys out of backups, and keep this computer's TVs on restore (#198)", () => {
    useBroadcastStore.getState().updateOutput("tv", { feedToken: "f".repeat(32), tvs: [{ name: "Hall TV", address: "192.168.1.40:8095", sentAt: 1, token: "k".repeat(32), width: 3840, height: 2160 }] })
    const backup = looksForBackup()
    expect(JSON.stringify(backup)).not.toContain("k".repeat(32))
    expect(backup.outputs.find((o) => o.id === "tv")!.tvs).toEqual([{ name: "Hall TV", address: "192.168.1.40:8095", sentAt: 1, width: 3840, height: 2160 }])
    restoreLooksFromBackup(backup)
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "tv")!.tvs![0].token, "this computer's TV keeps its key").toBe("k".repeat(32))
  })

  it("send a feed its rule for a lost host and its overscan, and again when they change (#198)", async () => {
    const tv = useBroadcastStore.getState().outputs.find((o) => o.id === "tv")!
    useBroadcastStore.getState().setCountdownSources({ aux: [], item: null, start: 1_900_000_000_000 })
    useBroadcastStore.getState().setLiveVerse({ reference: "Romans 8:28", segments: [{ text: "And we know" }], content: "bible" }, null, { goLive: true })
    await enableOutput(tv)
    const last = () => JSON.parse(calls.filter((c) => c.cmd === "feed_publish").at(-1)!.args.json as string)
    expect(last().lost, "keeps the last frame: nothing sent").toBeUndefined()
    expect(last().overscan).toBeUndefined()
    useBroadcastStore.getState().updateOutput("tv", { hostLost: { mode: "countdown" }, overscan: 3 })
    expect(last().lost).toEqual({ mode: "countdown", startsAt: 1_900_000_000_000 })
    expect(last().overscan).toBe(3)
    expect(last().verse.reference, "the same frame, again").toBe("Romans 8:28")
    useBroadcastStore.getState().setCountdownSources({ aux: [], item: null, start: 1_900_000_600_000 })
    expect(last().lost).toEqual({ mode: "countdown", startsAt: 1_900_000_600_000 })
    await disableOutput(tv)
  })

  it("log which screen first showed new content and how soon, once per content change (#246 C17)", () => {
    resetFeedShown()
    useJournalStore.setState({ entries: [] })
    const theme = useBroadcastStore.getState().themes[0]
    const verse = (reference: string) => ({ reference, segments: [], lines: [reference] }) as never
    const shown = () => useJournalStore.getState().entries.filter((e) => e.kind === "shown").map((e) => e.label)
    useBroadcastStore.setState({ outputFrames: { tv: { theme, verse: verse("John 3:16"), overlay: null } } })
    noteFeedShown("tv", 412)
    // The page draws a timer beat or the same verse again: not news.
    noteFeedShown("tv", 380)
    useBroadcastStore.setState({ outputFrames: { tv: { theme, verse: verse("John 3:17"), overlay: null } } })
    noteFeedShown("tv", 1250)
    useBroadcastStore.setState({ outputFrames: { tv: { theme, verse: null, overlay: null } } })
    noteFeedShown("tv", 90)
    noteFeedShown("unknown", 100)
    expect(shown()).toEqual(["Foyer TV showed John 3:16 after 0.4 s", "Foyer TV showed John 3:17 after 1.3 s", "Foyer TV showed a clear screen after 0.1 s"])
    expect(useJournalStore.getState().entries.at(-1)).toMatchObject({ outputId: "tv", afterMs: 90 })
  })

  it("logs the scene revision the screen actually showed after the saved scene was edited", () => {
    resetFeedShown()
    useJournalStore.setState({ entries: [] })
    const layer = { id: "background", name: "Background", kind: "color" as const, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true, color: "#000000" }
    const taken = { id: "sermon", name: "Sermon", background: "#000000", layers: [layer], createdAt: 1, updatedAt: 1 }
    const saved = { ...taken, name: "Edited sermon", background: "#ffffff", updatedAt: 2 }
    useBroadcastStore.setState({
      scenes: [saved],
      outputs: useBroadcastStore.getState().outputs.map((o) => o.id === "tv" ? { ...o, sceneId: taken.id, sceneSnapshot: taken } : o),
      outputFrames: { tv: { theme: useBroadcastStore.getState().themes[0], verse: null, overlay: null, scene: { sceneId: taken.id, background: taken.background, layers: [] } } },
    })

    noteFeedShown("tv", 250)

    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Foyer TV showed the Sermon scene after 0.3 s")
  })
})
