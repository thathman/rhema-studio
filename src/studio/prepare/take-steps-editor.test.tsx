// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { defaultNdiSettings, type QueueItem } from "@/types"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { newScene } from "@/lib/scenes"
import { sceneStep } from "@/lib/item-intent"
import { TakeSteps } from "./item-editor-parts"

const sanctuaryScene = newScene("Sanctuary · Bible")
const overflowScene = newScene("Overflow · Lyrics")
const item: QueueItem = {
  id: "sermon",
  kind: "slide",
  slide: { title: "Sermon", body: "" },
  reference: "Sermon",
  confidence: 1,
  source: "manual",
  added_at: 0,
  scene_id: sanctuaryScene.id,
} as QueueItem

let root: Root | null = null
let element: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useQueueStore.setState({ items: [item], headers: [], activeIndex: null })
  useBroadcastStore.setState({
    scenes: [sanctuaryScene, overflowScene],
    outputs: [
      { id: "main", name: "Sanctuary", type: "display", themeId: "classic-dark", monitorIndex: 0, ndi: defaultNdiSettings() },
      { id: "overflow", name: "Overflow", type: "browser", role: "congregation", themeId: "classic-dark", monitorIndex: 0, ndi: defaultNdiSettings() },
    ],
    sceneTakes: {},
    rehearsal: false,
    isLive: false,
    liveVerse: null,
  })
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function renderEditor() {
  await act(async () => root!.render(<TakeSteps item={item} />))
}

function changeSelect(select: HTMLSelectElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  setValue?.call(select, value)
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

describe("Prepare scene assignments by congregation output", () => {
  it("saves an all-screen scene and a deliberate per-screen override without taking either live", async () => {
    await renderEditor()

    const allScreens = element.querySelector<HTMLInputElement>('[aria-label="Take planned scene on all congregation screens"]')!
    await act(async () => allScreens.click())
    const overflow = element.querySelector<HTMLSelectElement>('[aria-label="Scene on Overflow when Sermon is taken"]')!
    await act(async () => changeSelect(overflow, overflowScene.id))

    expect(useQueueStore.getState().items[0].on_take).toEqual([
      sceneStep(sanctuaryScene.id),
      sceneStep(overflowScene.id, "overflow"),
    ])
    expect(useBroadcastStore.getState().outputs.map((output) => output.sceneId ?? null)).toEqual([null, null])
    expect(useBroadcastStore.getState().sceneTakes).toEqual({})
  })
})
