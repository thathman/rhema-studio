// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

// jsdom has no ResizeObserver (the drag-and-drop library needs one at import), CSS.escape or scrollIntoView.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  ;(globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s }
})
// Lists come back empty; anything else has nothing to say.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd.endsWith("_list")) return []
    if (cmd === "content_create_program") return {
      id: "local-draft",
      title: String(args?.title ?? "Service draft"),
      service_date: typeof args?.serviceDate === "string" ? args.serviceDate : null,
      revision: 1,
      created_at: "",
      updated_at: "",
      item_count: 0,
    }
    if (cmd === "content_replace_items") return {
      program: {
        id: String(args?.programId ?? "local-draft"),
        title: "Service draft",
        service_date: null,
        revision: 2,
        created_at: "",
        updated_at: "",
        item_count: Array.isArray(args?.items) ? args.items.length : 0,
      },
      items: [],
    }
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { PrepareWorkspace } from "./prepare-workspace"
import { saveStateOf } from "./save-state"
import { useQueueStore } from "@/stores/queue-store"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useAddDialog } from "@/studio/prepare/add-target"
import { useShellStore } from "@/studio/shell-store"
import { presentActions } from "@/studio/present-actions"
import type { QueueItem } from "@/types"
import { projectRunOfShowEvents } from "@/lib/run-of-show"
import { toItemInputs } from "@/stores/service-store"

const slide = (id: string): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "words" }, reference: id, confidence: 1, source: "manual", added_at: 0, planned_minutes: 3 }) as unknown as QueueItem

