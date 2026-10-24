// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const emitTo = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
const handlers = new Map<string, (e: { payload: string }) => void>()
// The camera router: Pulpit sends, Choir does not.
const router = vi.hoisted(() => ({ installed: true, running: true, wanted: true, lanAddress: "192.168.1.10", ports: { webrtc: 8889, webrtcUdp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 }, restarts: 0, error: null, paths: [{ name: "pulpit", live: true, source: null, readers: 1, tracks: ["H264"] }] }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "camera_router_status" ? router : null)) }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: (...args: unknown[]) => emitTo(...args),
  listen: vi.fn(async (event: string, fn: (e: { payload: string }) => void) => {
    handlers.set(event, fn)
    return () => handlers.delete(event)
  }),
}))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { useRouterHealth } from "@/lib/cameras"
import { readyMadeFeed, FEED_PRESETS } from "@/lib/feed-presets"
import { buildLiveState } from "@/lib/live-state"
import { putBack, type LiveSnapshot } from "@/lib/live-recovery"
import { newLayer, newScene } from "@/lib/scenes"
import { leaveRehearsal } from "@/stores/approval-gate-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useTimerStore } from "@/stores/timer-store"
import { LiveSourcesStrip } from "@/studio/present/live-sources-strip"
import { MAIN_OUTPUT_ID, defaultNdiSettings, type BroadcastOutput, type SceneFrame, type Ticker, type VerseRenderData } from "@/types"

/**
 * The ticker, the service timer and each camera as live sources (#243, ADR 0001): each shows in
 * Present → Sources with its state, has its own scoped action, records who changed it and when, is
 * in the service log and the Live State, and is left alone by rehearsal.
 */
type Frame = { verse: VerseRenderData | null; ticker?: Ticker | null; scene?: SceneFrame }
const last = (id: string) => emitTo.mock.calls.filter((c) => c[0] === `broadcast-${id}`).map((c) => c[2] as Frame).at(-1)
const labels = () => useJournalStore.getState().entries.map((e) => e.label)
const PULPIT = "http://192.168.1.10:8889/pulpit/whep"
const CHOIR = "http://192.168.1.10:8889/choir/whep"

let themeId: string
const out = (o: Partial<BroadcastOutput> & { id: string }): BroadcastOutput => ({ name: o.id, type: "ndi", themeId, monitorIndex: 0, ndi: defaultNdiSettings(o.id), ...o })

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  emitTo.mockClear()
  themeId = useBroadcastStore.getState().themes[0].id
  useTimerStore.getState().reset()
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveItemId: null, heldLive: null, cleared: false, rehearsal: false, rehearsalReturn: null,
    sources: {}, stateSources: {}, scenes: [], ticker: null, tickerItems: ["Prayer meeting Wednesday 6:30 PM", "Youth camp in August"],
    outputs: [out({ id: MAIN_OUTPUT_ID, type: "display" })],
  })
  useSettingsStore.setState({ operatorName: "Tolu", cameras: [{ name: "pulpit", label: "Pulpit", token: "0123456789abcdef0123" }, { name: "choir", label: "Choir", token: "0123456789abcdef0124" }] })
  useRouterHealth.setState({ status: router, checked: true })
  useJournalStore.setState({ entries: [] })
})

