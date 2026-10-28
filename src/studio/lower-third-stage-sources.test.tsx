// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const emitTo = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
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
import { existingFeed, FEED_PRESETS, readyMadeFeed } from "@/lib/feed-presets"
import { feedFrame, followerCount } from "@/lib/live-sources"
import { buildLiveState } from "@/lib/live-state"
import { outputPresentation } from "@/lib/output-summary"
import { newLayer, newScene } from "@/lib/scenes"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useTimerStore } from "@/stores/timer-store"
import { LiveSourcesStrip } from "@/studio/present/live-sources-strip"
import { MAIN_OUTPUT_ID, defaultNdiSettings, type BroadcastOutput, type LowerThird, type SceneFrame, type VerseRenderData } from "@/types"

/**
 * The lower third and the stage message as live sources (#243 LS.7, LS.8), the Sources strip
 * counting scene followers (LS.11), the optional feeds (FD.5) and who did what in the log (EX.1).
 */
type Frame = { verse: VerseRenderData | null; overlay?: LowerThird | null; scene?: SceneFrame; stage?: { message?: string } }
const last = (id: string) => emitTo.mock.calls.filter((c) => c[0] === `broadcast-${id}`).map((c) => c[2] as Frame).at(-1)
const entries = () => useJournalStore.getState().entries

let themeId: string
const out = (o: Partial<BroadcastOutput> & { id: string }): BroadcastOutput => ({ name: o.id, type: "ndi", themeId, monitorIndex: 0, ndi: defaultNdiSettings(o.id), ...o })
const PASTOR = { line1: "Pastor Ade Bello", line2: "Lead pastor" }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  emitTo.mockClear()
  themeId = useBroadcastStore.getState().themes[0].id
  useTimerStore.getState().reset()
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveItemId: null, heldLive: null, cleared: false, rehearsal: false, rehearsalReturn: null,
    sources: {}, stateSources: {}, scenes: [], sceneTakes: {}, ticker: null, lowerThird: null, stageMessage: "",
    outputs: [out({ id: MAIN_OUTPUT_ID, type: "display" })],
  })
  useSettingsStore.setState({ operatorName: "Tolu", cameras: [] })
  useJournalStore.setState({ entries: [] })
})

