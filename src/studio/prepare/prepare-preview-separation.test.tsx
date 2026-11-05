// @vitest-environment jsdom
/**
 * Owner decision on #447 (5 Nov 2026): planning, previewing and presenting are three actions.
 * Library Add to Service and Prepare selection focus the item in Prepare only; Live's Preview,
 * Program, Stage, named outputs and the clock change only by an explicit Send to Live Preview
 * (Preview) or Take (Program).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  ;(globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s }
  if (globalThis.HTMLCanvasElement) {
    const context = new Proxy({ font: "" }, {
      get: (target, property) => property === "measureText"
        ? (text: string) => ({ width: text.length * 8 })
        : property === "canvas"
          ? { width: 1920, height: 1080 }
          : Reflect.get(target, property) ?? (() => undefined),
      set: (target, property, value) => Reflect.set(target, property, value),
    })
    globalThis.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext
  }
})

const fixtures = vi.hoisted(() => ({
  song: {
    id: "song-c",
    title: "Song C",
    authors: "",
    licence: "unknown" as const,
    primary_language: "en",
    languages: ["en"],
    numbers: [] as string[],
    first_line: "First line of C",
    revision: 1,
    updated_at: "2026-11-05T00:00:00Z",
  },
}))
const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ set: async () => {}, save: async () => {}, get: async () => undefined }) }))
vi.mock("@chenglou/pretext", () => ({ clearCache: vi.fn() }))
vi.mock("@chenglou/pretext/rich-inline", () => ({
  prepareRichInline: vi.fn(() => ({})),
  materializeRichInlineLineRange: vi.fn(() => []),
  measureRichInlineStats: vi.fn(() => ({ width: 0, height: 0, lines: 0 })),
  walkRichInlineLineRanges: vi.fn(),
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { PrepareWorkspace } from "./prepare-workspace"
import { LibraryWorkspace } from "@/studio/library/library-workspace"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useTimerStore } from "@/stores/timer-store"
import { useEventClock } from "@/stores/event-clock-store"
import { usePhaseRun } from "@/stores/phase-run-store"
import { useLibraryPreview } from "@/stores/library-preview-store"
import { useShellStore } from "@/studio/shell-store"
import { useAddDialog } from "@/studio/prepare/add-target"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
import { libraryHeaderTarget, useLibraryTargetStore } from "@/studio/library/library-target-store"
import { useProductionTab } from "@/studio/production/production-tab"
import { presentActions } from "@/studio/present-actions"
import type { BroadcastOutput, SlideQueueItem } from "@/types"

const slide = (id: string, title = id): SlideQueueItem =>
  ({ id, kind: "slide", slide: { title, body: `${title} words` }, reference: title, confidence: 1, source: "manual", added_at: 0 })

/** Live Preview shows A; Program shows B, which is running. */
const itemA = slide("item-a", "Preview A")
const itemB = slide("item-b", "Program B")
const programB = { kind: "slide", content: "slide", reference: "Program B", segments: [], lines: ["Program B words"] }

const output = (id: string, name: string, extra: Partial<BroadcastOutput> = {}): BroadcastOutput => ({
  id,
  name,
  type: "display",
  role: "congregation",
  sceneId: `${id}-scene`,
  themeId: "default",
  monitorIndex: 0,
  ndi: { sourceName: name, resolution: "r1080p", frameRate: "fps30", alphaMode: "noneOpaque" },
  ...extra,
})
const outputs = [
  output("sanctuary", "Sanctuary"),
  output("overflow", "Overflow", { language: "second", sceneId: "overflow-scene" }),
  output("stage", "Stage", { role: "stage" }),
]

const service = { id: "service-a", title: "Sunday service", service_date: null, revision: 3, created_at: "", updated_at: "", item_count: 2 }

function Harness() {
  const workspace = useShellStore((s) => s.workspace)
  return workspace === "library" ? <LibraryWorkspace /> : <PrepareWorkspace />
}