describe("the ticker as a live source", () => {
  it("on, taken off (its words kept) and restored, each with who and when, in the service log", () => {
    const b = useBroadcastStore.getState()
    const before = Date.now()
    b.setTicker({ backing: null })
    const on = useBroadcastStore.getState().stateSources.ticker!
    expect(on).toMatchObject({ on: true, by: "Tolu" })
    expect(on.activatedAt).toBeGreaterThanOrEqual(before)
    const running = useBroadcastStore.getState().ticker!
    b.clearSource("ticker")
    let s = useBroadcastStore.getState()
    expect(s.ticker).toBeNull()
    expect(s.stateSources.ticker).toMatchObject({ on: false, ticker: running })
    expect(s.stateSources.ticker!.revision).toBeGreaterThan(on.revision)
    // The words changed meanwhile: Restore brings back the ticker that was taken off.
    b.setTickerItems(["Something else"])
    b.restoreSource("ticker")
    s = useBroadcastStore.getState()
    expect(s.ticker?.items).toEqual(running.items)
    expect(s.ticker?.pausedAt).toBeUndefined()
    expect(s.stateSources.ticker?.on).toBe(true)
    expect(labels()).toEqual(["Ticker on: Prayer meeting Wednesday 6:30 PM · by Tolu", "Ticker off: Prayer meeting Wednesday 6:30 PM · by Tolu", "Ticker back: Prayer meeting Wednesday 6:30 PM · by Tolu"])
  })

  it("Stop in Present is the same take-off: Restore brings it back; held still is still on", () => {
    const b = useBroadcastStore.getState()
    b.setTicker({ backing: null })
    b.pauseTicker(true)
    expect(useBroadcastStore.getState().stateSources.ticker?.on).toBe(true)
    expect(labels().at(-1)).toBe("Ticker held still: Prayer meeting Wednesday 6:30 PM · by Tolu")
    b.setTicker(null)
    expect(useBroadcastStore.getState().stateSources.ticker?.on).toBe(false)
    b.restoreSource("ticker")
    expect(useBroadcastStore.getState().ticker?.pausedAt).toBeUndefined()
  })

  it("an output that follows only the ticker (Rhema Ticker | Alpha) gets the ticker and no service content; Black covers it", () => {
    const r = readyMadeFeed(FEED_PRESETS.find((p) => p.id === "ticker-alpha")!, "ndi", useBroadcastStore.getState().outputs, useBroadcastStore.getState().themes, () => "tk")
    if (!("output" in r)) throw new Error("not added")
    // Even without its ticker switch, following the ticker draws it.
    useBroadcastStore.setState({ outputs: [...useBroadcastStore.getState().outputs, { ...r.output, ticker: undefined }] })
    const b = useBroadcastStore.getState()
    b.setTicker({ backing: null })
    expect(last("tk")?.ticker?.items[0]).toBe("Prayer meeting Wednesday 6:30 PM")
    b.setLiveVerse({ reference: "Romans 8:28", segments: [], content: "bible" }, null, { goLive: true })
    expect(last("tk")?.verse).toBeNull()
    expect(last("main")?.verse?.reference).toBe("Romans 8:28")
    b.setLiveVerse({ reference: "", segments: [], screen: "black", quick: true }, null, { goLive: true })
    expect(last("tk")?.verse?.screen).toBe("black")
    // Taken off: the ticker feed goes empty.
    b.setLiveVerse({ reference: "Romans 8:28", segments: [], content: "bible" }, null, { goLive: true })
    b.clearSource("ticker")
    expect(last("tk")?.ticker ?? null).toBeNull()
  })
})

describe("the service timer as a live source", () => {
  it("started, paused and resumed from Sources, each with who, in the service log; reset ends it", () => {
    useTimerStore.getState().setDurationMinutes(30)
    useTimerStore.getState().start()
    expect(useBroadcastStore.getState().stateSources.timer).toMatchObject({ on: true, by: "Tolu", activatedAt: expect.any(Number) })
    const b = useBroadcastStore.getState()
    b.clearSource("timer")
    expect(useTimerStore.getState().timer.startedAt).toBeNull()
    expect(useBroadcastStore.getState().stateSources.timer?.on).toBe(false)
    b.restoreSource("timer")
    expect(useTimerStore.getState().timer.startedAt).not.toBeNull()
    expect(labels()).toEqual(["Tolu: timer started", "Tolu: timer paused", "Tolu: timer resumed"])
    useTimerStore.getState().reset()
    expect(useBroadcastStore.getState().stateSources.timer).toBeUndefined()
    // Resume does nothing to a timer that never ran.
    b.restoreSource("timer")
    expect(useTimerStore.getState().timer.startedAt).toBeNull()
  })
})

