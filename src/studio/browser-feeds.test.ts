import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
const emitTo = vi.fn().mockResolvedValue(undefined)
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => { calls.push({ cmd, args }); return null }) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: (...a: unknown[]) => emitTo(...a), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { enableOutput, disableOutput } = await import("@/lib/broadcast-output-control")
const { outputOnAir } = await import("@/lib/output-on-air")
const { startBrowserFeeds, feedUrl } = await import("@/lib/browser-feeds")
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
    expect(calls.find((c) => c.cmd === "feeds_set")?.args).toEqual({ feeds: [{ id: "tv", token: tv.feedToken }] })
    useBroadcastStore.getState().updateOutput("tv", { feedToken: "f".repeat(32) })
    expect(calls.filter((c) => c.cmd === "feeds_set").at(-1)?.args).toEqual({ feeds: [{ id: "tv", token: "f".repeat(32) }] })
    expect(feedUrl("192.168.1.20", 8080, "tv", "abc")).toBe("http://192.168.1.20:8080/feed/tv?k=abc")
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
})