let root: Root | null = null
let host: HTMLDivElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command: string) => {
    if (command === "content_list_songs") return [fixtures.song]
    if (command.endsWith("_list") || command.startsWith("content_list")) return []
    return null
  })
  useQueueStore.setState({
    items: [itemA, itemB],
    headers: [{ id: "event-worship", type: "group", name: "Worship", at: 0, event: { schema_version: 1 } }],
    activeIndex: 1,
    addTarget: null,
  })
  useServiceStore.setState({ programs: [service], current: service, dirty: false, loading: false, saving: false })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: { item: itemA, index: 0 }, selectedQueueItemId: itemA.id })
  useBroadcastStore.setState({ isLive: true, liveItemId: itemB.id, liveVerse: programB as never, liveSlide: null, outputs: structuredClone(outputs) })
  useProductionTab.setState({ liveOutputId: "overflow" })
  useRundownSelection.setState({ ids: [], anchor: null, focusId: null })
  useLibraryPreview.setState({ inspected: null })
  useLibraryTargetStore.getState().clearAll()
  useLibraryTargetStore.getState().remember("service-a", libraryHeaderTarget("event-worship"))
  useAddDialog.getState().close()
  useShellStore.setState({ workspace: "library", librarySection: "songs", prepareLibraryReturn: null, prepareDesignReturn: null, prepareMomentFocus: null })
  host = document.body.appendChild(document.createElement("div"))
  root = createRoot(host)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  useAddDialog.getState().close()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

/** Everything Live owns: Preview, Program, outputs (and Stage), the running position and the clock. */
function liveState() {
  const bible = useBibleStore.getState()
  const broadcast = useBroadcastStore.getState()
  return plain({
    preview: { verse: bible.selectedVerse, slide: bible.selectedSlide, queueItemId: bible.selectedQueueItemId },
    program: { isLive: broadcast.isLive, liveItemId: broadcast.liveItemId, liveVerse: broadcast.liveVerse, liveSlide: broadcast.liveSlide },
    outputs: broadcast.outputs,
    scenes: broadcast.scenes,
    liveOutputId: useProductionTab.getState().liveOutputId,
    activeIndex: useQueueStore.getState().activeIndex,
    timer: useTimerStore.getState(),
    eventClock: useEventClock.getState(),
    phaseRun: usePhaseRun.getState(),
  })
}

const liveCommands = () => mockInvoke.mock.calls.map(([command]) => String(command)).filter((command) => /present|take|feed|show_live|output|stage/i.test(command))

function spyOnGoLive() {
  return (["showLive", "presentItem", "next", "prev", "quickScreen", "verseNext", "versePrev"] as const).map((key) => vi.spyOn(presentActions, key))
}

const button = (label: string, scope: ParentNode = document.body) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label)

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function render() {
  await act(async () => root!.render(<Harness />))
  await settle()
}

/** Library → Songs → pick Song C → Add to service (the remembered Worship event). */
async function addFromLibrary() {
  if (useShellStore.getState().workspace !== "library") await act(async () => useShellStore.getState().setWorkspace("library"))
  await settle()
  const card = [...document.body.querySelectorAll<HTMLElement>("button, [role='button']")].find((element) => element.textContent?.includes(fixtures.song.title) && !element.textContent.includes("Add"))
  expect(card).toBeTruthy()
  await act(async () => card!.click())
  const add = [...document.body.querySelectorAll<HTMLButtonElement>('[aria-label="Library preview"] button')].find((candidate) => candidate.textContent?.includes("Add to service"))
  expect(add).toBeTruthy()
  await act(async () => add!.click())
  await settle()
}

const addedSongs = () => useQueueStore.getState().items.filter((item) => item.kind === "song")

