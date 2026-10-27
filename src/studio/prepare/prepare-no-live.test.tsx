// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

// jsdom has no ResizeObserver (the drag-and-drop library needs one at import), PointerEvent or CSS.escape.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  ;(globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s }
})
const mockService = vi.hoisted(() => ({
  program: null as null | Record<string, unknown>,
  items: [] as Record<string, unknown>[],
  verses: [
    { id: 1, translation_id: 1, book_number: 19, book_name: "Psalms", book_abbreviation: "Ps", chapter: 23, verse: 1, text: "The Lord is my shepherd" },
    { id: 2, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter: 3, verse: 16, text: "For God so loved the world" },
  ],
}))
// Lists come back empty; anything else has nothing to say.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd.endsWith("_list")) return []
    if (cmd === "get_verse") {
      return mockService.verses.find((verse) =>
        verse.book_number === args?.bookNumber && verse.chapter === args?.chapter && verse.verse === args?.verse,
      ) ?? null
    }
    if (cmd === "content_create_program") {
      mockService.program = {
        id: "local-draft",
        title: String(args?.title ?? "Service draft"),
        service_date: typeof args?.serviceDate === "string" ? args.serviceDate : null,
        revision: 1,
        created_at: "",
        updated_at: "",
        item_count: 0,
      }
      return mockService.program
    }
    if (cmd === "content_replace_items") {
      mockService.items = Array.isArray(args?.items) ? structuredClone(args.items) as Record<string, unknown>[] : []
      mockService.program = {
        id: String(args?.programId ?? "local-draft"),
        title: "Service draft",
        service_date: null,
        revision: 2,
        created_at: "",
        updated_at: "",
        item_count: mockService.items.length,
      }
      return { program: mockService.program, items: [] }
    }
    if (cmd === "content_get_program") {
      return mockService.program?.id === args?.id ? { program: mockService.program, items: structuredClone(mockService.items) } : null
    }
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { PrepareWorkspace } from "./prepare-workspace"
import { LiveOutputPanel } from "@/components/panels/live-output-panel"
import { TransportBar } from "@/studio/present/transport-bar"
import { saveStateOf } from "./save-state"
import { useQueueStore } from "@/stores/queue-store"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useAddDialog } from "@/studio/prepare/add-target"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
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
  try { window.localStorage.removeItem("rhema.prepare.rundown-view.v1") } catch { /* unavailable in the Node test runner */ }
  useAddDialog.getState().close()
  useRundownSelection.getState().clear()
  mockService.program = null
  mockService.items = []
  document.body.replaceChildren()
  useServiceStore.setState({ programs: [], current: null, dirty: false, saving: false })
})

