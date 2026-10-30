// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const presentCalls = vi.hoisted(() => ({
  next: vi.fn(),
  prev: vi.fn(),
  clear: vi.fn(),
  restore: vi.fn(),
  verseNext: vi.fn(),
  versePrev: vi.fn(),
  ticker: vi.fn(),
}))

vi.mock("@/studio/present-actions", () => ({ presentActions: presentCalls }))
vi.mock("@/components/panels/preview-panel", () => ({ PreviewPanel: () => <section aria-label="Preview">Preview stays private</section> }))
vi.mock("@/components/panels/live-output-panel", () => ({ LiveOutputPanel: () => <section data-studio-live>Program</section> }))
vi.mock("@/components/panels/search-panel", () => ({ SearchPanel: () => <div data-testid="bible-search-panel">Bible search</div> }))
vi.mock("@/components/panels/transcript-panel", () => ({ TranscriptPanel: () => <div data-testid="transcript-panel">Transcript</div> }))
vi.mock("@/components/panels/detections-panel", () => ({ DetectionsPanel: () => <div data-testid="detections-panel">Detections</div> }))
vi.mock("@/components/ui/embedding-warning-banner", () => ({ EmbeddingWarningBanner: () => null }))
vi.mock("@/studio/ui/status-chip", () => ({ StatusChip: ({ label }: { label: string }) => <span>{label}</span> }))
vi.mock("@/studio/ui/big-button", () => ({ BigButton: ({ label }: { label: string }) => <button type="button">{label}</button> }))
vi.mock("@/studio/present/timed-moves", () => ({ TimedMoves: () => null }))
vi.mock("@/studio/present/phase-strip", () => ({ PhaseStrip: () => null }))
vi.mock("@/studio/present/rundown-list", () => ({ RundownList: () => <div data-testid="rundown-list" /> }))
vi.mock("@/studio/present/quick-find", () => ({ QuickFind: () => <input aria-label="Quick find" /> }))
vi.mock("@/studio/present/service-timer", () => ({ ServiceTimer: () => null }))
vi.mock("@/studio/present/aux-timers", () => ({ AuxTimers: () => null }))
vi.mock("@/studio/present/stage-message", () => ({ StageMessage: () => null }))
vi.mock("@/studio/present/lower-third", () => ({ LowerThirdControl: () => null }))
vi.mock("@/studio/present/ticker", () => ({ TickerRow: () => null }))
vi.mock("@/studio/present/obs-chip", () => ({ ObsChip: () => null }))
vi.mock("@/studio/present/sound-chip", () => ({ SoundChip: () => null }))
vi.mock("@/studio/present/recorder-dock", () => ({ RecorderDock: () => <section aria-label="Rhema recording dock">Rhema recording controls</section> }))
vi.mock("@/studio/present/cue-menu", () => ({ CueMenu: () => null }))
vi.mock("@/studio/present/transport-bar", () => ({ TransportBar: () => <div role="toolbar" aria-label="Presentation controls"><button>Take live</button></div> }))
vi.mock("@/studio/present/scenes-strip", () => ({ ScenesStrip: () => null }))
vi.mock("@/studio/production/production-workspace", () => ({
  ProductionWorkspace: ({ embedded }: { embedded?: boolean }) => <section data-testid="production-tools" data-embedded={embedded ? "true" : "false"}>Production tools</section>,
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBibleStore, useBroadcastStore, useDetectionStore, useQueueStore, useTranscriptStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { openProductionTab, useProductionTab } from "@/studio/production/production-tab"
import type { QueueItem, TranscriptSegment, Verse } from "@/types"
import { PresentWorkspace } from "./present-workspace"

const verse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world",
}
const queueItem: QueueItem = {
  id: "stable-item",
  reference: "John 3:16",
  confidence: 1,
  source: "manual",
  added_at: 0,
  verse,
}
const secondQueueItem: QueueItem = {
  id: "stable-slide",
  kind: "slide",
  reference: "Welcome",
  confidence: 1,
  source: "manual",
  added_at: 1,
  slide: { title: "Welcome", body: "Welcome to the service." },
}
const transcript: TranscriptSegment = {
  id: "segment-1",
  text: "God so loved the world",
  is_final: true,
  confidence: 1,
  words: [],
  timestamp: 1,
}

const initialShell = useShellStore.getState()
const initialBible = useBibleStore.getState()
const initialBroadcast = useBroadcastStore.getState()
const initialQueue = useQueueStore.getState()
const initialTranscript = useTranscriptStore.getState()
const initialDetections = useDetectionStore.getState()

let element: HTMLDivElement
let root: Root

async function renderWorkspace() {
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
  await act(async () => root.render(<PresentWorkspace />))
}

function pressArrowRight(target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  presentCalls.next.mockClear()
  useShellStore.setState({ presentView: "production" })
  useProductionTab.setState({ requested: null, selected: "timekeeper", scene: null, open: false })
  useBibleStore.setState({ selectedVerse: verse, selectedSlide: null, selectedQueueItemId: "stable-item" })
  useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "Program item", segments: [] } })
  useQueueStore.setState({ items: [queueItem, secondQueueItem] })
  useTranscriptStore.setState({ segments: [transcript], isTranscribing: true })
  useDetectionStore.setState({ detections: [{ verse_ref: "John 3:16", verse_text: verse.text, book_name: "John", book_number: 43, chapter: 3, verse: 16, confidence: 1, source: "direct", auto_queued: false, transcript_snippet: transcript.text, is_chapter_only: false }] })
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  useShellStore.setState(initialShell)
  useBibleStore.setState(initialBible)
  useBroadcastStore.setState(initialBroadcast)
  useQueueStore.setState(initialQueue)
  useTranscriptStore.setState(initialTranscript)
  useDetectionStore.setState(initialDetections)
  useProductionTab.setState(useProductionTab.getInitialState())
  vi.restoreAllMocks()
})

