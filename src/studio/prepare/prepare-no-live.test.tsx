// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

// jsdom has no ResizeObserver (the drag-and-drop library needs one at import), CSS.escape or scrollIntoView.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s }
})
// Lists come back empty; anything else has nothing to say.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd.endsWith("_list") ? [] : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { PrepareWorkspace } from "./prepare-workspace"
import { saveStateOf } from "./save-state"
import { useQueueStore } from "@/stores/queue-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useShellStore } from "@/studio/shell-store"
import { presentActions } from "@/studio/present-actions"
import type { QueueItem } from "@/types"
import { projectRunOfShowEvents } from "@/lib/run-of-show"
import { toItemInputs } from "@/stores/service-store"

const slide = (id: string): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "words" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes: 3 }) as unknown as QueueItem

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  useServiceStore.setState({ current: null, dirty: false, saving: false })
})

async function renderPrepare() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(<PrepareWorkspace />))
  return el
}

describe("Prepare never takes anything live (#299)", () => {
  it("clicking, double-clicking and keys on rundown items only preview", async () => {
    useQueueStore.setState({
      items: [slide("Welcome"), slide("Notices"), slide("Blessing")],
      headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }],
      activeIndex: null,
    })
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSlide: null, liveItemId: null })
    const goLive = (["showLive", "presentItem", "next", "prev", "quickScreen", "verseNext", "versePrev"] as const).map((k) => vi.spyOn(presentActions, k))

    const el = await renderPrepare()
    const rows = [...el.querySelectorAll<HTMLButtonElement>('ol[aria-label="Service rundown"] button[title="Click to preview"]')]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      await act(async () => {
        row.click()
        row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
      })
    }
    // Present's keys do nothing here either.
    for (const key of ["ArrowRight", "PageDown", "ArrowLeft", " ", "Enter", "Escape"]) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
      })
    }
    // The phase strip only scrolls the rundown.
    Element.prototype.scrollIntoView ??= () => {}
    for (const phase of el.querySelectorAll<HTMLButtonElement>('[aria-label="Phases"] button')) {
      await act(async () => phase.click())
    }

    const b = useBroadcastStore.getState()
    expect(b.isLive).toBe(false)
    expect(b.liveVerse).toBeNull()
    expect(b.liveSlide).toBeNull()
    expect(b.liveItemId).toBeNull()
    for (const spy of goLive) expect(spy).not.toHaveBeenCalled()
    goLive.forEach((s) => s.mockRestore())
  })

  it("Present service opens the live console without showing anything", async () => {
    useQueueStore.setState({ items: [slide("Welcome")], headers: [], activeIndex: null })
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null })
    useShellStore.setState({ workspace: "prepare" })
    const el = await renderPrepare()
    const present = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Present service"))!
    await act(async () => present.click())
    expect(useShellStore.getState().workspace).toBe("present")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("adds a versioned draft event to the service plan without changing live output", async () => {
    useQueueStore.setState({ items: [slide("Sermon outline")], headers: [], activeIndex: null })
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSlide: null, liveItemId: null })
    const el = await renderPrepare()
    const preview = el.querySelector<HTMLButtonElement>('ol[aria-label="Service rundown"] button[title="Click to preview"]')!
    await act(async () => preview.click())
    const eventButton = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Event")!
    await act(async () => eventButton.click())
    expect(useQueueStore.getState().headers).toMatchObject([
      { type: "group", name: "New event", at: 0, event: { schema_version: 1 } },
    ])
    expect(projectRunOfShowEvents(useQueueStore.getState().items, useQueueStore.getState().headers)[0].moments.map((item) => item.id)).toEqual(["Sermon outline"])
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: false, liveVerse: null, liveSlide: null, liveItemId: null })
    expect(el.querySelector('[aria-label="Event: New event"]')).not.toBeNull()
  })

  it("opens an event plan editor and keeps its edits separate from live output", async () => {
    useQueueStore.setState({
      items: [slide("Opening prayer")],
      headers: [{ id: "prayer", type: "group", name: "New event", at: 0, event: { schema_version: 1, approval: "approved" } }],
      activeIndex: null,
    })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item" })
    const el = await renderPrepare()
    const before = useBroadcastStore.getState()
    const edit = el.querySelector<HTMLButtonElement>('button[aria-label="Edit event: New event"]')
    expect(edit).not.toBeNull()
    await act(async () => edit!.click())

    const setValue = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value)
      field.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const duration = el.querySelector<HTMLInputElement>('[aria-label="Planned event length in minutes"]')!
    await act(async () => setValue(duration, "601"))
    expect(useQueueStore.getState().headers[0].event?.duration_minutes).toBeUndefined()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("600")
    await act(async () => {
      setValue(el.querySelector<HTMLInputElement>('[aria-label="Event title"]')!, "Opening Prayer")
      setValue(el.querySelector<HTMLInputElement>('[aria-label="Event role"]')!, "Prayer")
      setValue(duration, "15")
      setValue(el.querySelector<HTMLInputElement>('[aria-label="Event owner"]')!, "Pastor")
      setValue(el.querySelector<HTMLTextAreaElement>('[aria-label="Event notes"]')!, "Start the stage countdown")
    })

    expect(useQueueStore.getState().headers[0]).toMatchObject({
      id: "prayer",
      name: "Opening Prayer",
      notes: "Start the stage countdown",
      event: { schema_version: 1, role: "Prayer", duration_minutes: 15, ownership: "Pastor" },
    })
    const savedEvent = toItemInputs(useQueueStore.getState().items, undefined, undefined, useQueueStore.getState().headers)[0]
    expect(savedEvent).toMatchObject({ kind: "group", reference: "Opening Prayer", notes: "Start the stage countdown" })
    expect(JSON.parse(savedEvent.payload ?? "{}").run_of_show_event).toMatchObject({
      schema_version: 1,
      role: "Prayer",
      duration_minutes: 15,
      ownership: "Pastor",
    })
    expect(el.querySelector('[role="alert"]')).toBeNull()
    expect(useBroadcastStore.getState().isLive).toBe(before.isLive)
    expect(useBroadcastStore.getState().liveItemId).toBe(before.liveItemId)
    expect(el.textContent).toContain("Draft")
  })

  it("derives event approval from the saved service revision and marks unsaved edits changed", async () => {
    useQueueStore.setState({
      items: [slide("Sermon")],
      headers: [{ id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1, approval: "draft" } }],
      activeIndex: null,
    })
    useServiceStore.setState({
      current: { id: "service", title: "Sunday", service_date: null, revision: 3, created_at: "", updated_at: "", item_count: 1, approved_revision: 3 },
      dirty: false,
      saving: false,
    })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item" })
    const before = useBroadcastStore.getState()
    const el = await renderPrepare()
    const row = () => el.querySelector<HTMLElement>('[aria-label="Event: Sermon"]')!
    expect(row().textContent).toContain("Approved") // legacy event.approval is ignored

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Edit event: Sermon"]')!.click())
    const duration = el.querySelector<HTMLInputElement>('[aria-label="Planned event length in minutes"]')!
    const setValue = (field: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value)
      field.dispatchEvent(new Event("input", { bubbles: true }))
    }
    await act(async () => setValue(duration, "40"))

    expect(useServiceStore.getState().dirty).toBe(true)
    expect(row().textContent).toContain("Changed")
    expect(el.textContent).toContain("This status does not authorize a live Take.")
    expect(useBroadcastStore.getState().isLive).toBe(before.isLive)
    expect(useBroadcastStore.getState().liveItemId).toBe(before.liveItemId)
  })

  it("collapsing an event hides its nested moment groups and their items", async () => {
    useQueueStore.setState({
      items: [slide("Sermon opener"), slide("John 3:16"), slide("Prayer")],
      headers: [
        { id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1, duration_minutes: 40, approval: "draft" } },
        { id: "scripture", type: "group", name: "Scripture moments", at: 1 },
        { id: "prayer-event", type: "group", name: "Closing prayer", at: 2, event: { schema_version: 1, approval: "draft" } },
      ],
      activeIndex: null,
    })
    const el = await renderPrepare()
    expect(el.querySelectorAll('ol[aria-label="Service rundown"] button[title="Click to preview"]')).toHaveLength(3)
    const collapse = el.querySelector<HTMLButtonElement>('button[aria-label="Hide Sermon"]')!
    await act(async () => collapse.click())
    expect(el.querySelector('[aria-label="Event: Sermon"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Group: Scripture moments"]')).toBeNull()
    expect(el.querySelector('[aria-label="Event: Closing prayer"]')).not.toBeNull()
    expect(el.querySelectorAll('ol[aria-label="Service rundown"] button[title="Click to preview"]')).toHaveLength(1)
  })

  it("says whether the service is saved, next to its name", async () => {
    useQueueStore.setState({ items: [slide("Welcome")], headers: [], activeIndex: null })
    useServiceStore.setState({ current: null, dirty: false, saving: false })
    const el = await renderPrepare()
    expect(el.textContent).toContain("Items not saved as a service")
    expect(el.textContent).toContain("Not saved as a service")
  })
})

describe("saveStateOf", () => {
  const svc = { title: "Sunday" }
  it("names each state in words", () => {
    expect(saveStateOf({ current: svc, dirty: false, saving: false, count: 3 }).label).toBe("Saved")
    expect(saveStateOf({ current: svc, dirty: true, saving: false, count: 3 }).label).toBe("Unsaved changes")
    expect(saveStateOf({ current: svc, dirty: true, saving: true, count: 3 }).label).toBe("Saving…")
    expect(saveStateOf({ current: null, dirty: false, saving: false, count: 2 }).label).toBe("Not saved as a service")
    expect(saveStateOf({ current: null, dirty: false, saving: false, count: 0 }).label).toBe("No service open")
  })
})
