// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { QueueItem, SlideQueueItem } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore } from "@/studio/shell-store"
import { useAddDialog } from "@/studio/prepare/add-target"
import { SlideComposer } from "./slide-composer"

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
  useShellStore.setState({ workspace: "prepare", librarySection: "songs" })
  useAddDialog.setState({ open: false, opener: null, focusItemId: null })
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
  it("opens the reusable slide library from Prepare", async () => {
    await render()
    const browse = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Browse reusable slides"))!
    await act(async () => browse.click())
    expect(useShellStore.getState().workspace).toBe("library")
    expect(useShellStore.getState().librarySection).toBe("slides")
  })

  it("closes the event Add dialog after capturing its target for the Library handoff", async () => {
    useQueueStore.setState({
      items: [{ id: "moment-1", kind: "slide", slide: { title: "Opening", body: "Welcome" }, reference: "Opening", confidence: 1, source: "manual", added_at: 0 }],
      headers: [{ id: "event-1", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
      addTarget: null,
    })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 } })
    useAddDialog.getState().openFor("event-1")
    await render()

    const browse = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Browse reusable slides"))!
    await act(async () => browse.click())

    expect(useAddDialog.getState().open).toBe(false)
    expect(useQueueStore.getState().addTarget).toBeNull()
    expect(useShellStore.getState()).toMatchObject({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "event-1", targetHeaderTitle: "Opening", eventId: "event-1", momentId: null, eventTitle: "Opening", momentTitle: null },
    })
  })

  it("captures a phase Add target before closing the dialog", async () => {
    useQueueStore.setState({
      items: [],
      headers: [{ id: "phase-1", type: "phase", name: "Pre-service", at: 0, rule: "manual", role: "pre" }],
      activeIndex: null,
      addTarget: null,
    })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
    useAddDialog.getState().openFor("phase-1")
    await render()

    const browse = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Browse reusable slides"))!
    await act(async () => browse.click())

    expect(useAddDialog.getState().open).toBe(false)
    expect(useShellStore.getState()).toMatchObject({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "phase-1", targetHeaderTitle: "Pre-service", eventId: null, momentId: null, eventTitle: null, momentTitle: null },
    })
  })

  it("retains the containing event when the Add target is a nested group", async () => {
    useQueueStore.setState({
      items: [],
      headers: [
        { id: "event-1", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } },
        { id: "group-1", type: "group", name: "Welcome slides", at: 0 },
      ],
      activeIndex: null,
      addTarget: null,
    })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
    useAddDialog.getState().openFor("group-1")
    await render()

    const browse = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Browse reusable slides"))!
    await act(async () => browse.click())

    expect(useShellStore.getState()).toMatchObject({
      workspace: "library",
      prepareLibraryReturn: { targetHeaderId: "group-1", targetHeaderTitle: "Welcome slides", eventId: "event-1", eventTitle: "Opening" },
    })
  })

  it("keeps a stale Add target in the Library context so a later add can fail closed", async () => {
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
    useAddDialog.getState().openFor("removed-phase")
    await render()

    const browse = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Browse reusable slides"))!
    await act(async () => browse.click())

    expect(useAddDialog.getState().open).toBe(false)
    expect(useShellStore.getState()).toMatchObject({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "removed-phase", eventId: null, momentId: null },
    })
  })

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