describe("cameras as live sources", () => {
  const sceneWithCameras = () => {
    const scene = newScene("Sermon")
    scene.layers = [newLayer("camera", { name: "Pulpit camera", cameraUrl: PULPIT, cameraFallback: "Camera back shortly" }), newLayer("camera", { name: "Choir camera", cameraUrl: CHOIR })]
    return scene
  }

  it("hide from scenes: every scene layer of that camera shows its fallback, the scene itself unchanged; Restore plays it again", () => {
    const scene = sceneWithCameras()
    useBroadcastStore.setState({ scenes: [scene], outputs: [out({ id: MAIN_OUTPUT_ID, type: "display", sceneId: scene.id })] })
    useJournalStore.setState({ entries: [] })
    const b = useBroadcastStore.getState()
    b.syncBroadcastOutput()
    expect(last("main")?.scene?.layers.map((l) => l.cameraUrl)).toEqual([PULPIT, CHOIR])
    b.clearSource("camera:pulpit")
    const held = last("main")!.scene!.layers
    expect(held[0].cameraUrl).toBeUndefined()
    expect(held[0].fallback).toBe("Camera back shortly")
    expect(held[1].cameraUrl).toBe(CHOIR)
    expect(useBroadcastStore.getState().scenes[0]).toEqual(scene)
    expect(useBroadcastStore.getState().stateSources["camera:pulpit"]).toMatchObject({ on: false, by: "Tolu" })
    b.restoreSource("camera:pulpit")
    expect(last("main")?.scene?.layers.map((l) => l.cameraUrl)).toEqual([PULPIT, CHOIR])
    expect(labels()).toEqual(["Pulpit camera hidden from scenes · by Tolu", "Pulpit camera back in scenes · by Tolu"])
  })

  it("Black still covers a scene with cameras", () => {
    const scene = sceneWithCameras()
    useBroadcastStore.setState({ scenes: [scene], outputs: [out({ id: MAIN_OUTPUT_ID, type: "display", sceneId: scene.id })] })
    useBroadcastStore.getState().setLiveVerse({ reference: "", segments: [], screen: "black", quick: true }, null, { goLive: true })
    expect(last("main")?.scene).toBeUndefined()
    expect(last("main")?.verse?.screen).toBe("black")
  })
})

describe("in the Live State, for joined desks", () => {
  it("lists the ticker, the timer and each camera after the content sources, with state, who and when", () => {
    const b = useBroadcastStore.getState()
    b.setTicker({ backing: null })
    useTimerStore.getState().setDurationMinutes(30)
    useTimerStore.getState().start()
    useTimerStore.getState().pause()
    b.clearSource("camera:choir")
    const rows = buildLiveState().sources
    expect(rows.find((r) => r.id === "ticker")).toMatchObject({ reference: "Prayer meeting Wednesday 6:30 PM", on: true, by: "Tolu", state: "running", activatedAt: expect.any(Number) })
    expect(rows.find((r) => r.id === "timer")).toMatchObject({ on: false, by: "Tolu", state: "paused", reference: expect.stringMatching(/^Paused · 30:00 left$|^Paused · 29:59 left$/) })
    expect(rows.find((r) => r.id === "camera:pulpit")).toEqual({ id: "camera:pulpit", reference: "Pulpit", on: true, revision: 0, state: "sending" })
    expect(rows.find((r) => r.id === "camera:choir")).toMatchObject({ reference: "Choir", on: false, by: "Tolu", state: "hidden" })
  })
})

describe("from a joined desk or phone", () => {
  it("takes the ticker off, pauses the timer and hides a camera as the desk; an unknown camera is refused", async () => {
    const el = document.createElement("div")
    const root = createRoot(el)
    function Host() {
      useRemoteControl()
      return null
    }
    await act(async () => root.render(<Host />))
    await vi.waitFor(() => expect(handlers.has("remote:clear_source")).toBe(true))
    useBroadcastStore.getState().setTicker({ backing: null })
    useTimerStore.getState().start()
    await act(async () => handlers.get("remote:clear_source")!({ payload: JSON.stringify({ id: "ticker", by: "Femi's laptop" }) }))
    await act(async () => handlers.get("remote:timer_pause")!({ payload: JSON.stringify({ by: "Timekeeper desk" }) }))
    await act(async () => handlers.get("remote:clear_source")!({ payload: JSON.stringify({ id: "camera:pulpit", by: "Femi's laptop" }) }))
    await act(async () => handlers.get("remote:clear_source")!({ payload: JSON.stringify({ id: "camera:nobody", by: "Femi's laptop" }) }))
    const st = useBroadcastStore.getState().stateSources
    expect(st.ticker).toMatchObject({ on: false, by: "Femi's laptop" })
    expect(st.timer).toMatchObject({ on: false, by: "Timekeeper desk" })
    expect(st["camera:pulpit"]).toMatchObject({ on: false, by: "Femi's laptop" })
    expect(st["camera:nobody"]).toBeUndefined()
    expect(labels()).toContain("Timekeeper desk: timer paused")
    await act(async () => handlers.get("remote:restore_source")!({ payload: JSON.stringify({ id: "timer", by: "Femi's laptop" }) }))
    expect(useBroadcastStore.getState().stateSources.timer).toMatchObject({ on: true, by: "Femi's laptop" })
    root.unmount()
  })
})