async function renderPrepare(withLiveControls = false) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  const workspace = withLiveControls ? <><PrepareWorkspace /><LiveOutputPanel /><TransportBar /></> : <PrepareWorkspace />
  await act(async () => root!.render(workspace))
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
    const eventButton = el.querySelector<HTMLButtonElement>('button[aria-label="Add event"]')!
    await act(async () => eventButton.click())
    const customEvent = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim().startsWith("Custom"))!
    await act(async () => customEvent.click())
    expect(useQueueStore.getState().headers).toMatchObject([
      { type: "group", name: "New event", at: 0, event: { schema_version: 1 } },
    ])
    expect(projectRunOfShowEvents(useQueueStore.getState().items, useQueueStore.getState().headers)[0].moments.map((item) => item.id)).toEqual(useQueueStore.getState().items.map((item) => item.id))
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: false, liveVerse: null, liveSlide: null, liveItemId: null })
    expect(el.querySelector('[aria-label="Event: New event"]')).not.toBeNull()
  })

  it("shows a new event in the empty running order after creating its local draft", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null })
    useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSlide: null, liveItemId: null })
    const el = await renderPrepare()

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Add event"]')!.click())
    const sermon = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Sermon")!
    await act(async () => sermon.click())

    expect(useServiceStore.getState().current?.title).toMatch(/^Service draft/)
    expect(el.querySelector('[aria-label="Event: Sermon"]')).not.toBeNull()
    expect(el.querySelector<HTMLButtonElement>('button[aria-label="Edit event: Sermon"]')?.getAttribute("aria-pressed")).toBe("true")
    expect(el.querySelector('h2')?.textContent).toContain("1 event")
    expect(el.querySelector('[aria-label="Event: Sermon"]')?.textContent).toContain("0 moments")
    expect([...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Clear service"))?.disabled).toBe(false)
    expect(el.textContent).not.toContain("Nothing in the service yet")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("creates an event, adds and edits an exact moment, saves and reopens it, then previews without changing Live", async () => {
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
    useServiceStore.setState({ programs: [], current: null, dirty: false, saving: false })
    useBroadcastStore.setState({ isLive: true, liveItemId: "currently-on-air", liveSlide: null, liveVerse: null })
    const liveBefore = {
      isLive: useBroadcastStore.getState().isLive,
      liveItemId: useBroadcastStore.getState().liveItemId,
      liveSlide: useBroadcastStore.getState().liveSlide,
      liveVerse: useBroadcastStore.getState().liveVerse,
    }
    const el = await renderPrepare()

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Add event"]')!.click())
    const sermon = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Sermon")!
    await act(async () => sermon.click())
    const eventId = useQueueStore.getState().headers.find((header) => header.name === "Sermon")!.id

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Edit event: Sermon"]')!.click())
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Add content to Sermon"]')!.click())
    expect(useAddDialog.getState().open).toBe(true)
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const slidesTab = [...dialog.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find((button) => button.textContent?.trim() === "Slides")!
    await act(async () => {
      slidesTab.focus()
      slidesTab.click()
    })
    const title = document.body.querySelector<HTMLInputElement>('[aria-label="Slide title"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), "value")!.set!.call(title, "Sermon title")
      title.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const add = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add to service")!
    await act(async () => add.click())

    const inserted = useQueueStore.getState().items.find((item) => item.reference === "Sermon title")!
    expect(useQueueStore.getState().addTarget).toBeNull()
    expect(useAddDialog.getState().open).toBe(false)
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(inserted.id)
    expect(el.querySelector('button[aria-label="Event plan"]')).toBeNull()
    expect(el.textContent).toContain("Confidence")
    await vi.waitFor(
      () => expect(document.activeElement).toBe(document.querySelector(`[data-rundown-item-id="${inserted.id}"]`)),
      { timeout: 1000 },
    )
    expect(useBroadcastStore.getState()).toMatchObject(liveBefore)

    const save = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save")!
    await act(async () => save.click())
    expect(useServiceStore.getState().dirty).toBe(false)
    expect(await useServiceStore.getState().closeProgram()).toBe("closed")
    expect(await useServiceStore.getState().openProgram("local-draft")).toBe("ok")

    const reopened = useQueueStore.getState()
    expect(reopened.items.map((item) => item.id)).toContain(inserted.id)
    expect(reopened.headers.find((header) => header.id === eventId)?.event).toMatchObject({ schema_version: 1 })
    expect(projectRunOfShowEvents(reopened.items, reopened.headers).find((event) => event.id === eventId)?.moments.map((item) => item.id)).toContain(inserted.id)
    act(() => useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null }))
    const itemRow = document.querySelector<HTMLElement>(`[data-rundown-item-id="${inserted.id}"]`)!
    await act(async () => itemRow.querySelector<HTMLButtonElement>('button[title="Click to preview"]')!.click())
    expect(useBibleStore.getState().selectedQueueItemId).toBe(inserted.id)
    expect(useBroadcastStore.getState()).toMatchObject(liveBefore)
  }, 30_000)

  it("roundtrips Bible and slide moments, edits and reorders them, and keeps Preview private until Take", async () => {
    const alreadyLive = {
      kind: "slide",
      content: "slide",
      reference: "Previously on air",
      segments: [],
      lines: ["The running service is unchanged"],
    }
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useRundownSelection.getState().clear()
    useBibleStore.setState({
      selectedVerse: null,
      selectedSlide: null,
      selectedQueueItemId: null,
      activeTranslationId: 1,
      secondaryTranslationId: null,
      translations: [{ id: 1, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true }],
      books: [
        { id: 19, translation_id: 1, book_number: 19, name: "Psalms", abbreviation: "Ps", testament: "OT" },
        { id: 43, translation_id: 1, book_number: 43, name: "John", abbreviation: "Jn", testament: "NT" },
      ],
    })
    useServiceStore.setState({ programs: [], current: null, dirty: false, saving: false })
    useBroadcastStore.setState({ isLive: true, liveItemId: "currently-on-air", liveSlide: null, liveVerse: alreadyLive as never })
    const el = await renderPrepare(true)
    const livePanel = el.querySelector<HTMLElement>('[data-slot="live-output-panel"]')!
    const liveCanvas = () => livePanel.querySelector<HTMLCanvasElement>('canvas[role="img"]')
    const liveAtStart = liveCanvas()?.getAttribute("aria-label")
    expect(liveAtStart).toContain("Previously on air")

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Add event"]')!.click())
    const sermon = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Sermon")!
    await act(async () => sermon.click())
    const eventId = useQueueStore.getState().headers.find((header) => header.name === "Sermon")!.id

    const setValue = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value)
      field.dispatchEvent(new Event("input", { bubbles: true }))
    }
    const openEventAdd = async () => {
      const edit = el.querySelector<HTMLButtonElement>('button[aria-label="Edit event: Sermon"]')!
      if (edit.getAttribute("aria-pressed") !== "true") await act(async () => edit.click())
      await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Add content to Sermon"]')!.click())
    }
    const addBibleMoment = async (example: string, reference: string) => {
      await openEventAdd()
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
      const before = new Set(useQueueStore.getState().items.map((item) => item.id))
      const search = dialog.querySelector<HTMLInputElement>('input[aria-label="Quick find"]')!
      await act(async () => setValue(search, example))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 240)) })
      const result = [...dialog.querySelectorAll("li")].find((row) => row.textContent?.includes(reference))!
      expect(result).toBeDefined()
      await act(async () => [...result.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add")!.click())
      expect(useAddDialog.getState().open).toBe(false)
      const added = useQueueStore.getState().items.filter((item) => !before.has(item.id))
      expect(added).toHaveLength(1)
      return added[0]
    }

    const psalm = await addBibleMoment("psalm 23 1", "Psalms 23:1")
    expect(psalm).toHaveProperty("verse")

    await openEventAdd()
    const slideDialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const slidesTab = [...slideDialog.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find((button) => button.textContent?.trim() === "Slides")!
    await act(async () => { slidesTab.focus(); slidesTab.click() })
    const slideTitle = slideDialog.querySelector<HTMLInputElement>('[aria-label="Slide title"]')!
    const slideText = slideDialog.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!
    await act(async () => { setValue(slideTitle, "Sermon draft"); setValue(slideText, "Draft words") })
    await act(async () => [...slideDialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add to service")!.click())
    const slideMoment = useQueueStore.getState().items.find((item) => item.kind === "slide")!
    expect(slideMoment.kind).toBe("slide")

    const john = await addBibleMoment("john 3 16", "John 3:16")
    expect(john).toHaveProperty("verse")
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual([psalm.id, slideMoment.id, john.id])
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveItemId: "currently-on-air", liveVerse: alreadyLive })

    const slideRow = () => el.querySelector<HTMLElement>(`[data-rundown-item-id="${slideMoment.id}"]`)
    await act(async () => slideRow()!.querySelector<HTMLButtonElement>('button[title="Click to preview"]')!.click())
    const editorTitle = el.querySelector<HTMLInputElement>('[aria-label="Slide title"]')!
    const editorText = el.querySelector<HTMLTextAreaElement>('[aria-label="Slide text"]')!
    await act(async () => { setValue(editorTitle, "Edited sermon title"); setValue(editorText, "Revised words for Sunday") })
    expect(useQueueStore.getState().items.find((item) => item.id === slideMoment.id)).toMatchObject({
      reference: "Edited sermon title",
      slide: { title: "Edited sermon title", body: "Revised words for Sunday" },
    })

    useRundownSelection.getState().clear()
    const clickWithControl = async (id: string) => act(async () => {
      const rowButton = el.querySelector<HTMLElement>(`[data-rundown-item-id="${id}"] button[title="Click to preview"]`)!
      rowButton.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))
    })
    await clickWithControl(psalm.id)
    await clickWithControl(john.id)
    expect(useRundownSelection.getState().ids).toEqual([psalm.id, john.id])
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Move the picked items up"]')!.click())
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual([psalm.id, john.id, slideMoment.id])
    useRundownSelection.getState().clear()

    const save = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save")!
    await act(async () => save.click())
    expect(useServiceStore.getState().dirty).toBe(false)
    expect(await useServiceStore.getState().closeProgram()).toBe("closed")
    expect(await useServiceStore.getState().openProgram("local-draft")).toBe("ok")

    const reopened = useQueueStore.getState()
    expect(reopened.items.map((item) => item.id)).toEqual([psalm.id, john.id, slideMoment.id])
    expect(reopened.items.map((item) => "verse" in item ? "verse" : item.kind)).toEqual(["verse", "verse", "slide"])
    expect(reopened.items.find((item) => item.id === slideMoment.id)).toMatchObject({
      reference: "Edited sermon title",
      slide: { title: "Edited sermon title", body: "Revised words for Sunday" },
    })
    expect(projectRunOfShowEvents(reopened.items, reopened.headers).find((event) => event.id === eventId)?.moments.map((item) => item.id)).toEqual(reopened.items.map((item) => item.id))
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveItemId: "currently-on-air", liveVerse: alreadyLive })

    const reopenedSlideRow = el.querySelector<HTMLElement>(`[data-rundown-item-id="${slideMoment.id}"]`)!
    await act(async () => reopenedSlideRow.querySelector<HTMLButtonElement>('button[title="Click to preview"]')!.click())
    const previewCanvas = el.querySelector<HTMLCanvasElement>('[data-slot="preview-panel"] canvas[role="img"]')!
    expect(previewCanvas.getAttribute("aria-label")).toContain("Edited sermon title")
    expect(previewCanvas.getAttribute("aria-label")).toContain("Revised words for Sunday")
    expect(liveCanvas()?.getAttribute("aria-label")).toBe(liveAtStart)
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveItemId: "currently-on-air", liveVerse: alreadyLive })

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Take live"]')!.click())
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveItemId: slideMoment.id, liveVerse: { reference: "Edited sermon title", lines: ["Revised words for Sunday"] } })
    expect(liveCanvas()?.getAttribute("aria-label")).toContain("Edited sermon title")
    expect(liveCanvas()?.getAttribute("aria-label")).toContain("Revised words for Sunday")
  }, 30_000)

  it("opens New and Duplicate service forms from the service actions menu", async () => {
    const current = { id: "service", title: "Sunday service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 }
    useQueueStore.setState({ items: [slide("Welcome")], headers: [], activeIndex: null })
    useServiceStore.setState({ programs: [current], current, dirty: false, saving: false })
    useShellStore.getState().setNewServiceOpen(false)
    const el = await renderPrepare()

    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("New service"))).toBe(false)
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Copy")).toBe(false)
    const openActions = async () => act(async () => {
      const trigger = el.querySelector<HTMLButtonElement>('button[aria-label="Service actions"]')!
      const pointerDown = new Event("pointerdown", { bubbles: true })
      Object.assign(pointerDown, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      trigger.dispatchEvent(pointerDown)
    })
    const chooseAction = async (item: HTMLElement) => act(async () => {
      const pointerDown = new Event("pointerdown", { bubbles: true })
      Object.assign(pointerDown, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      item.dispatchEvent(pointerDown)
      item.dispatchEvent(new Event("pointerup", { bubbles: true }))
      item.click()
    })
    await openActions()
    const newAction = [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.trim() === "New service")!
    expect(newAction).toBeDefined()
    const duplicateAction = [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.trim() === "Duplicate service")!
    expect(duplicateAction).toBeDefined()
    await chooseAction(newAction)
    await vi.waitFor(() => expect(document.body.querySelector<HTMLInputElement>("#svc-title")).not.toBeNull(), { timeout: 1000 })
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Cancel")!.click())
    await openActions()
    const duplicate = [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.trim() === "Duplicate service")!
    await chooseAction(duplicate)
    await vi.waitFor(() => expect(document.body.querySelector<HTMLInputElement>("#dup-title")?.value).toBe("Sunday service (copy)"), { timeout: 1000 })
  }, 30_000)

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
    await act(async () => {
      const planTab = el.querySelector<HTMLButtonElement>('button[aria-label="Event plan"]')!
      planTab.focus()
      planTab.click()
    })

    const setValue = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value)
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

  it("shows an event's ordered moments and opens one in the editor without taking it live", async () => {
    useQueueStore.setState({
      items: [slide("Camera and speaker"), slide("John 3:16"), slide("Closing cue")],
      headers: [{ id: "prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1, duration_minutes: 15 } }],
      activeIndex: null,
    })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item" })
    const before = useBroadcastStore.getState()
    const el = await renderPrepare()
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Edit event: Opening Prayer"]')!.click())

    const contentTab = el.querySelector<HTMLButtonElement>('button[role="tab"][aria-label="Event content"]')
    expect(contentTab).not.toBeNull()
    expect(el.textContent).toContain("Camera and speaker")
    expect(el.textContent).toContain("John 3:16")
    expect(el.textContent).toContain("Closing cue")
    expect(useQueueStore.getState().addTarget).toBeNull()

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Open moment 2: John 3:16 in editor"]')!.click())
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe("John 3:16")
    expect(el.querySelector('[aria-label="Event content"]')).toBeNull()
    expect(useBroadcastStore.getState().isLive).toBe(before.isLive)
    expect(useBroadcastStore.getState().liveItemId).toBe(before.liveItemId)
    useAddDialog.getState().close()
  })

  it("opens the event's Add item flow with that event as the insertion target", async () => {
    useQueueStore.setState({
      items: [slide("Welcome"), slide("Sermon"), slide("Closing")],
      headers: [{ id: "sermon", type: "group", name: "Sermon", at: 1, event: { schema_version: 1 } }],
      activeIndex: null,
      addTarget: null,
    })
    const el = await renderPrepare()
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Edit event: Sermon"]')!.click())
    const add = el.querySelector<HTMLButtonElement>('button[aria-label="Add content to Sermon"]')
    expect(add).not.toBeNull()
    await act(async () => add!.click())
    expect(useQueueStore.getState().addTarget).toBe("sermon")
    expect(useAddDialog.getState().open).toBe(true)
    useAddDialog.getState().close()
  })

  it("adds a searched event immediately before the selected moment and opens its details without taking it live", async () => {
    const items = [slide("Welcome"), slide("Sermon outline"), slide("Response")]
    const headers = [
      { id: "main", type: "phase" as const, name: "Main service", at: 0, rule: "manual" as const, role: "main" as const },
      { id: "post", type: "phase" as const, name: "Post-service loop", at: 3, rule: "loop" as const, role: "post" as const },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 0 })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item", liveSlide: null, liveVerse: null })
    const liveBefore = useBroadcastStore.getState()
    const createDraft = vi.spyOn(useServiceStore.getState(), "createFromRundown").mockImplementation(async () => {
      useQueueStore.setState((state) => ({ headers: state.headers.map((header) => ({ ...header, id: `saved-${header.id}` })) }))
      return "created"
    })
    const el = await renderPrepare()
    const selectedRow = [...el.querySelectorAll<HTMLButtonElement>('ol[aria-label="Service rundown"] button[title="Click to preview"]')]
      .find((button) => button.textContent?.includes("Sermon outline"))!
    await act(async () => selectedRow.click())

    const addEvent = el.querySelector<HTMLButtonElement>('button[aria-label="Add event"]')
    expect(addEvent).not.toBeNull()
    await act(async () => addEvent!.click())
    const search = document.body.querySelector<HTMLInputElement>('[aria-label="Search event types"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(search), "value")!.set!.call(search, "serm")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const sermon = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Sermon")
    expect(sermon).not.toBeUndefined()
    await act(async () => sermon!.click())

    const created = useQueueStore.getState().headers.find((header) => header.event)
    expect(created).toMatchObject({ name: "Sermon", at: 1, event: { schema_version: 1, role: "Sermon" } })
    expect(created?.id).toBeTruthy()
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(items.map((item) => item.id))
    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(createDraft).toHaveBeenCalledOnce()
    expect(createDraft).toHaveBeenCalledWith(expect.stringMatching(/^Service draft/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(el.querySelector('[aria-label="Event: Sermon"]')).not.toBeNull()
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
    createDraft.mockRestore()
  })

  it("inserts before an event's first moment without taking that moment from its event or changing Live", async () => {
    const originalMoment = slide("original-moment-id")
    useQueueStore.setState({
      items: [originalMoment],
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main" },
        { id: "existing-event", type: "group", name: "Existing event", at: 0, event: { schema_version: 1 } },
      ],
      activeIndex: null,
    })
    useServiceStore.setState({
      current: { id: "existing-service", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 },
      dirty: false,
      saving: false,
    })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item", liveSlide: null, liveVerse: null })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()

    const momentRow = [...el.querySelectorAll<HTMLButtonElement>('ol[aria-label="Service rundown"] button[title="Click to preview"]')]
      .find((button) => button.textContent?.includes("original-moment-id"))!
    await act(async () => momentRow.click())
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Add event"]')!.click())
    const prayer = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim().startsWith("Prayer"))!
    await act(async () => prayer.click())

    const events = projectRunOfShowEvents(useQueueStore.getState().items, useQueueStore.getState().headers)
    const originalEvent = events.find((event) => event.id === "existing-event")
    const insertedEvent = events.find((event) => event.title === "Opening Prayer")
    expect(originalEvent?.moments).toEqual([originalMoment])
    expect(insertedEvent?.moments).toEqual([])
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("inserts an event at a nested moment-group boundary without changing earlier ownership", async () => {
    const items = [slide("Sermon opener"), slide("Scripture 1"), slide("Scripture 2"), slide("Application")]
    useQueueStore.setState({
      items,
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main" },
        { id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1 } },
        { id: "scripture", type: "group", name: "Scripture moments", at: 1 },
        { id: "application", type: "group", name: "Application moments", at: 3 },
      ],
      activeIndex: null,
    })
    useServiceStore.setState({
      current: { id: "existing-service", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: items.length },
      dirty: false,
      saving: false,
    })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item", liveSlide: null, liveVerse: null })
    const liveBefore = useBroadcastStore.getState()
    const itemIdsBefore = items.map((item) => item.id)
    const el = await renderPrepare()

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Add event after Scripture moments"]')!.click())
    const prayer = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim().startsWith("Prayer"))!
    await act(async () => prayer.click())

    const state = useQueueStore.getState()
    const events = projectRunOfShowEvents(state.items, state.headers)
    const originalEvent = events.find((event) => event.id === "sermon")
    const insertedEvent = events.find((event) => event.title === "Opening Prayer")
    expect(state.items.map((item) => item.id)).toEqual(itemIdsBefore)
    expect(originalEvent?.moments.map((item) => item.id)).toEqual(itemIdsBefore.slice(0, 3))
    expect(insertedEvent?.moments.map((item) => item.id)).toEqual(itemIdsBefore.slice(3))
    const insertedEventIndex = state.headers.findIndex((header) => header.name === "Opening Prayer")
    const applicationGroupIndex = state.headers.findIndex((header) => header.id === "application")
    expect(insertedEventIndex).toBeGreaterThan(state.headers.findIndex((header) => header.id === "scripture"))
    expect(insertedEventIndex).toBeLessThan(applicationGroupIndex)
    expect(state.headers[insertedEventIndex].at).toBe(3)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("switching simple and grouped views preserves the phase plan and current live output", async () => {
    const items = [slide("Welcome"), slide("Sermon moment"), slide("Closing")]
    const headers = [
      { id: "main", type: "phase" as const, name: "Main service", at: 0, rule: "manual" as const, role: "main" as const, starts_at: "10:00" },
      { id: "sermon", type: "group" as const, name: "Sermon", at: 1, event: { schema_version: 1 as const, duration_minutes: 40 } },
      { id: "post", type: "phase" as const, name: "Post-service loop", at: 2, rule: "loop" as const, role: "post" as const, advance_seconds: 30 },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 1 })
    useBroadcastStore.setState({ isLive: true, liveItemId: "Sermon moment", liveSlide: null, liveVerse: null })
    const planBefore = structuredClone({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()
    expect(el.querySelector('[aria-label="Phase: Main service"]')).not.toBeNull()

    const simple = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Simple list")
    const grouped = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Grouped by phase")
    expect(simple).not.toBeNull()
    expect(grouped).not.toBeNull()
    for (let i = 0; i < 20; i++) {
      await act(async () => simple!.click())
      expect(el.querySelector('[aria-label="Phase: Main service"]')).toBeNull()
      expect(el.querySelector('[aria-label="Event: Sermon"]')).not.toBeNull()
      await act(async () => grouped!.click())
      expect(el.querySelector('[aria-label="Phase: Main service"]')).not.toBeNull()
    }

    expect({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex }).toEqual(planBefore)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("confirms phase creation, preserves the plan and Live, and lets Undo restore the flat list", async () => {
    const items = [slide("Welcome"), slide("Sermon"), slide("Closing")]
    useQueueStore.setState({ items, headers: [{ id: "sermon", type: "group", name: "Sermon", at: 1 }], activeIndex: 1 })
    useQueueStore.getState().resetHistory()
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-sermon", liveSlide: null, liveVerse: null })
    const before = structuredClone({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()

    await act(async () => [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Organise into phases"))!.click())
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain("Existing items keep their IDs and order")
    expect(useQueueStore.getState().headers).toEqual(before.headers)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)

    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add phases")!.click())
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(items.map((item) => item.id))
    expect(useQueueStore.getState().activeIndex).toBe(before.activeIndex)
    expect(useQueueStore.getState().headers.filter((header) => header.type === "phase")).toHaveLength(4)
    expect(useQueueStore.getState().past).toHaveLength(1)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click())
    expect({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex }).toEqual(before)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("confirms removing one phase and restores its exact timing with Undo", async () => {
    const items = [slide("Prayer"), slide("Sermon"), slide("Closing")]
    const headers = [
      { id: "pre", type: "phase" as const, name: "Pre-service", at: 0, rule: "loop" as const, role: "pre" as const, advance_seconds: 30 },
      { id: "prayer", type: "group" as const, name: "Prayer", at: 0, event: { schema_version: 1 as const, duration_minutes: 15 } },
      { id: "main", type: "phase" as const, name: "Main service", at: 1, rule: "manual" as const, role: "main" as const, starts_at: "10:00" },
      { id: "post", type: "phase" as const, name: "Post-service", at: 2, rule: "loop" as const, role: "post" as const, advance_seconds: 20 },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 1 })
    useQueueStore.getState().resetHistory()
    const before = structuredClone({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-sermon", liveSlide: null, liveVerse: null })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()

    const trigger = el.querySelector<HTMLButtonElement>('button[aria-label="Main service: options"]')!
    await act(async () => {
      const down = new Event("pointerdown", { bubbles: true })
      Object.assign(down, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      trigger.dispatchEvent(down)
    })
    const remove = [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.trim() === "Remove phase…")!
    expect(remove).toBeDefined()
    await act(async () => {
      const down = new Event("pointerdown", { bubbles: true })
      Object.assign(down, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      remove.dispatchEvent(down)
      remove.dispatchEvent(new Event("pointerup", { bubbles: true }))
      remove.click()
    })

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain("Remove “Main service”?")
    expect(useQueueStore.getState().headers).toEqual(headers)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Remove phase")!.click())

    expect(useQueueStore.getState().headers).toEqual(before.headers.filter((header) => header.id !== "main"))
    expect(useQueueStore.getState().items).toEqual(before.items)
    expect(useQueueStore.getState().activeIndex).toBe(before.activeIndex)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click())
    expect({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex }).toEqual(before)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("confirms removal of all phases without deleting events or content", async () => {
    const items = [slide("Prayer"), slide("Sermon")]
    const headers = [
      { id: "pre", type: "phase" as const, name: "Pre-service", at: 0, rule: "loop" as const, role: "pre" as const },
      { id: "sermon", type: "group" as const, name: "Sermon", at: 1, event: { schema_version: 1 as const, duration_minutes: 40 } },
      { id: "main", type: "phase" as const, name: "Main service", at: 1, rule: "manual" as const, role: "main" as const },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 0 })
    useQueueStore.getState().resetHistory()
    const before = structuredClone({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-prayer" })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()
    const trigger = el.querySelector<HTMLButtonElement>('button[aria-label="Phase options"]')
    expect(trigger).not.toBeNull()
    await act(async () => {
      const down = new Event("pointerdown", { bubbles: true })
      Object.assign(down, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      trigger!.dispatchEvent(down)
    })
    const remove = [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.trim() === "Remove phases…")!
    await act(async () => {
      const down = new Event("pointerdown", { bubbles: true })
      Object.assign(down, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      remove.dispatchEvent(down)
      remove.dispatchEvent(new Event("pointerup", { bubbles: true }))
      remove.click()
    })
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain("Remove all phases?")
    expect(useQueueStore.getState().headers).toEqual(headers)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Remove phases")!.click())

    expect(useQueueStore.getState().headers).toEqual(before.headers.filter((header) => header.type !== "phase"))
    expect(useQueueStore.getState().items).toEqual(before.items)
    expect(useQueueStore.getState().activeIndex).toBe(before.activeIndex)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click())
    expect({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex }).toEqual(before)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("keeps a collapsed phase's rows reachable in Simple list", async () => {
    useQueueStore.setState({
      items: [slide("Sermon opener"), slide("John 3:16")],
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main" },
        { id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1, duration_minutes: 40 } },
      ],
      activeIndex: null,
    })

    const el = await renderPrepare()
    const collapse = el.querySelector<HTMLButtonElement>('button[aria-label="Hide Main service"]')!
    const simple = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Simple list")!
    const grouped = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Grouped by phase")!

    await act(async () => collapse.click())
    expect(el.querySelectorAll('ol[aria-label="Service rundown"] button[title="Click to preview"]')).toHaveLength(0)

    await act(async () => simple.click())
    expect(el.querySelector('[aria-label="Phase: Main service"]')).toBeNull()
    expect(el.querySelector('[aria-label="Event: Sermon"]')).not.toBeNull()
    expect(el.querySelectorAll('ol[aria-label="Service rundown"] button[title="Click to preview"]')).toHaveLength(2)

    await act(async () => grouped.click())
    expect(el.querySelector('[aria-label="Phase: Main service"]')).not.toBeNull()
    expect(el.querySelectorAll('ol[aria-label="Service rundown"] button[title="Click to preview"]')).toHaveLength(0)
  })

  it("reveals and focuses a successful Add inside collapsed sections", async () => {
    useQueueStore.setState({
      items: [slide("Existing moment")],
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main" },
        { id: "sermon", type: "group", name: "Sermon", at: 0, event: { schema_version: 1 } },
        { id: "scripture", type: "group", name: "Scripture moments", at: 0 },
      ],
      activeIndex: null,
    })
    useServiceStore.setState({
      current: { id: "existing-service", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 },
      dirty: false,
      saving: false,
    })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item", liveSlide: null, liveVerse: null })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Hide Scripture moments"]')!.click())
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Hide Sermon"]')!.click())
    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Hide Main service"]')!.click())
    expect(el.querySelectorAll('ol[aria-label="Service rundown"] button[title="Click to preview"]')).toHaveLength(0)

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Add to Main service"]')!.click())
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const slidesTab = [...dialog.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find((button) => button.textContent?.trim() === "Slides")!
    await act(async () => { slidesTab.focus(); slidesTab.click() })
    const title = dialog.querySelector<HTMLInputElement>('[aria-label="Slide title"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Added moment")
      title.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add to service")!.click())

    const added = useQueueStore.getState().items.at(-1)!
    const row = el.querySelector<HTMLElement>(`[data-rundown-item-id="${added.id}"]`)
    expect(row).not.toBeNull()
    expect(el.querySelector('button[aria-label="Hide Main service"]')).not.toBeNull()
    expect(el.querySelector('button[aria-label="Hide Sermon"]')).not.toBeNull()
    expect(el.querySelector('button[aria-label="Hide Scripture moments"]')).not.toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(row), { timeout: 1000 })
    expect(useAddDialog.getState().open).toBe(false)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("adds an event at the end of its chosen phase before the next phase boundary", async () => {
    useQueueStore.setState({
      items: [slide("Opening"), slide("Sermon"), slide("Closing")],
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main" },
        { id: "post", type: "phase", name: "Post-service loop", at: 2, rule: "loop", role: "post" },
      ],
      activeIndex: null,
    })
    const el = await renderPrepare()
    const addPrayer = el.querySelector<HTMLButtonElement>('button[aria-label="Add event after Main service"]')!
    await act(async () => addPrayer.click())
    const prayer = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim().startsWith("Prayer"))!
    await act(async () => prayer.click())

    const state = useQueueStore.getState()
    const eventIndex = state.headers.findIndex((header) => header.event)
    const postIndex = state.headers.findIndex((header) => header.name === "Post-service loop")
    expect(state.headers[eventIndex]).toMatchObject({ name: "Opening Prayer", at: 2, event: { schema_version: 1, role: "Prayer" } })
    expect(eventIndex).toBeLessThan(postIndex)
    expect(el.querySelector('[aria-label="Event: Opening Prayer"]')).not.toBeNull()
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
    await act(async () => {
      const planTab = el.querySelector<HTMLButtonElement>('button[aria-label="Event plan"]')!
      planTab.focus()
      planTab.click()
    })
    const duration = el.querySelector<HTMLInputElement>('[aria-label="Planned event length in minutes"]')!
    const setValue = (field: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value)
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