describe("Prepare and Library never change Live's Preview or Program (#447)", () => {
  it("Add to Service from Library during a running service focuses C in Prepare; Preview stays A, Program stays B", async () => {
    const goLive = spyOnGoLive()
    await render()
    const before = liveState()

    await addFromLibrary()

    const [c] = addedSongs()
    expect(c).toMatchObject({ kind: "song", song: { song_id: fixtures.song.id } })
    expect(useShellStore.getState().workspace).toBe("prepare")
    expect(useRundownSelection.getState().focusId).toBe(c.id)
    // Back in Prepare on the Worship event, with C focused there.
    expect(host.querySelector(`#event-content-moment-${c.id}`)?.className).toContain("ring-2")
    expect(liveState()).toEqual(before)
    expect(useBibleStore.getState().selectedQueueItemId).toBe(itemA.id)
    expect(useBroadcastStore.getState().liveItemId).toBe(itemB.id)
    expect(useQueueStore.getState().activeIndex).toBe(1)
    for (const spy of goLive) expect(spy).not.toHaveBeenCalled()
    expect(liveCommands()).toEqual([])
  })

  it("picking and adding in Prepare's Add dialog leaves Live's Preview and Program alone", async () => {
    useShellStore.setState({ workspace: "prepare" })
    const goLive = spyOnGoLive()
    await render()
    const before = liveState()

    await act(async () => button("Add item", host)!.click())
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const songsTab = [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent?.trim() === "Songs")!
    await act(async () => { songsTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); songsTab.click() })
    await settle()

    // Picking a row only inspects it.
    const row = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(fixtures.song.title))!
    expect(row).toBeTruthy()
    await act(async () => row.click())
    expect(liveState()).toEqual(before)

    await act(async () => button("Add", dialog)!.click())
    const [c] = addedSongs()
    expect(c).toMatchObject({ kind: "song", song: { song_id: fixtures.song.id } })
    expect(useAddDialog.getState().open).toBe(false)
    expect(useRundownSelection.getState().focusId).toBe(c.id)
    expect(liveState()).toEqual(before)
    for (const spy of goLive) expect(spy).not.toHaveBeenCalled()
    expect(liveCommands()).toEqual([])
  })

  it("repeated additions each focus the newest item and never touch Live", async () => {
    await render()
    const before = liveState()

    await addFromLibrary()
    await addFromLibrary()
    await addFromLibrary()

    const songs = addedSongs()
    expect(songs).toHaveLength(3)
    expect(new Set(songs.map((item) => item.id)).size).toBe(3)
    expect(useRundownSelection.getState().focusId).toBe(songs.at(-1)!.id)
    expect(liveState()).toEqual(before)
    expect(liveCommands()).toEqual([])
  })

  it("a failed add changes nothing: no item, no focus, no Live change", async () => {
    await render()
    const before = liveState()
    const itemsBefore = useQueueStore.getState().items
    const addItem = useQueueStore.getState().addItem
    act(() => useQueueStore.setState({ addItem: () => null }))
    try {
      await addFromLibrary()
    } finally {
      act(() => useQueueStore.setState({ addItem }))
    }

    expect(useQueueStore.getState().items).toEqual(itemsBefore)
    expect(useRundownSelection.getState().focusId).toBeNull()
    expect(useShellStore.getState().workspace).toBe("library")
    expect(liveState()).toEqual(before)
    expect(liveCommands()).toEqual([])
  })

  it("switching service or navigating away after an add leaves Live's Preview as it was", async () => {
    await render()
    const before = liveState()
    await addFromLibrary()

    await act(async () => useShellStore.getState().setWorkspace("home"))
    await settle()
    await act(async () => useShellStore.getState().setWorkspace("prepare"))
    await settle()
    expect(liveState()).toEqual(before)

    const other = { ...service, id: "service-b", title: "Evening service" }
    await act(async () => {
      useServiceStore.setState({ programs: [service, other], current: other })
      useQueueStore.setState({ items: [slide("evening-1", "Evening welcome")], headers: [] })
    })
    await settle()
    const preview = useBibleStore.getState()
    expect({ slide: preview.selectedSlide?.item.id, queueItemId: preview.selectedQueueItemId }).toEqual({ slide: itemA.id, queueItemId: itemA.id })
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveItemId: itemB.id, liveVerse: programB })
    expect(liveCommands()).toEqual([])
  })

  // Offline mode: Rhema has no offline flag or mode to switch (it is offline-first: no network is
  // needed for Prepare, Library or Live), so there is no separate offline path to test here.

  it("keeps each named output's own Preview screen, language and scene", async () => {
    await render()
    const outputsBefore = plain(useBroadcastStore.getState().outputs)
    await addFromLibrary()

    expect(useProductionTab.getState().liveOutputId).toBe("overflow")
    expect(plain(useBroadcastStore.getState().outputs)).toEqual(outputsBefore)
    expect(useBroadcastStore.getState().outputs.find((candidate) => candidate.id === "overflow")).toMatchObject({ language: "second", sceneId: "overflow-scene" })
    expect(useBroadcastStore.getState().outputs.find((candidate) => candidate.id === "stage")).toMatchObject({ role: "stage", sceneId: "stage-scene" })
  })

  it("a rundown click in Prepare only focuses; Send to Live Preview arms Preview but never Program", async () => {
    useShellStore.setState({ workspace: "prepare" })
    const goLive = spyOnGoLive()
    await render()
    const before = liveState() as { preview: unknown }

    const rowB = host.querySelector<HTMLElement>(`[data-rundown-item-id="${itemB.id}"] button[title^="Click to open it in the editor"]`)!
    expect(rowB).toBeTruthy()
    await act(async () => rowB.click())
    expect(useRundownSelection.getState().focusId).toBe(itemB.id)
    expect(liveState()).toEqual(before)

    await act(async () => button("Send to Live Preview", host)!.click())
    expect(useBibleStore.getState().selectedQueueItemId).toBe(itemB.id)
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(itemB.id)
    const after = liveState() as { preview: unknown }
    expect(after.preview).not.toEqual(before.preview)
    expect({ ...after, preview: null }).toEqual({ ...before, preview: null })
    for (const spy of goLive) expect(spy).not.toHaveBeenCalled()
    expect(liveCommands()).toEqual([])
  })
})