describe("the lower third as a live source", () => {
  it("up, taken down (kept) and restored, each with who and a newer revision, in the log and the Live State", () => {
    const b = useBroadcastStore.getState()
    b.setLowerThird(PASTOR)
    const up = useBroadcastStore.getState().stateSources.lowerThird!
    expect(up).toMatchObject({ on: true, by: "Tolu", lowerThird: { line1: "Pastor Ade Bello" } })
    b.clearSource("lowerThird")
    let s = useBroadcastStore.getState()
    expect(s.lowerThird).toBeNull()
    expect(s.stateSources.lowerThird).toMatchObject({ on: false, lowerThird: { line1: "Pastor Ade Bello", line2: "Lead pastor" } })
    expect(s.stateSources.lowerThird!.revision).toBeGreaterThan(up.revision)
    b.restoreSource("lowerThird")
    s = useBroadcastStore.getState()
    expect(s.lowerThird).toMatchObject(PASTOR)
    expect(s.stateSources.lowerThird?.on).toBe(true)
    expect(entries().map((e) => e.label)).toEqual([
      "Lower third up: Pastor Ade Bello · Lead pastor · by Tolu",
      "Lower third down: Pastor Ade Bello · Lead pastor · by Tolu",
      "Lower third up: Pastor Ade Bello · Lead pastor · by Tolu",
    ])
    expect(entries().every((e) => e.by === "Tolu" && typeof e.revision === "number")).toBe(true)
    const row = buildLiveState().sources.find((x) => x.id === "lowerThird")
    expect(row).toMatchObject({ reference: "Pastor Ade Bello · Lead pastor", on: true, by: "Tolu", state: "up" })
  })

  it("Hide in Present is the same take-down; rehearsal leaves the source alone", () => {
    const b = useBroadcastStore.getState()
    b.setLowerThird(PASTOR)
    b.setLowerThird(null)
    expect(useBroadcastStore.getState().stateSources.lowerThird?.on).toBe(false)
    b.setRehearsal(true)
    const before = useBroadcastStore.getState().stateSources
    b.setLowerThird({ line1: "Rehearsed name", line2: "" })
    b.restoreSource("lowerThird")
    expect(useBroadcastStore.getState().stateSources).toBe(before)
    b.setRehearsal(false)
    // Rehearsal's lower third went back with it; the real one is still down, ready to restore.
    expect(useBroadcastStore.getState().lowerThird).toBeNull()
    b.restoreSource("lowerThird")
    expect(useBroadcastStore.getState().lowerThird?.line1).toBe("Pastor Ade Bello")
  })

  it("Rhema Lower third | Presenter draws only the name band, never the verse; it follows the program for a scripture strip", () => {
    const r = readyMadeFeed(FEED_PRESETS.find((p) => p.id === "presenter-l3")!, "ndi", useBroadcastStore.getState().outputs, useBroadcastStore.getState().themes, () => "l3")
    if (!("output" in r)) throw new Error("not added")
    expect(r.output).toMatchObject({ shows: ["lowerThird"], lowerThirds: true, ndi: { sourceName: "Rhema Lower third | Presenter", alphaMode: "straightAlpha" } })
    expect(outputPresentation(r.output, [], BUILTIN_THEMES[2])).toBe("Lower third only · transparent, for keying")
    // Even with its lower-thirds switch off, following the lower third draws it.
    useBroadcastStore.setState({ outputs: [...useBroadcastStore.getState().outputs, { ...r.output, lowerThirds: undefined }] })
    const b = useBroadcastStore.getState()
    b.setLiveVerse({ reference: "John 3:16", segments: [{ text: "For God so loved the world" }], content: "bible" }, null, { goLive: true })
    b.setLowerThird(PASTOR)
    expect(last("l3")?.verse).toBeNull()
    expect(last("l3")?.overlay?.line1).toBe("Pastor Ade Bello")
    expect(last("main")?.overlay ?? null).toBeNull()
    b.setLowerThird({ line1: "", line2: "", follow: "scripture" })
    expect(last("l3")).toMatchObject({ verse: null, overlay: { line1: "For God so loved the world", line2: "John 3:16" } })
    // A lower-third feed is never content: it is skipped like the ticker.
    expect(feedFrame(useBroadcastStore.getState(), ["lowerThird"])).toBeNull()
  })
})

