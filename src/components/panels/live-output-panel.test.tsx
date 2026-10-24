// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
// The picture itself needs a real canvas; these tests are about the words around it.
vi.mock("@/components/ui/canvas-verse", () => ({ CanvasVerse: () => null }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { LiveOutputPanel } from "./live-output-panel"
import { PreviewPanel } from "./preview-panel"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import type { QueueItem, Verse } from "@/types"
import { SCENE_PRESETS, newScene } from "@/lib/scenes"

let el: HTMLDivElement
let root: Root
const verse: Verse = { id: 1, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" }

async function render(node: React.ReactNode) {
  el = document.createElement("div")
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root.render(node))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useBroadcastStore.setState({ isLive: false, liveVerse: null, rehearsal: false })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null })
  useQueueStore.setState({ items: [] })
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
})

describe("Present's Live and Preview panels", () => {
  it("Standard view has no second go-live switch: the header only says whether the screens are on air (#299 5.16)", async () => {
    await render(<LiveOutputPanel goLiveSwitch={false} />)
    expect(el.querySelector('[role="switch"]')).toBeNull()
    const header = el.querySelector('[data-slot="panel-header"]')!
    expect(header.textContent).toContain("Off air")
    // Auto stays: where heard verses go is not a go-live control.
    expect(el.querySelector('[aria-label="Auto: where heard verses go by themselves"]')).not.toBeNull()
    await act(async () => useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "John 3:16", segments: [] } }))
    expect(header.textContent).toContain("On air")
    await act(async () => useBroadcastStore.setState({ rehearsal: true }))
    expect(header.textContent).toContain("Rehearsal")
  })

  it("the Advanced dashboard keeps its Go live switch", async () => {
    await render(<LiveOutputPanel />)
    expect(el.querySelector('[role="switch"][aria-label="Go live: show this on the screens"]')).not.toBeNull()
  })

  it("the one-line Preview says what Take live will put up, and the item's plan", async () => {
    await render(<PreviewPanel compact />)
    const line = el.querySelector('section[aria-label="Preview"]')!
    expect(line.textContent).toContain("Nothing in Preview")
    const scene = { ...newScene("Sermon split", SCENE_PRESETS[0]), id: "split" }
    const item: QueueItem = { id: "it-1", reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, verse, scene_id: "split" }
    await act(async () => {
      useBroadcastStore.setState({ scenes: [scene] })
      useQueueStore.setState({ items: [item] })
      useBibleStore.setState({ selectedVerse: verse })
    })
    expect(line.textContent).toContain("John 3:16")
    expect(line.textContent).toContain("Only you see this")
    expect(line.textContent).toContain("Planned · Scene: Sermon split")
  })
})
