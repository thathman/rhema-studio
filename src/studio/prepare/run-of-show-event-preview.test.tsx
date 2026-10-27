// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { newScene } from "@/lib/scenes"
import { sceneStep } from "@/lib/item-intent"
import type { BroadcastOutput, QueueItem } from "@/types"
import { RunOfShowEventEditor } from "./run-of-show-event-editor"

const moment: QueueItem = {
  id: "prayer-scripture",
  kind: "verse",
  verse: { book_number: 43, book_name: "John", chapter: 3, verse: 16, text: "For God so loved the world" },
  reference: "John 3:16",
  confidence: 1,
  source: "manual",
  added_at: 0,
  scene_id: "prayer-scene",
  on_take: [sceneStep("prayer-scene", "sanctuary")],
} as unknown as QueueItem

const output: BroadcastOutput = {
  id: "sanctuary",
  name: "Sanctuary",
  type: "display",
  role: "congregation",
  sceneId: "prayer-scene",
  themeId: "default",
  monitorIndex: 0,
  ndi: { sourceName: "Sanctuary", resolution: "r1080p", frameRate: "fps30", alphaMode: "noneOpaque" },
}

const overflowOutput: BroadcastOutput = {
  ...output,
  id: "overflow",
  name: "Overflow",
  sceneId: "overflow-scene",
  ndi: { ...output.ndi, sourceName: "Overflow" },
}

let root: Root | null = null

function render(header: Parameters<typeof RunOfShowEventEditor>[0]["header"]) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root!.render(<RunOfShowEventEditor header={header} onOpenMoment={() => {}} />))
  return el
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe("Run of Show event preview", () => {
  it("previews the event's selected moment and planned scene without taking it live", async () => {
    const scene = newScene("Prayer camera and Scripture")
    scene.id = "prayer-scene"
    const overflowScene = newScene("Overflow current scene")
    overflowScene.id = "overflow-scene"
    useQueueStore.setState({
      items: [moment],
      headers: [{ id: "prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
    })
    useBroadcastStore.setState({
      scenes: [scene, overflowScene],
      outputs: [overflowOutput, output],
      isLive: true,
      liveItemId: "currently-on-air",
      liveVerse: { reference: "Psalm 23:1", segments: [{ text: "The Lord is my shepherd" }] },
    })
    const before = {
      isLive: useBroadcastStore.getState().isLive,
      liveItemId: useBroadcastStore.getState().liveItemId,
      liveVerse: useBroadcastStore.getState().liveVerse,
      outputs: structuredClone(useBroadcastStore.getState().outputs),
    }
    const takeScene = vi.spyOn(useBroadcastStore.getState(), "takeScene")

    const el = render(useQueueStore.getState().headers[0])
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Event preview"]')
    expect(tab).not.toBeNull()
    await act(async () => { tab!.focus(); tab!.click() })

    expect(el.querySelector('[aria-label="Preview of Prayer camera and Scripture"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Selected moment content preview"]')).not.toBeNull()
    expect(el.querySelector<HTMLSelectElement>('[aria-label="Preview audience screen"]')?.value).toBe("sanctuary")
    expect(el.textContent).toContain("Opening Prayer")
    expect(el.textContent).toContain("Sanctuary")
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: before.isLive,
      liveItemId: before.liveItemId,
      liveVerse: before.liveVerse,
      outputs: before.outputs,
    })
    expect(takeScene).not.toHaveBeenCalled()
    takeScene.mockRestore()
  })
})