describe("the stage message as a live source", () => {
  it("sent, cleared and restored from Sources, with who; only the stage screens get it", () => {
    useBroadcastStore.setState({ outputs: [...useBroadcastStore.getState().outputs, out({ id: "stage", type: "display", role: "stage" })] })
    const b = useBroadcastStore.getState()
    b.setStageMessage("Wrap up")
    expect(useBroadcastStore.getState().stateSources.stage).toMatchObject({ on: true, by: "Tolu", message: "Wrap up" })
    expect(last("stage")?.stage?.message).toBe("Wrap up")
    expect(JSON.stringify(last("main") ?? {})).not.toContain("Wrap up")
    b.clearSource("stage")
    expect(useBroadcastStore.getState().stageMessage).toBe("")
    expect(useBroadcastStore.getState().stateSources.stage).toMatchObject({ on: false, message: "Wrap up" })
    b.restoreSource("stage")
    expect(useBroadcastStore.getState().stageMessage).toBe("Wrap up")
    expect(entries().map((e) => [e.kind, e.label])).toEqual([["message", "Wrap up · by Tolu"], ["message", "cleared: Wrap up · by Tolu"], ["message", "Wrap up · by Tolu"]])
    expect(buildLiveState().sources.find((x) => x.id === "stage")).toMatchObject({ reference: "Wrap up", on: true, state: "up" })
  })

  it("a joined desk can take the lower third and the stage message off and back, recorded as theirs", async () => {
    const b = useBroadcastStore.getState()
    b.setLowerThird(PASTOR)
    b.setStageMessage("2 minutes left")
    function Host() {
      useRemoteControl()
      return null
    }
    const root = createRoot(document.createElement("div"))
    await act(async () => root.render(<Host />))
    await act(async () => handlers.get("remote:clear_source")!({ payload: JSON.stringify({ id: "lowerThird", by: "Femi's laptop" }) }))
    await act(async () => handlers.get("remote:clear_source")!({ payload: JSON.stringify({ id: "stage", by: "Femi's laptop" }) }))
    let s = useBroadcastStore.getState()
    expect(s.lowerThird).toBeNull()
    expect(s.stageMessage).toBe("")
    expect(s.stateSources.lowerThird?.by).toBe("Femi's laptop")
    expect(s.stateSources.stage?.by).toBe("Femi's laptop")
    await act(async () => handlers.get("remote:restore_source")!({ payload: JSON.stringify({ id: "stage", by: "Femi's laptop" }) }))
    s = useBroadcastStore.getState()
    expect(s.stageMessage).toBe("2 minutes left")
    root.unmount()
  })
})

describe("Present's Sources strip", () => {
  it("lists a source followed only through a scene's box, counting that feed; and the lower third and stage message chips", async () => {
    const scene = newScene("Sermon")
    scene.layers = [newLayer("camera"), newLayer("feed", { name: "Bible", shows: ["bible"] })]
    useBroadcastStore.setState({ scenes: [scene], outputs: [...useBroadcastStore.getState().outputs, out({ id: "stream", sceneId: scene.id })] })
    const b = useBroadcastStore.getState()
    b.takeScene("stream", scene.id)
    b.saveScene({ ...scene, layers: [newLayer("camera")] })
    b.activateSource({ reference: "Romans 8:28", segments: [], content: "bible" })
    expect(followerCount("bible", useBroadcastStore.getState().outputs, useBroadcastStore.getState().scenes)).toBe(1)
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))
    expect(el.textContent).toContain("Romans 8:28")
    expect(el.textContent).toContain("1 feed")
    await act(async () => {
      b.setLowerThird(PASTOR)
      b.setStageMessage("Wrap up")
    })
    expect(el.textContent).toContain("Lower third")
    expect(el.textContent).toContain("Pastor Ade Bello")
    expect(el.textContent).toContain("Stage message")
    await act(async () => (el.querySelector('[aria-label^="Take Lower third"]') as HTMLButtonElement).click())
    expect(useBroadcastStore.getState().lowerThird).toBeNull()
    await act(async () => (el.querySelector('[aria-label^="Restore Lower third"]') as HTMLButtonElement).click())
    expect(useBroadcastStore.getState().lowerThird?.line1).toBe("Pastor Ade Bello")
    await act(async () => (el.querySelector('[aria-label^="Clear the stage message"]') as HTMLButtonElement).click())
    expect(useBroadcastStore.getState().stageMessage).toBe("")
    root.unmount()
  })
})

