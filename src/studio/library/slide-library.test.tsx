// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSlideStore } from "@/stores/slide-store"
import { useMediaStore } from "@/stores/media-store"
import { useShellStore } from "@/studio/shell-store"
import { useServiceStore } from "@/stores/service-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { CustomSlideEditor } from "@/studio/prepare/item-editor-parts"
import { isCurrentPrepareLibraryReturn } from "@/studio/prepare/library-return"
import { SlideLibrary } from "./slide-library"

const mockInvoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }))
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn(async () => new Uint8Array()) }))

type Row = { id: string; kind: "slide" | "announcement"; title: string; body: string; link: string | null; background_media_id: string | null; revision: number; created_at: string; updated_at: string }
const rows = new Map<string, Row>()
let root: Root | null = null

beforeEach(() => {
  rows.clear()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "media_list") return []
    if (command === "content_list_reusable_slides") {
      const q = String(args.query ?? "").toLowerCase()
      return [...rows.values()].filter((row) => !q || `${row.title} ${row.body}`.toLowerCase().includes(q))
    }
    if (command === "content_create_reusable_slide") {
      const input = args.input as Omit<Row, "id" | "revision" | "created_at" | "updated_at">
      const now = new Date().toISOString()
      const row = { ...input, id: `source-${rows.size + 1}`, revision: 1, created_at: now, updated_at: now }
      rows.set(row.id, row)
      return row
    }
    if (command === "content_update_reusable_slide") {
      const current = rows.get(String(args.id))!
      const updated = { ...current, ...(args.input as object), revision: current.revision + 1, updated_at: new Date().toISOString() }
      rows.set(updated.id, updated)
      return updated
    }
    if (command === "content_delete_reusable_slide") { rows.delete(String(args.id)); return null }
    throw new Error(`Unexpected command ${command}`)
  })
  useSlideStore.setState({ slides: [], loading: false, error: null, query: "", pendingSourceId: null })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
  useBibleStore.setState({ selectedSlide: null, selectedQueueItemId: null })
  useMediaStore.setState({ assets: [], loaded: true, loading: false, error: null })
  useServiceStore.setState({ current: null, dirty: false, saving: false })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveSlide: null, liveItemId: null })
  useShellStore.setState({ workspace: "library", prepareLibraryReturn: null, prepareDesignReturn: null })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render() {
  await act(async () => { root!.render(<SlideLibrary />) })
}

async function setValue(label: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(label) || candidate.getAttribute("aria-label") === label)!
}