describe("Present's unified Live console", () => {
  it("renders one console for the legacy Advanced preference and preserves private Preview, Program, queue, listening and keyboard safety", async () => {
    const addListener = vi.spyOn(window, "addEventListener")
    await renderWorkspace()

    expect(element.querySelector('[role="group"][aria-label="Present view"]')).toBeNull()
    expect(element.querySelectorAll('[data-testid="rundown-list"]')).toHaveLength(1)
    expect(element.querySelector('[aria-label="Preview"]')?.textContent).toContain("stays private")
    expect(element.querySelector("[data-studio-live]")?.textContent).toContain("Program")
    expect(element.querySelector('[aria-label="Rhema recording dock"]')?.textContent).toContain("Rhema recording controls")
    expect(element.querySelector('[role="toolbar"][aria-label="Presentation controls"] button')?.textContent).toBe("Take live")
    expect(useShellStore.getState().presentView).toBe("production")
    expect(addListener.mock.calls.filter(([event]) => event === "keydown")).toHaveLength(1)

    pressArrowRight()
    expect(presentCalls.next).toHaveBeenCalledTimes(1)
    const quickFind = element.querySelector("input")!
    pressArrowRight(quickFind)
    expect(presentCalls.next).toHaveBeenCalledTimes(1)

    const openTools = element.querySelector<HTMLButtonElement>('[data-tour="live-tools"]')!
    await act(async () => openTools.click())
    expect(openTools.getAttribute("aria-label")).toBe("Close Bible and listening tools")
    expect(element.querySelectorAll('[aria-label="Close Live tools"]')).toHaveLength(1)
    expect(document.querySelector('[data-slot="live-tools-panel"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
    expect(document.querySelector("[data-testid='bible-search-panel']")).not.toBeNull()
    expect(element.querySelector('[aria-label="Preview"]')?.textContent).toContain("stays private")
    expect(element.querySelector("[data-studio-live]")?.textContent).toContain("Program")

    const listeningTab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent?.includes("Listening"))!
    await act(async () => {
      listeningTab.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }))
      listeningTab.click()
    })
    expect(document.querySelector("[data-testid='transcript-panel']")).not.toBeNull()
    expect(document.querySelector("[data-testid='detections-panel']")).not.toBeNull()
    pressArrowRight()
    expect(presentCalls.next).toHaveBeenCalledTimes(1)

    const close = document.querySelector<HTMLButtonElement>('[data-slot="live-tools-panel"] button[aria-label="Close Live tools"]')!
    await act(async () => close.click())
    expect(document.querySelector('[data-slot="live-tools-panel"]')).toBeNull()
    expect(document.activeElement).toBe(openTools)
    await act(async () => openTools.click())
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Listening")
    expect(document.querySelector("[data-testid='transcript-panel']")).not.toBeNull()

    const liveToolsPanel = document.querySelector<HTMLElement>('[data-slot="live-tools-panel"]')!
    await act(async () => {
      liveToolsPanel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    })
    expect(document.querySelector('[data-slot="live-tools-panel"]')).toBeNull()
    expect(document.activeElement).toBe(openTools)

    expect(useQueueStore.getState().items).toEqual([queueItem, secondQueueItem])
    expect(useBibleStore.getState()).toMatchObject({ selectedVerse: verse, selectedQueueItemId: "stable-item" })
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveVerse: { reference: "Program item" } })
    expect(useTranscriptStore.getState().segments).toEqual([transcript])
    expect(useDetectionStore.getState().detections[0]?.verse_ref).toBe("John 3:16")
    expect(useShellStore.getState().presentView).toBe("production")
  })

  it("opens Production tools inside the same Live console with one rundown, Preview, Program and Take", async () => {
    await renderWorkspace()

    await act(async () => openProductionTab("obs"))

    expect(useShellStore.getState().goRequest).toBe("present")
    expect(useProductionTab.getState().selected).toBe("obs")
    expect(document.querySelector('[data-testid="production-tools"]')?.getAttribute("data-embedded")).toBe("true")
    expect(element.querySelector<HTMLButtonElement>('[aria-label="Close production tools"]')).not.toBeNull()
    expect(element.querySelectorAll('[aria-label="Close Live tools"]')).toHaveLength(1)
    expect(element.querySelectorAll('[data-testid="rundown-list"]')).toHaveLength(1)
    expect(element.querySelector('[aria-label="Preview"]')?.textContent).toContain("stays private")
    expect(element.querySelector("[data-studio-live]")?.textContent).toContain("Program")
    expect([...element.querySelectorAll('[role="toolbar"][aria-label="Presentation controls"] button')].filter((button) => button.textContent === "Take live")).toHaveLength(1)
  })
})