describe("scene takes record who took them", () => {
  it("the log's scene entry and the Live State carry the output, the scene, who and the revision", async () => {
    const scene = newScene("Welcome")
    useBroadcastStore.setState({ scenes: [scene] })
    const b = useBroadcastStore.getState()
    b.takeScene(MAIN_OUTPUT_ID, scene.id)
    const take = entries().at(-1)!
    expect(take).toMatchObject({ kind: "scene", label: "main: Welcome · by Tolu", outputId: MAIN_OUTPUT_ID, sceneId: scene.id, by: "Tolu" })
    expect(take.revision).toBe(useBroadcastStore.getState().sceneTakes[MAIN_OUTPUT_ID].revision)
    expect(buildLiveState().outputs[0]).toMatchObject({ sceneId: scene.id, sceneBy: "Tolu", sceneRevision: take.revision })
    b.releaseScene(MAIN_OUTPUT_ID, "Femi's laptop")
    expect(entries().at(-1)).toMatchObject({ kind: "scene", label: "main: back to its own feed · by Femi's laptop", outputId: MAIN_OUTPUT_ID, by: "Femi's laptop" })
    expect(entries().at(-1)!.sceneId).toBeUndefined()
  })

  it("the joined Live State names the taken scene while a saved edit waits for Take", async () => {
    const scene = newScene("Welcome")
    useBroadcastStore.setState({ scenes: [scene] })
    useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, scene.id)
    useBroadcastStore.getState().saveScene({ ...scene, name: "Welcome updated" })
    expect(buildLiveState().outputs[0]).toMatchObject({ sceneName: "Welcome", sceneNeedsUpdate: true })
  })

  it("records an explicit refresh of a saved scene revision", () => {
    const scene = newScene("Sermon")
    useBroadcastStore.setState({ scenes: [scene] })
    const b = useBroadcastStore.getState()
    b.takeScene(MAIN_OUTPUT_ID, scene.id)
    b.saveScene({ ...scene, name: "Sermon updated" })
    expect(entries()).toHaveLength(1)

    b.takeScene(MAIN_OUTPUT_ID, scene.id)

    expect(entries().at(-1)).toMatchObject({ kind: "scene", label: "main: refreshed Sermon updated · by Tolu", outputId: MAIN_OUTPUT_ID, sceneId: scene.id })
    expect(entries().at(-1)?.revision).toBe(useBroadcastStore.getState().sceneTakes[MAIN_OUTPUT_ID].revision)
  })

  it("content put on air is logged with who and its source's revision", () => {
    useBroadcastStore.getState().setLiveVerse({ reference: "John 3:16", segments: [], content: "bible" }, null, { goLive: true, by: "Auto" })
    const live = entries().find((e) => e.kind === "live")!
    expect(live).toMatchObject({ label: "John 3:16", by: "Auto", revision: useBroadcastStore.getState().sources.bible!.revision })
  })
})

describe("the optional feeds (#243 FD.5)", () => {
  it("adds Announcements, Presenter lower third and Clock; the clock comes with its own scene, reused when the church has one", () => {
    const names = FEED_PRESETS.map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(["Rhema Announcements | Full", "Rhema Lower third | Presenter", "Rhema Clock"]))
    const ann = readyMadeFeed(FEED_PRESETS.find((p) => p.id === "announcements-full")!, "browser", [], BUILTIN_THEMES, () => "a")
    if (!("output" in ann)) throw new Error("not added")
    expect(ann.output).toMatchObject({ shows: ["slide"], type: "browser", ndi: { alphaMode: "noneOpaque" } })
    const clock = FEED_PRESETS.find((p) => p.id === "clock")!
    const r = readyMadeFeed(clock, "ndi", [], BUILTIN_THEMES, () => "c")
    if (!("output" in r) || !r.scene) throw new Error("no scene")
    expect(r.scene).toMatchObject({ name: "Rhema Clock", background: "transparent" })
    expect(r.scene.layers.map((l) => l.kind)).toEqual(["clock"])
    expect(r.output).toMatchObject({ sceneId: r.scene.id, ndi: { alphaMode: "straightAlpha" } })
    expect(r.output.shows).toBeUndefined()
    const again = readyMadeFeed(clock, "ndi", [], BUILTIN_THEMES, () => "c2", [{ id: "mine", name: "rhema clock" }])
    if (!("output" in again)) throw new Error("not added")
    expect(again.scene).toBeUndefined()
    expect(again.output.sceneId).toBe("mine")
    expect(existingFeed(clock, [r.output])).toBe(r.output)
  })
})