describe("reusable slide library workflow (#395)", () => {
  it("creates a source, adds an independent occurrence, and does not rewrite it when the source changes", async () => {
    await render()
    await setValue("Reusable slide title", "Welcome")
    await setValue("Reusable slide text", "Library wording")
    await act(async () => button("Save to library").click())
    expect(rows.size).toBe(1)
    expect(document.body.textContent).toContain("Edit library content")

    await act(async () => button("Add to service").click())
    const occurrence = useQueueStore.getState().items[0]
    expect(occurrence).toMatchObject({ kind: "slide", slide: { title: "Welcome", body: "Library wording", source_asset_id: "source-1", source_revision: 1 } })
    expect(useBibleStore.getState().selectedQueueItemId).toBe(occurrence.id)
    expect(useShellStore.getState().workspace).toBe("prepare")

    await setValue("Reusable slide title", "Welcome renamed")
    await setValue("Reusable slide text", "Updated library wording")
    await act(async () => button("Save source").click())
    expect(rows.get("source-1")).toMatchObject({ title: "Welcome renamed", body: "Updated library wording" })
    expect(useQueueStore.getState().items[0]).toMatchObject({ slide: { body: "Library wording", source_revision: 1 } })
  })

  it("imports the selected service slide as a reusable source and prevents removing an in-use source", async () => {
    useQueueStore.setState({ items: [{ id: "service-slide", kind: "slide", slide: { title: "Giving", body: "This week" }, reference: "Giving", confidence: 1, source: "manual", added_at: 0 }] })
    useBibleStore.setState({ selectedQueueItemId: "service-slide" })
    await render()
    await act(async () => button("Save selected service slide to library").click())
    expect(rows.get("source-1")).toMatchObject({ title: "Giving", body: "This week" })

    useQueueStore.setState({ items: [{ id: "use-it", kind: "slide", slide: { title: "Giving", body: "This week", source_asset_id: "source-1", source_revision: 1 }, reference: "Giving", confidence: 1, source: "manual", added_at: 0 }] })
    await act(async () => button("Remove Giving").click())
    await act(async () => button("Delete").click())
    expect(rows.has("source-1")).toBe(true)
    expect(mockInvoke.mock.calls.some(([command]) => command === "content_delete_reusable_slide")).toBe(false)
  })

  it("uses a reusable slide in the caller's event and returns focused there without changing Program", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Reusable words", link: null, background_media_id: null, revision: 4, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    const original = {
      id: "moment-1", kind: "slide" as const,
      slide: { title: "Existing", body: "Existing words", source_asset_id: source.id, source_revision: source.revision },
      reference: "Existing", confidence: 1, source: "manual" as const, added_at: 0,
    }
    useQueueStore.setState({
      items: [original],
      headers: [{ id: "event-1", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } }],
      activeIndex: null,
      addTarget: null,
    })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 1 } })
    const programVerse = { reference: "Program baseline" }
    useBroadcastStore.setState({ isLive: true, liveItemId: "program-item", liveVerse: programVerse as never })

    await act(async () => root!.render(<CustomSlideEditor item={original} />))
    await act(async () => button("Edit reusable source").click())
    expect(useShellStore.getState().workspace).toBe("library")
    expect(useShellStore.getState().prepareLibraryReturn).toMatchObject({
      serviceId: "service-1", eventId: "event-1", momentId: "moment-1", eventTitle: "Opening",
    })

    await act(async () => root!.unmount())
    document.body.replaceChildren()
    root = createRoot(document.body.appendChild(document.createElement("div")))
    await render()
    await vi.waitFor(() => expect(button("Add to service")).toBeTruthy())
    await act(async () => button("Add to service").click())

    const queue = useQueueStore.getState()
    expect(queue.items).toHaveLength(2)
    const added = queue.items[1]
    expect(added).toMatchObject({ slide: { source_asset_id: source.id, source_revision: 4, body: "Reusable words" } })
    expect(queue.headers).toEqual([{ id: "event-1", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } }])
    expect(queue.addTarget).toBeNull()
    expect(useShellStore.getState()).toMatchObject({
      workspace: "prepare",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "event-1", targetHeaderTitle: "Opening", eventId: "event-1", momentId: added.id, momentTitle: "Welcome" },
    })
    expect(rows.get(source.id)).toEqual(source)
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveItemId: "program-item", liveVerse: programVerse })
  })

  it("uses an event-level Add target without crossing into the next event", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Reusable words", link: null, background_media_id: null, revision: 2, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    const opening = { id: "opening-moment", kind: "slide" as const, slide: { title: "Opening", body: "Welcome" }, reference: "Opening", confidence: 1, source: "manual" as const, added_at: 0 }
    const sermon = { id: "sermon-moment", kind: "slide" as const, slide: { title: "Sermon", body: "Listen" }, reference: "Sermon", confidence: 1, source: "manual" as const, added_at: 0 }
    useSlideStore.setState({ slides: [source] })
    useQueueStore.setState({
      items: [opening, sermon],
      headers: [
        { id: "event-1", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } },
        { id: "event-2", type: "group", name: "Sermon", at: 1, event: { schema_version: 1 } },
      ],
      activeIndex: null,
      addTarget: null,
    })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 2 } })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "event-1", targetHeaderTitle: "Opening", eventId: "event-1", momentId: null, eventTitle: "Opening", momentTitle: null },
    })
    const liveBefore = { isLive: true, liveItemId: "program-item", liveVerse: { reference: "Program baseline" } }
    useBroadcastStore.setState(liveBefore as never)

    await render()
    await vi.waitFor(() => expect(button("Welcome")).toBeTruthy())
    await act(async () => button("Welcome").click())
    await act(async () => button("Add to service").click())

    const queue = useQueueStore.getState()
    expect(queue.items.map((item) => item.id)).toEqual(["opening-moment", expect.any(String), "sermon-moment"])
    expect(queue.headers.map(({ id, at }) => [id, at])).toEqual([["event-1", 0], ["event-2", 2]])
    expect(queue.addTarget).toBeNull()
    expect(queue.items[1]).toMatchObject({ slide: { source_asset_id: source.id, source_revision: source.revision, body: source.body } })
    expect(useShellStore.getState()).toMatchObject({
      workspace: "prepare",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "event-1", targetHeaderTitle: "Opening", eventId: "event-1", momentId: queue.items[1].id, momentTitle: "Welcome" },
    })
    expect(useBroadcastStore.getState()).toMatchObject(liveBefore)
  })

  it("adds a reusable slide to the captured phase instead of the rundown end", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Reusable words", link: null, background_media_id: null, revision: 1, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    useSlideStore.setState({ slides: [source] })
    useQueueStore.setState({
      items: [
        { id: "pre-service", kind: "slide", slide: { title: "Before", body: "Before" }, reference: "Before", confidence: 1, source: "manual", added_at: 0 },
        { id: "main-service", kind: "slide", slide: { title: "After", body: "After" }, reference: "After", confidence: 1, source: "manual", added_at: 0 },
      ],
      headers: [
        { id: "phase-1", type: "phase", name: "Pre-service", at: 0, rule: "manual", role: "pre" },
        { id: "phase-2", type: "phase", name: "Main service", at: 1, rule: "manual", role: "main" },
      ],
      activeIndex: null,
      addTarget: null,
    })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 2 } })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "phase-1", targetHeaderTitle: "Pre-service", eventId: null, momentId: null, eventTitle: null, momentTitle: null },
    })

    await render()
    await vi.waitFor(() => expect(button("Welcome")).toBeTruthy())
    await act(async () => button("Welcome").click())
    await act(async () => button("Add to service").click())

    const queue = useQueueStore.getState()
    expect(queue.items.map((item) => item.id)).toEqual(["pre-service", expect.any(String), "main-service"])
    expect(queue.headers.map(({ id, at }) => [id, at])).toEqual([["phase-1", 0], ["phase-2", 2]])
    expect(queue.addTarget).toBeNull()
    const prepareReturn = useShellStore.getState().prepareLibraryReturn!
    expect(prepareReturn).toMatchObject({ targetHeaderId: "phase-1", momentId: queue.items[1].id })
    expect(isCurrentPrepareLibraryReturn(prepareReturn)).toBe(true)
    expect(useShellStore.getState().workspace).toBe("prepare")
  })

  it("requires saving reusable source edits before adding their new revision to a service", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Old words", link: null, background_media_id: null, revision: 1, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    useSlideStore.setState({ slides: [source] })
    const program = { isLive: true, liveItemId: "program-item", liveVerse: { reference: "Program baseline" } }
    useBroadcastStore.setState(program as never)

    await render()
    await vi.waitFor(() => expect(button("Welcome")).toBeTruthy())
    await act(async () => button("Welcome").click())
    await setValue("Reusable slide title", "Welcome updated")
    await setValue("Reusable slide text", "New words")

    expect(button("Add to service").disabled).toBe(true)
    await act(async () => button("Add to service").click())
    expect(useQueueStore.getState().items).toEqual([])
    expect(rows.get(source.id)).toEqual(source)

    await act(async () => button("Save source").click())
    await vi.waitFor(() => expect(button("Add to service").disabled).toBe(false))
    await act(async () => button("Add to service").click())

    expect(useQueueStore.getState().items[0]).toMatchObject({
      slide: { title: "Welcome updated", body: "New words", source_asset_id: source.id, source_revision: 2 },
    })
    expect(rows.get(source.id)).toMatchObject({ title: "Welcome updated", body: "New words", revision: 2 })
    expect(useBroadcastStore.getState()).toMatchObject(program)
  })

  it("refuses to add a reusable slide when its caller's service context has gone stale", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Reusable words", link: null, background_media_id: null, revision: 1, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    useSlideStore.setState({ slides: [source] })
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useServiceStore.setState({ current: { id: "different-service", title: "Other service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "event-1", targetHeaderTitle: "Opening", eventId: "event-1", momentId: "moment-1", eventTitle: "Opening", momentTitle: "Prayer" },
    })

    await render()
    await vi.waitFor(() => expect(button("Welcome")).toBeTruthy())
    await act(async () => button("Welcome").click())
    expect(button("Add to service")).toBeTruthy()
    await act(async () => button("Add to service").click())
    await act(async () => button("Add to service").click())

    expect(useQueueStore.getState().items).toEqual([])
    expect(useShellStore.getState().workspace).toBe("library")
    expect(useShellStore.getState().prepareLibraryReturn).toMatchObject({ eventId: "event-1", momentId: "moment-1" })
    expect(useSlideStore.getState().slides).toEqual([source])
  })

  it("refuses to add when the caller's moment was removed while the Library was open", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Reusable words", link: null, background_media_id: null, revision: 1, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    useSlideStore.setState({ slides: [source] })
    useQueueStore.setState({
      items: [], headers: [{ id: "event-1", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } }],
      activeIndex: null, addTarget: null,
    })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "event-1", targetHeaderTitle: "Opening", eventId: "event-1", momentId: "removed-moment", eventTitle: "Opening", momentTitle: "Prayer" },
    })

    await render()
    await vi.waitFor(() => expect(button("Welcome")).toBeTruthy())
    await act(async () => button("Welcome").click())
    await act(async () => button("Add to service").click())

    expect(useQueueStore.getState().items).toEqual([])
    expect(useShellStore.getState().workspace).toBe("library")
  })

  it("refuses an event-level Add when the caller's event was removed", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Reusable words", link: null, background_media_id: null, revision: 1, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    useSlideStore.setState({ slides: [source] })
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "removed-event", targetHeaderTitle: "Opening", eventId: "removed-event", momentId: null, eventTitle: "Opening", momentTitle: null },
    })

    await render()
    await vi.waitFor(() => expect(button("Welcome")).toBeTruthy())
    await act(async () => button("Welcome").click())
    await act(async () => button("Add to service").click())

    expect(useQueueStore.getState().items).toEqual([])
    expect(useShellStore.getState().workspace).toBe("library")
  })

  it("refuses to add when the captured nested group moved to a different event", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Reusable words", link: null, background_media_id: null, revision: 1, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    useSlideStore.setState({ slides: [source] })
    const opening = { id: "opening-moment", kind: "slide" as const, slide: { title: "Opening", body: "Welcome" }, reference: "Opening", confidence: 1, source: "manual" as const, added_at: 0 }
    const sermon = { id: "sermon-moment", kind: "slide" as const, slide: { title: "Sermon", body: "Listen" }, reference: "Sermon", confidence: 1, source: "manual" as const, added_at: 0 }
    useQueueStore.setState({
      items: [opening, sermon],
      headers: [
        { id: "event-1", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } },
        { id: "group-1", type: "group", name: "Welcome slides", at: 0 },
        { id: "event-2", type: "group", name: "Sermon", at: 1, event: { schema_version: 1 } },
      ],
      activeIndex: null,
      addTarget: null,
    })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 2 } })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "group-1", targetHeaderTitle: "Welcome slides", eventId: "event-1", momentId: null, eventTitle: "Opening", momentTitle: null },
    })

    await render()
    await vi.waitFor(() => expect(button("Welcome")).toBeTruthy())
    await act(async () => button("Welcome").click())
    useQueueStore.setState({
      headers: [
        { id: "event-1", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } },
        { id: "event-2", type: "group", name: "Sermon", at: 1, event: { schema_version: 1 } },
        { id: "group-1", type: "group", name: "Welcome slides", at: 1 },
      ],
    })
    await act(async () => button("Add to service").click())

    expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["opening-moment", "sermon-moment"])
    expect(useShellStore.getState().workspace).toBe("library")
    expect(useShellStore.getState().prepareLibraryReturn).toMatchObject({ targetHeaderId: "group-1", eventId: "event-1", momentId: null })
  })

  it("refuses to add when the captured phase was removed", async () => {
    const source: Row = { id: "source-1", kind: "slide", title: "Welcome", body: "Reusable words", link: null, background_media_id: null, revision: 1, created_at: "", updated_at: "" }
    rows.set(source.id, source)
    useSlideStore.setState({ slides: [source] })
    useQueueStore.setState({ items: [], headers: [], activeIndex: null, addTarget: null })
    useServiceStore.setState({ current: { id: "service-1", title: "Sunday service", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 0 } })
    useShellStore.setState({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "removed-phase", targetHeaderTitle: "Pre-service", eventId: null, momentId: null, eventTitle: null, momentTitle: null },
    })

    await render()
    await vi.waitFor(() => expect(button("Welcome")).toBeTruthy())
    await act(async () => button("Welcome").click())
    await act(async () => button("Add to service").click())

    expect(useQueueStore.getState().items).toEqual([])
    expect(useShellStore.getState().workspace).toBe("library")
  })
})