const RUNDOWN_VIEW_KEY = "rhema.prepare.rundown-view.v1"
const preferenceStorage = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => preferenceStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { preferenceStorage.set(key, String(value)) },
  removeItem: (key: string) => { preferenceStorage.delete(key) },
  clear: () => preferenceStorage.clear(),
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  try { window.localStorage.removeItem(RUNDOWN_VIEW_KEY) } catch { /* unavailable in the Node test runner */ }
  useAddDialog.getState().close()
  preferenceStorage.clear()
  document.body.replaceChildren()
  useServiceStore.setState({ programs: [], current: null, dirty: false, saving: false })
  vi.unstubAllGlobals()
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
  it("switches rundown views 20 times without changing the plan or live state (#409, #444)", async () => {
    vi.stubGlobal("localStorage", localStorageMock)
    const items = [slide("Pre-service"), slide("Opening prayer"), slide("Sermon"), slide("Closing")]
    const headers = [
      { id: "pre", type: "phase" as const, name: "Pre-service", at: 0, rule: "loop" as const, role: "pre" as const, advance_seconds: 30 },
      { id: "prayer", type: "group" as const, name: "Opening Prayer", at: 1, event: { schema_version: 1 as const, duration_minutes: 15 } },
      { id: "main", type: "phase" as const, name: "Main service", at: 2, rule: "manual" as const, role: "main" as const, starts_at: "10:00" },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 2 })
    useBroadcastStore.setState({ isLive: true, liveVerse: null, liveSlide: null, liveItemId: "on-air" })
    const planBefore = {
      items: useQueueStore.getState().items,
      headers: useQueueStore.getState().headers,
      activeIndex: useQueueStore.getState().activeIndex,
    }
    const liveBefore = {
      isLive: useBroadcastStore.getState().isLive,
      liveItemId: useBroadcastStore.getState().liveItemId,
    }
    const assertPlanAndLiveUnchanged = () => {
      const plan = useQueueStore.getState()
      expect(plan.items).toEqual(planBefore.items)
      expect(plan.headers).toEqual(planBefore.headers)
      expect(plan.activeIndex).toBe(planBefore.activeIndex)
      const live = useBroadcastStore.getState()
      expect(live.isLive).toBe(liveBefore.isLive)
      expect(live.liveItemId).toBe(liveBefore.liveItemId)
    }
    const clickView = async (name: "Simple list" | "Grouped by phase") => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === name)
      expect(button).toBeDefined()
      await act(async () => button!.click())
    }

    let el = await renderPrepare()
    expect(el.querySelector('[aria-label="Phase: Pre-service"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Phases"]')).not.toBeNull()
    const collapsePre = el.querySelector<HTMLButtonElement>('button[aria-label="Hide Pre-service"]')!
    await act(async () => collapsePre.click())
    expect(el.querySelectorAll('ol[aria-label="Service rundown"] button[title="Click to preview"]')).toHaveLength(2)

    await clickView("Simple list")
    expect(localStorageMock.getItem(RUNDOWN_VIEW_KEY)).toBe("simple")
    expect(el.querySelector('[aria-label="Phase: Pre-service"]')).toBeNull()
    expect(el.querySelector('[aria-label="Phase: Main service"]')).toBeNull()
    expect(el.querySelector('[aria-label="Phases"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Event: Opening Prayer"]')).not.toBeNull()
    const visibleItems = [...el.querySelectorAll<HTMLButtonElement>('ol[aria-label="Service rundown"] button[title="Click to preview"]')].map((button) => button.textContent ?? "")
    expect(visibleItems).toHaveLength(4)
    expect(visibleItems.map((label) => ["Pre-service", "Opening prayer", "Sermon", "Closing"].find((name) => label.includes(name)))).toEqual(["Pre-service", "Opening prayer", "Sermon", "Closing"])
    assertPlanAndLiveUnchanged()

    for (let flip = 0; flip < 20; flip += 1) {
      const name = flip % 2 === 0 ? "Grouped by phase" : "Simple list"
      await clickView(name)
      expect(localStorageMock.getItem(RUNDOWN_VIEW_KEY)).toBe(flip % 2 === 0 ? "grouped" : "simple")
      expect(el.querySelector('[aria-label="Phase: Pre-service"]') !== null).toBe(flip % 2 === 0)
      expect(el.querySelector('[aria-label="Phases"]')).not.toBeNull()
      expect(el.querySelector('[aria-label="Event: Opening Prayer"]') !== null).toBe(flip % 2 !== 0)
      expect(el.querySelectorAll('ol[aria-label="Service rundown"] button[title="Click to preview"]')).toHaveLength(flip % 2 === 0 ? 2 : 4)
      assertPlanAndLiveUnchanged()
    }

    act(() => root?.unmount())
    root = null
    document.body.replaceChildren()
    el = await renderPrepare()
    expect(el.querySelector('[aria-label="Phase: Pre-service"]')).toBeNull()
    expect(el.querySelector('[aria-label="Event: Opening Prayer"]')).not.toBeNull()
    await clickView("Grouped by phase")
    expect(el.querySelector('[aria-label="Phase: Pre-service"]')).not.toBeNull()
    assertPlanAndLiveUnchanged()
  })

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
    expect(document.body.querySelector<HTMLInputElement>("#svc-title")).not.toBeNull()
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Cancel")!.click())
    await openActions()
    const duplicate = [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.trim() === "Duplicate service")!
    await chooseAction(duplicate)
    expect(document.body.querySelector<HTMLInputElement>("#dup-title")?.value).toBe("Sunday service (copy)")
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

  // The richer persistence/collapse-state regression above covers this view switch.
  it("requires confirmation to remove phases and restores their exact state with Undo", async () => {
    const items = [slide("Welcome"), slide("Sermon moment"), slide("Closing")]
    const headers = [
      { id: "warmup", type: "phase" as const, name: "Warm-up", at: 0, rule: "loop" as const, starts_at: "09:30", advance_seconds: 45 },
      { id: "sermon", type: "group" as const, name: "Sermon", at: 1, event: { schema_version: 1 as const, duration_minutes: 40, ownership: "Pastor" } },
      { id: "moments", type: "group" as const, name: "Bible moments", at: 2, payload_extra: { cue: "keep" } },
      { id: "post", type: "phase" as const, name: "Post-service loop", at: 3, rule: "loop" as const, disabled: true, starts_at: "12:00" },
    ]
    useQueueStore.setState({ items, headers, activeIndex: 1 })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item", liveSlide: null, liveVerse: null })
    const planBefore = structuredClone({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()
    const openOptions = async () => {
      await act(async () => {
        const trigger = el.querySelector<HTMLButtonElement>('button[aria-label="Phase options"]')!
        const pointerDown = new Event("pointerdown", { bubbles: true })
        Object.assign(pointerDown, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
        trigger.dispatchEvent(pointerDown)
      })
      const remove = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === "Remove phases…")!
      await act(async () => {
        const pointerDown = new Event("pointerdown", { bubbles: true })
        Object.assign(pointerDown, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
        remove.dispatchEvent(pointerDown)
        remove.dispatchEvent(new Event("pointerup", { bubbles: true }))
        remove.click()
      })
    }

    await openOptions()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("loop rules")
    const keep = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Keep phases")!
    await act(async () => keep.click())
    expect(useQueueStore.getState().headers).toEqual(planBefore.headers)

    await openOptions()
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Remove phases")!
    await act(async () => confirm.click())
    expect(useQueueStore.getState().headers).toEqual(headers.filter((header) => header.type !== "phase"))
    expect(useQueueStore.getState().items).toEqual(items)
    expect(useQueueStore.getState().activeIndex).toBe(1)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)

    const undo = el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!
    await act(async () => undo.click())
    expect({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex }).toEqual(planBefore)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("explains phase placement before organising and keeps items and output unchanged", async () => {
    const items = [slide("Welcome"), slide("Sermon moment"), slide("Closing")]
    const event = { id: "sermon", type: "group" as const, name: "Sermon", at: 1, event: { schema_version: 1 as const, duration_minutes: 40 } }
    useQueueStore.setState({ items, headers: [event], activeIndex: 1 })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item", liveSlide: null, liveVerse: null })
    const planBefore = structuredClone({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()

    await act(async () => el.querySelector<HTMLButtonElement>('button[title="Add phase structure around the current running order"]')!.click())
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("placed in Main service")
    const keep = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Keep current list")!
    await act(async () => keep.click())
    expect({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex }).toEqual(planBefore)

    await act(async () => el.querySelector<HTMLButtonElement>('button[title="Add phase structure around the current running order"]')!.click())
    const add = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add phases")!
    await act(async () => add.click())
    const state = useQueueStore.getState()
    expect(state.items.map((item) => item.id)).toEqual(items.map((item) => item.id))
    expect(state.activeIndex).toBe(planBefore.activeIndex)
    expect(state.headers.filter((header) => header.type === "phase").map((header) => header.name)).toEqual([
      "Pre-service loop", "Warm-up", "Main service", "Post-service loop",
    ])
    expect(state.headers.find((header) => header.id === event.id)).toEqual(event)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)

    await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click())
    expect({ items: useQueueStore.getState().items, headers: useQueueStore.getState().headers, activeIndex: useQueueStore.getState().activeIndex }).toEqual(planBefore)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("keeps a zero-moment event inside Main service when phases are added to an empty rundown", async () => {
    const event = { id: "sermon", type: "group" as const, name: "Sermon", at: 0, event: { schema_version: 1 as const, duration_minutes: 40 } }
    useQueueStore.setState({ items: [], headers: [event], activeIndex: null })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item", liveSlide: null, liveVerse: null })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()

    await act(async () => el.querySelector<HTMLButtonElement>('button[title="Add phase structure around the current running order"]')!.click())
    const add = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add phases")!
    await act(async () => add.click())

    const rows = [...el.querySelectorAll<HTMLElement>('ol[aria-label="Service rundown"] > li')]
      .map((row) => row.getAttribute("aria-label"))
    expect(rows).toEqual([
      "Phase: Pre-service loop",
      "Phase: Warm-up",
      "Phase: Main service",
      "Event: Sermon",
      "Phase: Post-service loop",
    ])
    expect(useQueueStore.getState().headers.find((header) => header.id === event.id)).toEqual(event)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("does not expose non-draggable phase rows as disabled parents of phase controls", async () => {
    useQueueStore.setState({
      items: [],
      headers: [
        { id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main" },
        { id: "moments", type: "group", name: "Sermon moments", at: 0 },
      ],
      activeIndex: null,
    })
    const el = await renderPrepare()

    for (const name of ["Main service", "Sermon moments"]) {
      const kind = name === "Main service" ? "Phase" : "Group"
      const row = el.querySelector<HTMLElement>(`[aria-label="${kind}: ${name}"]`)!
      const add = el.querySelector<HTMLButtonElement>(`button[aria-label="Add to ${name}"]`)!

      expect(row.getAttribute("aria-disabled")).not.toBe("true")
      expect(row.getAttribute("role")).not.toBe("button")
      expect(add.closest('[aria-disabled="true"]')).toBeNull()
      expect(add.disabled).toBe(false)
    }
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

  it("requires confirmation to remove a phase and Undo restores it without changing the live program", async () => {
    const phase = { id: "main", type: "phase" as const, name: "Main service", at: 0, rule: "manual" as const, role: "main" as const }
    useQueueStore.setState({ items: [slide("Welcome")], headers: [phase], activeIndex: null })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item" })
    const before = useBroadcastStore.getState()
    const el = await renderPrepare()

    const trigger = el.querySelector<HTMLButtonElement>('button[aria-label="Main service: options"]')!
    await act(async () => {
      const pointerDown = new Event("pointerdown", { bubbles: true })
      Object.assign(pointerDown, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      trigger.dispatchEvent(pointerDown)
    })
    const remove = [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.trim() === "Remove phase…")!
    await act(async () => {
      const pointerDown = new Event("pointerdown", { bubbles: true })
      Object.assign(pointerDown, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      remove.dispatchEvent(pointerDown)
      remove.dispatchEvent(new Event("pointerup", { bubbles: true }))
      remove.click()
    })

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Events and items stay in the service")
    expect(useQueueStore.getState().headers).toEqual([phase])
    expect(useBroadcastStore.getState()).toEqual(before)

    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Remove phase")!
    await act(async () => confirm.click())
    expect(useQueueStore.getState().headers).toEqual([])
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["Welcome"])
    expect(useBroadcastStore.getState()).toEqual(before)

    await act(async () => useQueueStore.getState().undo())
    expect(useQueueStore.getState().headers).toEqual([phase])
    expect(useBroadcastStore.getState()).toEqual(before)
  })

  it("moves a row across a phase boundary with the accessible controls and leaves the live program unchanged", async () => {
    useQueueStore.setState({
      items: [slide("Opening"), slide("Prayer"), slide("Sermon")],
      headers: [
        { id: "pre", type: "phase", name: "Pre-service", at: 0, rule: "manual", role: "pre" },
        { id: "main", type: "phase", name: "Main service", at: 1, rule: "manual", role: "main" },
      ],
      activeIndex: null,
    })
    useBroadcastStore.setState({ isLive: true, liveItemId: "on-air-item" })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()
    const moveDown = el.querySelector<HTMLButtonElement>('button[aria-label="Move down"]')!

    await act(async () => moveDown.click())

    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["Prayer", "Opening", "Sermon"])
    expect(useQueueStore.getState().headers.find((header) => header.id === "main")?.at).toBe(0)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
    await act(async () => useQueueStore.getState().undo())
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["Opening", "Prayer", "Sermon"])
    expect(useQueueStore.getState().headers.find((header) => header.id === "main")?.at).toBe(1)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
  })

  it("moves a planned event with all its moments from the keyboard menu without changing Live", async () => {
    useQueueStore.setState({
      items: [slide("Prayer"), slide("Scripture"), slide("Sermon"), slide("Quiz")],
      headers: [
        { id: "pre", type: "phase", name: "Pre-service", at: 0, rule: "manual", role: "pre" },
        { id: "prayer-event", type: "group", name: "Opening prayer", at: 0, event: { schema_version: 1, duration_minutes: 15 } },
        { id: "prayer-moments", type: "group", name: "Prayer moments", at: 1 },
        { id: "main", type: "phase", name: "Main service", at: 2, rule: "manual", role: "main" },
        { id: "sermon-event", type: "group", name: "Sermon", at: 2, event: { schema_version: 1, duration_minutes: 40 } },
        { id: "post", type: "phase", name: "Post-service", at: 4, rule: "manual", role: "post" },
      ],
      activeIndex: 1,
    })
    useQueueStore.getState().resetHistory()
    useBroadcastStore.setState({ isLive: true, liveItemId: "live-sermon" })
    const liveBefore = useBroadcastStore.getState()
    const el = await renderPrepare()
    const options = el.querySelector<HTMLButtonElement>('button[aria-label="Opening prayer: options"]')!
    await act(async () => {
      const pointerDown = new Event("pointerdown", { bubbles: true })
      Object.assign(pointerDown, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      options.dispatchEvent(pointerDown)
    })
    const moveDown = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.trim() === "Move event down")!
    await act(async () => {
      const pointerDown = new Event("pointerdown", { bubbles: true })
      Object.assign(pointerDown, { button: 0, ctrlKey: false, pointerType: "mouse", isPrimary: true })
      moveDown.dispatchEvent(pointerDown)
      moveDown.dispatchEvent(new Event("pointerup", { bubbles: true }))
      moveDown.click()
    })

    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["Sermon", "Quiz", "Prayer", "Scripture"])
    expect(useQueueStore.getState().headers.find((header) => header.id === "prayer-event")?.at).toBe(2)
    expect(useQueueStore.getState().headers.find((header) => header.id === "prayer-moments")?.at).toBe(3)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
    await act(async () => useQueueStore.getState().undo())
    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["Prayer", "Scripture", "Sermon", "Quiz"])
    expect(useQueueStore.getState().headers.find((header) => header.id === "prayer-event")?.at).toBe(0)
    expect(useBroadcastStore.getState()).toEqual(liveBefore)
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