describe("rehearsal leaves the real ticker, timer and cameras alone", () => {
  it("nothing done in rehearsal changes them or reaches the log; Sources' buttons wait", async () => {
    const b = useBroadcastStore.getState()
    b.setTicker({ backing: null })
    useTimerStore.getState().start()
    const real = useBroadcastStore.getState().stateSources
    const logged = labels().length
    b.setRehearsal(true)
    b.setTicker(null)
    b.setTicker({ backing: null })
    useTimerStore.getState().pause()
    b.clearSource("camera:pulpit")
    b.clearSource("ticker")
    expect(useBroadcastStore.getState().stateSources).toBe(real)
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))
    const buttons = [...el.querySelectorAll("button")].filter((x) => x.getAttribute("aria-label")?.match(/Ticker|timer|camera/))
    expect(buttons.length).toBeGreaterThanOrEqual(4)
    expect(buttons.every((x) => x.disabled)).toBe(true)
    root.unmount()
    leaveRehearsal()
    expect(useBroadcastStore.getState().stateSources).toBe(real)
    expect(useTimerStore.getState().timer.startedAt).not.toBeNull()
    // Only rehearsal on and off was logged meanwhile.
    expect(labels().slice(logged)).toEqual(["on", "off"])
  })
})

describe("Present → Sources", () => {
  it("shows the ticker, the timer and each camera with their state, and their actions work", async () => {
    const scene = newScene("Sermon")
    scene.layers = [newLayer("camera", { cameraUrl: PULPIT })]
    useBroadcastStore.setState({ scenes: [scene] })
    useBroadcastStore.getState().setTicker({ backing: null })
    useTimerStore.getState().setDurationMinutes(10)
    useTimerStore.getState().start()
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))
    const text = el.textContent ?? ""
    expect(text).toContain("Ticker")
    expect(text).toContain("running · Prayer meeting")
    expect(text).toMatch(/Timer.*running · (10:00|9:59) left/)
    expect(text).toContain("Pulpit cameraSending")
    expect(text).toContain("in 1 scene")
    expect(text).toContain("Choir cameraNot sending")
    const click = async (label: string) => act(async () => (el.querySelector(`[aria-label^="${label}"]`) as HTMLButtonElement).click())
    await click("Take Ticker")
    expect(useBroadcastStore.getState().ticker).toBeNull()
    expect(el.textContent).toContain("off · Prayer meeting")
    await click("Restore Ticker")
    expect(useBroadcastStore.getState().ticker).not.toBeNull()
    await click("Pause the service timer")
    expect(useTimerStore.getState().timer.startedAt).toBeNull()
    await click("Resume the service timer")
    expect(useTimerStore.getState().timer.startedAt).not.toBeNull()
    await click("Hide Pulpit camera")
    expect(el.textContent).toContain("hidden from scenes")
    await click("Show Pulpit camera")
    expect(useBroadcastStore.getState().stateSources["camera:pulpit"]?.on).toBe(true)
    root.unmount()
  })
})

describe("older saved data", () => {
  it("a recovery snapshot and outputs from before (no ticker, timer or camera sources) load and work", async () => {
    const old = { v: 1, at: Date.now(), service: null, isLive: false, liveVerse: null, liveItemId: null, outputsOn: [], scenes: {}, eventId: null,
      sources: { bible: { value: { reference: "John 3:16", segments: [], content: "bible" }, itemId: null, revision: 4, activatedAt: 1000, on: true } } } as LiveSnapshot
    await putBack(old)
    expect(useBroadcastStore.getState().stateSources).toEqual({})
    // An output saved by an earlier build: the ticker switch, shows content only, and the old signage ticker feed.
    const saved = JSON.parse(JSON.stringify([
      out({ id: MAIN_OUTPUT_ID, type: "display", ticker: true }),
      out({ id: "l3", shows: ["bible"] }),
      out({ id: "old-tk", role: "signage", ticker: true, signage: { mediaIds: [], seconds: 10 } }),
    ])) as BroadcastOutput[]
    useBroadcastStore.setState({ outputs: saved })
    useBroadcastStore.getState().syncBroadcastOutput()
    useBroadcastStore.getState().setTicker({ backing: null })
    expect(last("main")?.ticker?.items[0]).toBe("Prayer meeting Wednesday 6:30 PM")
    expect(last("l3")?.verse?.reference).toBe("John 3:16")
    await vi.waitFor(() => expect(last("old-tk")?.ticker?.items[0]).toBe("Prayer meeting Wednesday 6:30 PM"))
  })
})
