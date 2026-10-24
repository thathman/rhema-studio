// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { QueueItem } from "@/types"
import { useQueueStore } from "@/stores/queue-store"
import { PlannedMinutes } from "./item-editor-parts"

/** #196 R3: an item's Timing tab sets a fixed start or a pause before it. */
const slide = { id: "s", kind: "slide", slide: { title: "Notices", body: "" }, reference: "Notices", confidence: 1, source: "manual", added_at: 0, planned_minutes: 5 } as unknown as QueueItem
const item = () => useQueueStore.getState().items[0]

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

async function render() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.body.appendChild(document.createElement("div"))
  root = createRoot(el)
  await act(async () => root!.render(<PlannedMinutes item={item()} />))
  return el
}

async function type(input: HTMLInputElement, value: string, blur = false) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  if (blur) await act(async () => { input.focus(); input.blur() })
}

describe("the Timing tab's start rule", () => {
  it("a pause before is typed as a duration and explained", async () => {
    useQueueStore.setState({ items: [slide], headers: [] })
    const el = await render()
    expect(el.textContent).toContain("Starts when the item before ends")
    await type(el.querySelector('[aria-label="Pause before Notices"]')!, "5", true)
    expect(item().gap_minutes).toBe(5)
  })

  it("a fixed start is a clock time; with one, the pause is off and it says ±5 does not move it", async () => {
    useQueueStore.setState({ items: [{ ...slide, gap_minutes: 5 }], headers: [] })
    let el = await render()
    await type(el.querySelector('[aria-label="Fixed start for Notices"]')!, "10:30")
    expect(item().starts_at).toBe("10:30")
    act(() => root?.unmount())
    el = await render()
    expect(el.querySelector<HTMLInputElement>('[aria-label="Pause before Notices"]')!.disabled).toBe(true)
    expect(el.textContent).toContain("±5 min does not move it")
    await type(el.querySelector('[aria-label="Fixed start for Notices"]')!, "")
    expect(item().starts_at).toBeNull()
  })
})
