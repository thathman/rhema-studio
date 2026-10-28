// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { newScene } from "@/lib/scenes"
import { sceneStep } from "@/lib/item-intent"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { defaultNdiSettings, MAIN_OUTPUT_ID, type BroadcastOutput, type QueueItem } from "@/types"
import { TakeSteps } from "./item-editor-parts"

const item = (on_take: QueueItem["on_take"] = [], scene_id = "shared-scene"): QueueItem => ({
  id: "sermon",
  kind: "slide",
  slide: { title: "Sermon", body: "" },
  reference: "Sermon",
  confidence: 1,
  source: "manual",
  added_at: 0,
  scene_id,
  on_take,
}) as QueueItem

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

function Editor() {
  const selected = useQueueStore((s) => s.items.find((candidate) => candidate.id === "sermon"))
  return selected ? <TakeSteps item={selected} /> : null
}

async function render() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.body.appendChild(document.createElement("div"))
  root = createRoot(el)
  await act(async () => root!.render(<Editor />))
  return el
}

function outputs(): BroadcastOutput[] {
  const initial = useBroadcastStore.getState().outputs[0]
  const make = (id: string, name: string, role: BroadcastOutput["role"] = "congregation"): BroadcastOutput => ({
    ...initial,
    id,
    name,
    role,
    type: "display",
    themeId: initial?.themeId ?? "classic-dark",
    monitorIndex: 0,
    ndi: defaultNdiSettings(),
  })
  return [
    make(MAIN_OUTPUT_ID, "Sanctuary"),
    make("overflow", "Overflow"),
    make("stage", "Stage", "stage"),
    make("signage", "Signage", "signage"),
  ]
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("Prepare scene Takes", () => {
  it("edits a shared scene and multiple congregation overrides without changing actual output", async () => {
    const shared = newScene("Shared scene")
    const override = newScene("Overflow scene")
    const actualOutputs = outputs()
    useBroadcastStore.setState({ scenes: [shared, override], outputs: actualOutputs })
    useQueueStore.setState({ items: [item([], shared.id)], headers: [], activeIndex: null })
    const el = await render()

    const sharedToggle = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => sharedToggle.click())
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Add screen override for Sermon"]')!.click())

    const target = el.querySelector<HTMLSelectElement>('[aria-label="Screen target for Sermon 1"]')!
    expect([...target.options].filter((option) => option.value === "stage" || option.value === "signage")).toEqual([])
    await choose(target, "overflow")
    const scene = el.querySelector<HTMLSelectElement>('[aria-label="Scene override 1 for Sermon"]')!
    await choose(scene, override.id)
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Add screen override for Sermon"]')!.click())
    expect(el.querySelector<HTMLSelectElement>('[aria-label="Screen target for Sermon 2"]')!.value).toBe(MAIN_OUTPUT_ID)

    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Remove screen override 2 for Sermon"]')!.click())

    expect(useQueueStore.getState().items[0].on_take).toEqual([
      sceneStep(shared.id),
      sceneStep(override.id, "overflow"),
    ])
    expect(useBroadcastStore.getState().outputs).toEqual(actualOutputs)
  })

  it("keeps missing scenes and output ids visible for repair, while stage and signage are not selectable", async () => {
    const valid = newScene("Valid scene")
    const targets = outputs()
    useBroadcastStore.setState({ scenes: [valid], outputs: targets })
    useQueueStore.setState({
      items: [item([sceneStep("removed-scene", "removed-screen"), sceneStep("stage-scene", "stage")])],
      headers: [],
      activeIndex: null,
    })
    const el = await render()

    expect(el.textContent).toContain("Screen not found: removed-screen")
    expect(el.textContent).toContain("Not a congregation screen: Stage")
    expect(el.textContent).toContain("Scene not on this computer: removed-scene")
    expect(el.textContent).toContain("Scene not on this computer: stage-scene")
    for (const target of el.querySelectorAll<HTMLSelectElement>('select[aria-label^="Screen target for Sermon"]')) {
      for (const option of [...target.options].filter((candidate) => candidate.value === "stage" || candidate.value === "signage")) {
        expect(option.disabled).toBe(true)
      }
    }
  })
})
