// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

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
  addedIds = []
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

let addedIds: string[] = []
const selectAddedItem = (id: string) => { addedIds.push(id) }
const draftPreview = () => document.querySelector('[aria-label^="Slide draft preview"]')

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

  it.each(modes)("shows the $name draft in its own preview, never Live's, and clears it when empty (#447)", async ({ name, field, value }) => {
    await render()
    if (name !== "Any text") {
      const modeButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === name)!
      await act(async () => modeButton.click())
    }
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${field}"]`)!
    await setValue(input, value)
    expect(draftPreview()).not.toBeNull()
    expect(useBibleStore.getState().selectedSlide).toBeNull()

    await setValue(input, "")

    expect(draftPreview()).toBeNull()
    expect(useBibleStore.getState().selectedSlide).toBeNull()
  })

  it("leaves a slide in Live's Preview untouched while drafting and clearing (#447)", async () => {
    await render()
    const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!

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

    await setValue(textarea, "Draft words")
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(queued.id)
    await setValue(textarea, "")

    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(queued.id)
    expect(useBibleStore.getState().selectedQueueItemId).toBe(queued.id)
  })

  it("hands the inserted slide to Prepare and leaves Live's Preview empty (#447)", async () => {
    await render(selectAddedItem)
    await setValue(document.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!, "Welcome to service")
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add to service"))!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted.kind).toBe("slide")
    expect(addedIds).toEqual([inserted.id])
    expect(useBibleStore.getState().selectedSlide).toBeNull()
    expect(useBibleStore.getState().selectedQueueItemId).toBeNull()
  })

  it("hands the last inserted page of a multi-page reading to Prepare", async () => {
    await render(selectAddedItem)
    const reading = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Responsive reading")!
    await act(async () => reading.click())
    await setValue(document.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!, "L: Give thanks.\nP: His love endures.\n\nL: Sing for joy.\nP: Praise the Lord.")
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add as 2 slides"))!
    await act(async () => add.click())

    const items = useQueueStore.getState().items as QueueItem[]
    expect(items).toHaveLength(2)
    expect(addedIds).toEqual([items[1].id])
    expect(useBibleStore.getState().selectedSlide).toBeNull()
  })

  it("keeps Program unchanged while previewing, resetting, and adding a slide", async () => {
    useBroadcastStore.setState({ isLive: true, liveItemId: "program-item", liveVerse: { reference: "Program baseline" } as never })
    const before = useBroadcastStore.getState()
    await render(selectAddedItem)
    await setValue(document.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!, "Private Preview")
    expect(draftPreview()).not.toBeNull()
    expect(useBibleStore.getState().selectedSlide).toBeNull()

    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add to service"))!
    await act(async () => add.click())

    expect(useBroadcastStore.getState().isLive).toBe(before.isLive)
    expect(useBroadcastStore.getState().liveItemId).toBe(before.liveItemId)
    expect(useBroadcastStore.getState().liveVerse).toEqual(before.liveVerse)
  })
})
