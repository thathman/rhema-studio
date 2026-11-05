// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (event: string, fn: (e: { payload: string }) => void) => {
    handlers.set(event, fn)
    return () => handlers.delete(event)
  }),
}))

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { REMOTE_EVENTS } from "@/lib/remote-events"
import { SCENE_PRESETS, newScene } from "@/lib/scenes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { MAIN_OUTPUT_ID, defaultNdiSettings, type BroadcastOutput, type Program } from "@/types"

/**
 * #410: the host applies the main desk's scene approval rule to a joined desk's or the API's scene
 * Take, group Take and release, from its own state, so a desk never changes a scene the host refuses.
 */
const camera = { ...newScene("Camera with the Bible", SCENE_PRESETS[3]), id: "cam" }
const lyrics = { ...newScene("Lyrics on a picture", SCENE_PRESETS[2]), id: "lyr" }
const main = () => useBroadcastStore.getState().outputs.find((o) => o.id === MAIN_OUTPUT_ID)!
const unapproved = { id: "svc", title: "Sunday", revision: 2, approved_revision: null } as unknown as Program

async function mountHost() {
  const root = createRoot(document.createElement("div"))
  function Host() {
    useRemoteControl()
    return null
  }
  await act(async () => root.render(createElement(Host)))
  await vi.waitFor(() => expect(handlers.has(REMOTE_EVENTS.take_scene)).toBe(true))
  return root
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const themeId = useBroadcastStore.getState().themes[0].id
  const base = { type: "display" as const, themeId, monitorIndex: 0, ndi: defaultNdiSettings() }
  const outputs: BroadcastOutput[] = [
    { ...base, id: MAIN_OUTPUT_ID, name: "Sanctuary", sceneId: "lyr" },
    { ...base, id: "overflow", name: "Overflow", monitorIndex: 1 },
  ]
  useBroadcastStore.setState({ outputs, scenes: [camera, lyrics], rehearsal: false, sources: {} })
  useServiceStore.setState({ current: unapproved })
  useSettingsStore.setState({ requireApproval: true })
})

describe("a desk's scene Take on the host follows the host's approval rule (#410)", () => {
  it("refuses a desk's scene Take on a service never approved, as the main desk does", async () => {
    const root = await mountHost()
    await act(async () => handlers.get(REMOTE_EVENTS.take_scene)!({ payload: JSON.stringify({ output: MAIN_OUTPUT_ID, scene: "cam", by: "Screens desk" }) }))
    expect(main().sceneId).toBe("lyr")
    await act(async () => root.unmount())
  })

  it("refuses a desk's group Take on a service never approved, and records why", async () => {
    const root = await mountHost()
    const failure = vi.spyOn(useBroadcastStore.getState(), "recordGroupTakeFailure")
    await act(async () => handlers.get(REMOTE_EVENTS.group_take_scene)!({ payload: JSON.stringify({
      requestId: "r1", outputs: [MAIN_OUTPUT_ID, "overflow"], scene: "cam", byId: "desk", service: "svc", by: "Screens desk",
      seen: { "scene:cam": 1, [`output:${MAIN_OUTPUT_ID}`]: 1, "output:overflow": 1 },
    }) }))
    expect(failure).toHaveBeenCalledWith("r1", [MAIN_OUTPUT_ID, "overflow"], "cam", "Approve this service before taking a scene to Program.", expect.anything())
    expect(main().sceneId).toBe("lyr")
    await act(async () => root.unmount())
  })

  it("refuses a desk's release on a service never approved; with the setting off it releases", async () => {
    const root = await mountHost()
    await act(async () => handlers.get(REMOTE_EVENTS.release_scene)!({ payload: JSON.stringify({ output: MAIN_OUTPUT_ID, by: "Screens desk" }) }))
    expect(main().sceneId).toBe("lyr")
    useSettingsStore.setState({ requireApproval: false })
    await act(async () => handlers.get(REMOTE_EVENTS.release_scene)!({ payload: JSON.stringify({ output: MAIN_OUTPUT_ID, by: "Screens desk" }) }))
    expect(main().sceneId).toBeUndefined()
    await act(async () => root.unmount())
  })
})
