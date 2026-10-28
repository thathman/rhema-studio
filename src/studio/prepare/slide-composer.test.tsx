// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { QueueItem, SlideQueueItem } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { SlideComposer } from "./slide-composer"

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(onAdded?: (id: string) => void) {
  await act(async () => root!.render(<SlideComposer onAdded={onAdded} />))
}

async function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function selectAddedItem(id: string) {
  const item = useQueueStore.getState().items.find((candidate) => candidate.id === id)
  if (item && (item.kind === "slide" || item.kind === "image")) {
    useBibleStore.getState().selectSlide({ item, index: 0 })
    useBibleStore.getState().setSelectedQueueItemId(id)
  }
}

const modes = [
  { name: "Any text", field: "Slide text", value: "Welcome" },
  { name: "Announcement", field: "Slide text", value: "Youth meeting Friday" },
  { name: "QR link", field: "Link", value: "https://example.org/give" },
  { name: "Responsive reading", field: "Slide text", value: "L: Give thanks.\nP: His love endures." },
]

describe("Prepare slide composer preview (#391)", () => {
  it.each(modes)("clears the $name draft preview when its form becomes empty", async ({ name, field, value }) => {
    await render()
    if (name !== "Any text") {
      const modeButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === name)!
      await act(async () => modeButton.click())
    }
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${field}"]`)!
    await setValue(input, value)
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe("draft-slide")

    await setValue(input, "")

    expect(useBibleStore.getState().selectedSlide).toBeNull()
  })

  it("does not clear a different queued slide selected while the draft was open", async () => {
    await render()
    const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!
    await setValue(textarea, "Draft words")
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe("draft-slide")

    const queued: SlideQueueItem = {
      id: "queued-slide",
      kind: "slide",
      slide: { title: "Saved", body: "Keep this preview" },
      reference: "Saved",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    useQueueStore.setState({ items: [queued] })
    useBibleStore.getState().selectSlide({ item: queued, index: 0 })
    useBibleStore.getState().setSelectedQueueItemId(queued.id)

    await setValue(textarea, "")

    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(queued.id)
    expect(useBibleStore.getState().selectedQueueItemId).toBe(queued.id)
  })

  it("keeps the newly inserted saved slide selected after the composer resets", async () => {
    await render(selectAddedItem)
    await setValue(document.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!, "Welcome to service")
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add to service"))!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted.kind).toBe("slide")
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(inserted.id)
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
  })

  it("selects the last inserted page after adding a multi-page reading", async () => {
    await render(selectAddedItem)
    const reading = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Responsive reading")!
    await act(async () => reading.click())
    await setValue(document.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!, "L: Give thanks.\nP: His love endures.\n\nL: Sing for joy.\nP: Praise the Lord.")
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add as 2 slides"))!
    await act(async () => add.click())

    const items = useQueueStore.getState().items as QueueItem[]
    expect(items).toHaveLength(2)
    expect(useBibleStore.getState().selectedQueueItemId).toBe(items[1].id)
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(items[1].id)
  })

  it("keeps Program unchanged while previewing, resetting, and adding a slide", async () => {
    useBroadcastStore.setState({ isLive: true, liveItemId: "program-item", liveVerse: { reference: "Program baseline" } as never })
    const before = useBroadcastStore.getState()
    await render(selectAddedItem)
    await setValue(document.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!, "Private Preview")
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe("draft-slide")

    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add to service"))!
    await act(async () => add.click())

    expect(useBroadcastStore.getState().isLive).toBe(before.isLive)
    expect(useBroadcastStore.getState().liveItemId).toBe(before.liveItemId)
    expect(useBroadcastStore.getState().liveVerse).toEqual(before.liveVerse)
  })
})
