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

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { cueImpact } from "@/lib/cues"
import { REMOTE_EVENTS } from "@/lib/remote-events"
import { SCENE_PRESETS, newScene } from "@/lib/scenes"
import { resetTimerLogged } from "@/lib/timer-reset"
import { leaveRehearsal, showRehearsalLive } from "@/stores/approval-gate-store"
import { outputsForScreens, tickerForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { ProductionWorkspace } from "@/studio/production/production-workspace"
import { MAIN_OUTPUT_ID, defaultNdiSettings, type BroadcastOutput } from "@/types"
import { useJournalStore } from "@/stores/journal-store"
import { useTimerStore } from "@/stores/timer-store"

/**
 * Rehearsal is a sandbox for the whole host (ADR 0001): the lower third, the ticker, the stage
 * message and the service timer come back as they were, and the service log keeps only what was real.
 */
beforeEach(() => {
  useBroadcastStore.setState({ rehearsal: false, rehearsalReturn: null, isLive: false, liveVerse: null, lowerThird: null, ticker: null, tickerItems: ["Prayer meeting Wednesday 6:30 PM"], stageMessage: "" })
  useJournalStore.setState({ entries: [] })
  useTimerStore.getState().reset()
})

describe("rehearsal is a sandbox (ARCH-003)", () => {
  it("a lower third, ticker and stage message set in rehearsal are gone after it; the real ones stay", () => {
    const b = useBroadcastStore.getState()
    b.setLowerThird({ line1: "Pastor Tolu", line2: "Senior pastor" })
    b.setRehearsal(true)
    b.setLowerThird({ line1: "Guest speaker", line2: "" })
    b.setStageMessage("Rehearsal note")
    b.setTicker({ backing: null })
    expect(tickerForScreens(useBroadcastStore.getState())).toBeNull()
    leaveRehearsal()
    const s = useBroadcastStore.getState()
    expect(s.lowerThird?.line1).toBe("Pastor Tolu")
    expect(s.stageMessage).toBe("")
    expect(s.ticker).toBeNull()
  })

  it("a ticker running before rehearsal keeps running on the screens through it", () => {
    const b = useBroadcastStore.getState()
    b.setTicker({ backing: null })
    const real = useBroadcastStore.getState().ticker
    b.setRehearsal(true)
    b.setTicker(null)
    expect(tickerForScreens(useBroadcastStore.getState())).toBe(real)
    leaveRehearsal()
    expect(useBroadcastStore.getState().ticker).toBe(real)
  })

  it("a timer reset in rehearsal touches neither the real timer nor the service log", () => {
    useTimerStore.getState().start()
    const real = useTimerStore.getState().timer
    useBroadcastStore.getState().setRehearsal(true)
    resetTimerLogged()
    useTimerStore.getState().start()
    leaveRehearsal()
    expect(useTimerStore.getState().timer).toEqual(real)
    expect(useJournalStore.getState().entries.map((e) => e.kind)).toEqual(["rehearsal", "rehearsal"])
  })
})

describe("cue steps say what they touch (C04)", () => {
  it("names each kind of effect once, in order, before the cue runs", () => {
    expect(cueImpact(["rehearsal.off", "timer.fresh", "quick.welcome"])).toEqual([
      "Leaves rehearsal: the real program comes back",
      "Changes the service timer",
      "Puts a screen over what the main screens show",
    ])
    expect(cueImpact(["quick.black", "ticker.stop"])).toEqual(["Covers every screen and feed", "Starts or stops the ticker"])
    expect(cueImpact(["next", "showLive"])).toEqual(["Changes what the main screens show"])
  })
})

/**
 * Scenes in rehearsal (#246, C02): a Take from Production → Programs, the Present scenes strip or a
 * joined Screens desk changes the rehearsal only. The real screens keep their scene through it and
 * have exactly it when rehearsal ends, Show this live included.
 */
describe("a scene taken in rehearsal never reaches the real screens", () => {
  const camera = { ...newScene("Camera with the Bible", SCENE_PRESETS[3]), id: "cam" }
  const lyrics = { ...newScene("Lyrics on a picture", SCENE_PRESETS[2]), id: "lyr" }
  const MAIN_WINDOW = `broadcast-${MAIN_OUTPUT_ID}`
  /** What the real Sanctuary window was sent, newest last. */
  const sent = () => emitTo.mock.calls.filter((c) => c[0] === MAIN_WINDOW).map((c) => c[2] as { scene?: { sceneId?: string } | undefined })
  const main = () => useBroadcastStore.getState().outputs.find((o) => o.id === MAIN_OUTPUT_ID)!

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const themeId = useBroadcastStore.getState().themes[0].id
    const base = { type: "display" as const, themeId, monitorIndex: 0, ndi: defaultNdiSettings() }
    const outputs: BroadcastOutput[] = [
      { ...base, id: MAIN_OUTPUT_ID, name: "Sanctuary", sceneId: "lyr" },
      { ...base, id: "overflow", name: "Overflow", monitorIndex: 1 },
    ]
    useBroadcastStore.setState({ outputs, scenes: [camera, lyrics], sceneReturn: { overflow: "cam" }, sources: {} })
    emitTo.mockClear()
  })

  /** Rehearsal is on, then `take` runs; the real screens are checked during and after. */
  async function rehearse(take: () => Promise<void> | void, leave: () => void = leaveRehearsal) {
    useBroadcastStore.getState().setRehearsal(true)
    const framesBefore = useBroadcastStore.getState().outputFrames
    await take()
    const during = useBroadcastStore.getState()
    // Nothing was sent to a real screen, the multiview still shows the real frames, and what is
    // saved (a restart) is the real scene.
    expect(sent()).toEqual([])
    expect(during.outputFrames).toBe(framesBefore)
    expect(outputsForScreens(during).map((o) => o.sceneId)).toEqual(["lyr", undefined])
    await act(async () => leave())
    const after = useBroadcastStore.getState()
    expect(after.outputs.map((o) => o.sceneId)).toEqual(["lyr", undefined])
    expect(after.sceneReturn).toEqual({ overflow: "cam" })
    expect(sent().at(-1)?.scene?.sceneId).toBe("lyr")
    return during
  }

  it("store: Take, own feed and Restore in rehearsal are undone when it ends", async () => {
    const during = await rehearse(() => {
      const b = useBroadcastStore.getState()
      b.takeScene(MAIN_OUTPUT_ID, "cam")
      b.takeScene("overflow", "lyr")
      b.releaseScene("overflow")
    })
    // The rehearsal itself shows what was taken.
    expect(during.outputs.map((o) => o.sceneId)).toEqual(["cam", undefined])
    expect(during.sceneReturn).toEqual({ [MAIN_OUTPUT_ID]: "cam", overflow: "lyr" })
  })

  it("store: Show this live sends the rehearsed words but not the rehearsed scene", async () => {
    await rehearse(() => useBroadcastStore.getState().takeScene(MAIN_OUTPUT_ID, "cam"), showRehearsalLive)
  })

  it("store: a scene deleted in rehearsal leaves its screen on its own feed", async () => {
    useBroadcastStore.getState().setRehearsal(true)
    useBroadcastStore.getState().deleteScene("lyr")
    leaveRehearsal()
    expect(main().sceneId).toBeUndefined()
  })

  it("Production → Programs: Take in rehearsal is not red and stays in the app", async () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => root.render(createElement(ProductionWorkspace)))
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Programs") as HTMLButtonElement
    await act(async () => tab.click())
    const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
    await act(async () => button("Camera with the Bible").click())
    await rehearse(async () => {
      await act(async () => button("Take Camera with the Bible").click())
      expect(main().sceneId).toBe("cam")
      expect(button("Take Camera with the Bible").className).not.toContain("bg-live-pulse")
      expect(el.textContent).toContain("Rehearsal ·")
    })
    await act(async () => root.unmount())
    el.remove()
  })

  it("a joined Screens desk's Take (remote:take_scene) in rehearsal stays in the rehearsal", async () => {
    const root = createRoot(document.createElement("div"))
    function Host() {
      useRemoteControl()
      return null
    }
    await act(async () => root.render(createElement(Host)))
    await vi.waitFor(() => expect(handlers.has(REMOTE_EVENTS.take_scene)).toBe(true))
    await rehearse(async () => {
      await act(async () => handlers.get(REMOTE_EVENTS.take_scene)!({ payload: JSON.stringify({ output: MAIN_OUTPUT_ID, scene: "cam", by: "Screens desk" }) }))
      expect(main().sceneId).toBe("cam")
      await act(async () => handlers.get(REMOTE_EVENTS.release_scene)!({ payload: JSON.stringify({ output: MAIN_OUTPUT_ID, by: "Screens desk" }) }))
      expect(main().sceneId).toBeUndefined()
    })
    await act(async () => root.unmount())
  })
})
