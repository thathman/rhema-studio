// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const presentCalls = vi.hoisted(() => {
  if (globalThis.HTMLCanvasElement) {
    const context = new Proxy({ font: "" }, {
      get: (target, property) => property === "measureText"
        ? (text: string) => ({ width: text.length * 8 })
        : property === "canvas"
          ? { width: 1920, height: 1080 }
          : Reflect.get(target, property) ?? (() => undefined),
      set: (target, property, value) => Reflect.set(target, property, value),
    })
    globalThis.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as typeof globalThis.HTMLCanvasElement.prototype.getContext
  }
  return {
    next: vi.fn(),
    prev: vi.fn(),
    clear: vi.fn(),
    restore: vi.fn(),
    verseNext: vi.fn(),
    versePrev: vi.fn(),
    ticker: vi.fn(),
  }
})

vi.mock("@/studio/present-actions", () => ({ presentActions: presentCalls }))
vi.mock("@/components/panels/preview-panel", () => ({ PreviewPanel: ({ compact, outputLanguageId, onOutputLanguageIdChange }: { compact?: boolean; outputLanguageId?: string | null; onOutputLanguageIdChange?: (id: string) => void }) => <section aria-label="Preview" data-compact={compact ? "true" : "false"} data-preview-output={outputLanguageId ?? "none"}>Preview stays private<label>Output<select aria-label="Named congregation output for Preview language and scene Take" value={outputLanguageId ?? ""} onChange={(event) => onOutputLanguageIdChange?.(event.currentTarget.value)}><option value="english-output">English screen</option><option value="yoruba-output">Yoruba screen</option></select></label></section> }))
vi.mock("@/components/panels/live-output-panel", () => ({ LiveOutputPanel: ({ outputId, sceneTakeAction }: { outputId?: string | null; sceneTakeAction?: React.ReactNode }) => <section data-program-output={outputId ?? "none"}>Program{sceneTakeAction}</section> }))
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
vi.mock("@/studio/present/stage-message", () => ({ StageMessage: () => <button type="button">Stage messages</button> }))
vi.mock("@/studio/present/lower-third", () => ({ LowerThirdControl: () => <button type="button">Lower thirds</button> }))
vi.mock("@/studio/present/ticker", () => ({ TickerRow: () => null }))
vi.mock("@/studio/present/obs-chip", () => ({ ObsChip: () => null }))
vi.mock("@/studio/present/sound-chip", () => ({ SoundChip: () => <button type="button">Sound controls</button> }))
vi.mock("@/studio/present/recorder-dock", () => ({ RecorderDock: () => <section aria-label="Rhema recording dock">Rhema recording controls</section> }))
vi.mock("@/studio/present/cue-menu", () => ({ CueMenu: () => <button type="button">Cues</button> }))
vi.mock("@/studio/engage/host-control", () => ({ EngageHostControl: () => <button type="button">Engage host</button> }))
vi.mock("@/studio/present/transport-bar", () => ({ TransportBar: ({ className }: { className?: string }) => <div className={className} role="toolbar" aria-label="Presentation controls"><button>Take source live</button></div> }))
vi.mock("@/studio/present/scenes-strip", () => ({ ScenesStrip: ({ outputId, onTakeSelectionChange }: { outputId?: string | null; onTakeSelectionChange?: (selection: { outputId: string; outputName: string; sceneId: string; sceneName: string; sceneUpdatedAt: number; revisionLabel: string; disabledReason: null; details: null }) => void }) => <section data-testid="scene-target" data-scene-output={outputId ?? "none"}><button type="button" aria-label={`Preview scene for ${outputId}`} onClick={() => outputId && onTakeSelectionChange?.({ outputId, outputName: outputId === "yoruba-output" ? "Yoruba screen" : "English screen", sceneId: "welcome", sceneName: "Welcome", sceneUpdatedAt: 1, revisionLabel: "Scene v1", disabledReason: null, details: null })}>Preview scene</button></section> }))
vi.mock("@/studio/present/live-scene-take-action", () => ({ LiveSceneTakeAction: ({ selection }: { selection: { outputName: string; sceneName: string } | null }) => selection ? <div data-testid="named-scene-take">Take {selection.sceneName} to {selection.outputName}</div> : null }))
vi.mock("@/studio/production/production-workspace", () => ({
  ProductionWorkspace: ({ embedded }: { embedded?: boolean }) => <section data-testid="production-tools" data-embedded={embedded ? "true" : "false"}>Production tools</section>,
}))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBibleStore, useBroadcastStore, useDetectionStore, useQueueStore, useTranscriptStore } from "@/stores"
import { useAuxTimers } from "@/stores/aux-timers-store"
import { useShellStore } from "@/studio/shell-store"
import { openProductionTab, useProductionTab } from "@/studio/production/production-tab"
import { useServiceStore } from "@/stores/service-store"
import type { Program, QueueItem, TranscriptSegment, Verse } from "@/types"
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
const emptyService: Program = {
  id: "empty-service",
  title: "Sunday Service",
  service_date: null,
  revision: 1,
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  item_count: 0,
}

const initialShell = useShellStore.getState()
const initialBible = useBibleStore.getState()
const initialBroadcast = useBroadcastStore.getState()
const initialQueue = useQueueStore.getState()
const initialTranscript = useTranscriptStore.getState()
const initialDetections = useDetectionStore.getState()
const initialService = useServiceStore.getState()

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
  useQueueStore.setState({ items: [queueItem, secondQueueItem], headers: [] })
  useTranscriptStore.setState({ segments: [transcript], isTranscribing: true })
  useDetectionStore.setState({ detections: [{ verse_ref: "John 3:16", verse_text: verse.text, book_name: "John", book_number: 43, chapter: 3, verse: 16, confidence: 1, source: "direct", auto_queued: false, transcript_snippet: transcript.text, is_chapter_only: false }] })
  useAuxTimers.setState({ timers: [] })
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
  useAuxTimers.setState({ timers: [] })
  useServiceStore.setState(initialService)
  useProductionTab.setState(useProductionTab.getInitialState())
  vi.restoreAllMocks()
})

describe("Present's unified Live console", () => {
  it("keeps a running auxiliary timer visible as read-only status while management stays in Timekeeper", async () => {
    useAuxTimers.setState({ timers: [{ id: "communion-prep", label: "Communion prep", timer: { durationMs: 300_000, startedAt: performance.now(), accumulatedMs: 0 }, onStage: false, owner: "" }] })
    await renderWorkspace()

    const timerStatus = element.querySelector<HTMLElement>('[title="Additional timer: Communion prep"]')
    expect(timerStatus?.textContent).toContain("Communion prep")
    expect(timerStatus?.textContent).toContain("Running extra timer:")
    expect(timerStatus?.textContent).toMatch(/\d:\d{2}/)
    expect(timerStatus?.querySelector("button")).toBeNull()
    expect(element.querySelector('[role="toolbar"][aria-label="Live tools"] [title*="Other timers"]')).toBeNull()
  })

  it("offers safe next steps when no service is open without changing Program or the rundown", async () => {
    const program = useBroadcastStore.getState().liveVerse
    const wasLive = useBroadcastStore.getState().isLive
    useServiceStore.setState({ current: null })
    useBibleStore.setState({ selectedVerse: null, selectedSlide: null })
    useQueueStore.setState({ items: [], headers: [] })
    await renderWorkspace()

    const recovery = element.querySelector<HTMLElement>('[role="region"][aria-label="Live setup actions"]')!
    expect(recovery.textContent).toContain("No service open")
    expect(recovery.querySelector('p[title*="Plan changes never update Program"]')).not.toBeNull()
    expect(recovery.textContent).toContain("Take waits for a Preview item")
    expect(element.querySelector('[data-tour="quick-find"]')).toBeNull()
    expect(element.querySelector('[data-studio-live]')?.textContent).toContain("Program")
    expect(element.querySelector('[data-tour="present-rundown"]')?.className).toContain("row-span-1")
    expect(element.querySelector('[data-tour="present-rundown"]')?.className).toContain("h-fit")
    expect(element.querySelector('[data-tour="present-rundown"]')?.className).toContain("self-start")
    expect(element.querySelector('[data-testid="rundown-list"]')).toBeNull()

    const button = (label: string) => [...recovery.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label") === label)!
    await act(async () => button("Open a saved service").click())
    expect(useShellStore.getState().goRequest).toBe("archive")

    await act(async () => {
      button("Find Scripture or hymn").click()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    const quickFind = element.querySelector('[data-slot="live-tools-panel"] [data-tour="quick-find"] input[aria-label="Quick find"]')
    expect(quickFind).not.toBeNull()
    expect(document.activeElement).toBe(quickFind)

    await act(async () => button("Review outputs").click())
    expect(useShellStore.getState().outputsDialogOpen).toBe(true)

    await act(async () => button("Create a service").click())
    expect(useShellStore.getState()).toMatchObject({ goRequest: "prepare", newServiceOpen: true })
    expect(useServiceStore.getState().current).toBeNull()
    expect(useQueueStore.getState()).toMatchObject({ items: [], headers: [] })
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: wasLive, liveVerse: program })
  })

  it("keeps full private Preview and actual Program in the medium-width Live layout", async () => {
    await renderWorkspace()

    const preview = element.querySelector<HTMLElement>('[aria-label="Preview"]')!
    const paneLayout = preview.parentElement!.parentElement!
    const program = element.querySelector<HTMLElement>('[data-studio-live]')!
    expect(preview.dataset.compact).toBe("false")
    expect(preview.parentElement?.className).toContain("max-[1200px]:min-h-[18rem]")
    expect(preview.parentElement?.className).toContain("max-[1200px]:shrink-0")
    expect(paneLayout.className).toContain("max-[1200px]:grid-cols-1")
    expect(paneLayout.className).toContain("min-[1024px]:max-[1200px]:grid-cols-2")
    expect(program.textContent).toContain("Program")
    expect(program.className).toContain("min-h-[18rem]")
    expect(element.querySelectorAll('[aria-label="Preview"]')).toHaveLength(1)
    const transport = element.querySelector<HTMLElement>('[role="toolbar"][aria-label="Presentation controls"]')!
    expect(transport.className).toContain("max-[1200px]:sticky")
    expect(transport.className).toContain("max-[1200px]:bottom-0")
    expect(transport.parentElement?.className).toContain("max-[1200px]:pb-40")
  })

  it("keeps a zero-moment event visible instead of treating its plan as no service", async () => {
    useServiceStore.setState({ current: null })
    useQueueStore.setState({ items: [], headers: [{ id: "event", type: "group", name: "Welcome", at: 0, event: { schema_version: 1 } }] })
    await renderWorkspace()

    expect(element.querySelector('[role="region"][aria-label="Live setup actions"]')).toBeNull()
    expect(element.querySelector('[data-testid="rundown-list"]')).not.toBeNull()
    expect(element.querySelector('[data-tour="present-rundown"]')?.className).toContain("row-span-3")
  })

  it("shows the run-of-show Now and Next with planned timing, separately from Program", async () => {
    const program = useBroadcastStore.getState().liveVerse
    useQueueStore.setState({
      items: [
        { ...queueItem, planned_minutes: 12 },
        { ...secondQueueItem, planned_minutes: 8 },
      ],
      headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }],
      activeIndex: 0,
    })
    await renderWorkspace()

    const summary = element.querySelector<HTMLElement>('[aria-label="Run of show Now and Next"]')!
    expect(summary.querySelector('[aria-label="Now in the run of show"]')?.textContent).toContain("John 3:16")
    expect(summary.querySelector('[aria-label="Next in the run of show"]')?.textContent).toContain("Welcome")
    expect(summary.querySelector('[aria-label="Next in the run of show"]')?.textContent).toContain("10:12")
    expect(useBroadcastStore.getState().liveVerse).toEqual(program)
  })

  it("takes an open but empty service to Prepare to add its first event", async () => {
    useServiceStore.setState({ current: emptyService })
    useQueueStore.setState({ items: [], headers: [] })
    await renderWorkspace()

    const recovery = element.querySelector<HTMLElement>('[role="region"][aria-label="Live setup actions"]')!
    expect(recovery.textContent).toContain("No events in this service")
    const addEvent = recovery.querySelector<HTMLButtonElement>('[aria-label="Add event in Prepare"]')!
    await act(async () => addEvent.click())
    expect(useShellStore.getState().goRequest).toBe("prepare")
    expect(useShellStore.getState().newServiceOpen).toBe(false)
    expect(useServiceStore.getState().current).toEqual(emptyService)
    expect(useQueueStore.getState()).toMatchObject({ items: [], headers: [] })
  })

  it("shares one named congregation output across private Preview, Program and the named scene Take", async () => {
    const baseOutput = useBroadcastStore.getState().outputs[0]!
    useBroadcastStore.setState({ outputs: [
      { ...baseOutput, id: "stage-output", name: "Stage monitor", role: "stage", language: "both" },
      { ...baseOutput, id: "english-output", name: "English screen", role: "congregation", language: "first" },
      { ...baseOutput, id: "yoruba-output", name: "Yoruba screen", role: "congregation", language: "second" },
    ] })
    const program = useBroadcastStore.getState().liveVerse
    await renderWorkspace()

    const preview = element.querySelector<HTMLElement>('[aria-label="Preview"]')!
    expect(preview.dataset.previewOutput).toBe("english-output")
    await act(async () => {
      const selector = preview.querySelector<HTMLSelectElement>('[aria-label="Named congregation output for Preview language and scene Take"]')!
      selector.value = "yoruba-output"
      selector.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(preview.dataset.previewOutput).toBe("yoruba-output")
    expect(element.querySelector<HTMLElement>("[data-program-output]")?.dataset.programOutput).toBe("yoruba-output")
    expect(element.querySelector<HTMLElement>("[data-testid=scene-target]")?.dataset.sceneOutput).toBe("yoruba-output")
    expect(element.querySelectorAll('[aria-label="Named congregation output for Preview language and scene Take"]')).toHaveLength(1)
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="Preview scene for yoruba-output"]')!.click())
    expect(element.querySelector('[data-testid="named-scene-take"]')?.textContent).toBe("Take Welcome to Yoruba screen")
    expect(element.querySelectorAll('[data-testid="named-scene-take"]')).toHaveLength(1)
    expect(element.querySelector('[role="toolbar"][aria-label="Presentation controls"]')?.textContent).toContain("Take source live")
    expect(element.querySelector('[role="toolbar"][aria-label="Presentation controls"]')?.textContent).not.toContain("Take Welcome")
    expect(element.querySelector('[data-program-output="yoruba-output"] [data-testid="named-scene-take"]')).not.toBeNull()
    expect(useBroadcastStore.getState().liveVerse).toEqual(program)
  })

  it("keeps the actual Program readable above the independently scrolling scene controls", async () => {
    await renderWorkspace()

    const program = element.querySelector<HTMLElement>("[data-studio-live]")
    expect(program).not.toBeNull()
    expect(program?.className).toContain("min-h-[18rem]")
    expect(program?.parentElement?.className).toContain("overflow-y-auto")
    expect(program?.nextElementSibling?.getAttribute("data-testid")).toBe("scene-target")
    expect(program?.textContent).toContain("Program")
  })

  it("renders one console for the legacy Advanced preference and preserves private Preview, Program, queue, listening and keyboard safety", async () => {
    const addListener = vi.spyOn(window, "addEventListener")
    await renderWorkspace()

    expect(element.querySelector('[role="group"][aria-label="Present view"]')).toBeNull()
    expect(element.querySelectorAll('[data-testid="rundown-list"]')).toHaveLength(1)
    expect(element.querySelector('[aria-label="Preview"]')?.textContent).toContain("stays private")
    expect(element.querySelector("[data-studio-live]")?.textContent).toContain("Program")
    expect(element.querySelector('[aria-label="Rhema recording dock"]')?.textContent).toContain("Rhema recording controls")
    expect(element.querySelector('[role="toolbar"][aria-label="Presentation controls"] button')?.textContent).toBe("Take source live")
    const quickActions = element.querySelector<HTMLElement>('[data-testid="quick-screen-actions"]')!
    expect(quickActions.className).toContain("max-[1200px]:grid-cols-4")
    expect(quickActions.className).toContain("max-[800px]:grid-cols-2")
    expect(quickActions.className).toContain("overflow-x-hidden")
    expect(quickActions.textContent).toContain("Technical issue")
    expect(quickActions.textContent).toContain("Black")
    expect(useShellStore.getState().presentView).toBe("production")
    expect(addListener.mock.calls.filter(([event]) => event === "keydown")).toHaveLength(1)

    pressArrowRight()
    expect(presentCalls.next).toHaveBeenCalledTimes(1)
    const openTools = element.querySelector<HTMLButtonElement>('[data-tour="live-tools"]')!
    await act(async () => openTools.click())
    expect(openTools.getAttribute("aria-label")).toBe("Close Find and listening tools")
    expect(element.querySelectorAll('[aria-label="Close Live tools"]')).toHaveLength(1)
    expect(document.querySelector('[data-slot="live-tools-panel"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="live-tools-panel"]')?.parentElement?.className).toContain("max-[1200px]:h-[14.5rem]")
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
    const quickFind = element.querySelector<HTMLInputElement>('[data-slot="live-tools-panel"] [data-tour="quick-find"] input[aria-label="Quick find"]')!
    expect(quickFind).not.toBeNull()
    expect(element.querySelector('[data-tour="quick-find"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="live-tools-panel"] [role="tab"][aria-selected="true"]')?.textContent).toContain("Find & cue")
    pressArrowRight(quickFind)
    expect(presentCalls.next).toHaveBeenCalledTimes(1)
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

  it("keeps the Live toolbar compact and opens secondary controls from the shared tools drawer", async () => {
    useServiceStore.setState({ current: emptyService })
    useTranscriptStore.setState({ isTranscribing: false })
    await renderWorkspace()

    const toolbar = element.querySelector<HTMLElement>('[role="toolbar"][aria-label="Live tools"]')!
    const liveTools = toolbar.querySelector<HTMLButtonElement>('[aria-label="Toggle Live tools"]')!
    expect(toolbar.querySelector('[aria-label="Open production tools"]')).toBeNull()
    expect(toolbar.querySelector('[aria-label="Open other controls"]')).toBeNull()
    expect(toolbar.textContent).not.toContain("Listening off")
    expect(toolbar.textContent).not.toContain("Saved translations")
    expect(toolbar.textContent).not.toContain("Cues")
    expect(toolbar.textContent).not.toContain("Sound controls")
    expect(toolbar.textContent).not.toContain("Lower thirds")
    expect(toolbar.textContent).not.toContain("Stage messages")
    expect(toolbar.textContent).not.toContain("Engage host")
    expect(liveTools.getAttribute("aria-expanded")).toBe("false")

    await act(async () => liveTools.click())

    expect(liveTools.getAttribute("aria-expanded")).toBe("true")
    expect(element.querySelector('[data-slot="live-tools-panel"] [role="tab"][aria-selected="true"]')?.textContent).toContain("Production tools")
    const controlsTab = [...element.querySelectorAll<HTMLElement>('[data-slot="live-tools-panel"] [role="tab"]')].find((tab) => tab.textContent?.includes("More controls"))!
    await act(async () => {
      controlsTab.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }))
      controlsTab.click()
    })
    expect(element.querySelector('[data-slot="live-tools-panel"] [role="tab"][aria-selected="true"]')?.textContent).toContain("More controls")
    const controls = element.querySelector<HTMLElement>('[role="group"][aria-label="Secondary Live controls"]')!
    expect(controls.textContent).toContain("Cues")
    expect(controls.textContent).toContain("Sound controls")
    expect(controls.textContent).toContain("Lower thirds")
    expect(controls.textContent).toContain("Stage messages")
    expect(controls.textContent).toContain("Engage host")
    expect(element.querySelector('[data-tour="live-tools"]')?.getAttribute("aria-expanded")).toBe("false")

    const close = element.querySelector<HTMLButtonElement>('[data-slot="live-tools-panel"] button[aria-label="Close Live tools"]')!
    await act(async () => close.click())
    expect(document.querySelector('[data-slot="live-tools-panel"]')).toBeNull()
    expect(document.activeElement).toBe(liveTools)
  })

  it("keeps the service translation override with contextual Find and cue tools", async () => {
    useServiceStore.setState({ current: emptyService })
    useBibleStore.setState({ overrideServiceTranslations: false })
    await renderWorkspace()

    const toolbar = element.querySelector<HTMLElement>('[role="toolbar"][aria-label="Live tools"]')!
    expect(toolbar.textContent).not.toContain("Saved translations")

    const find = toolbar.querySelector<HTMLButtonElement>('[aria-label="Open Find and listening tools"]')!
    await act(async () => find.click())
    const panel = element.querySelector<HTMLElement>('[data-slot="live-tools-panel"]')!
    const override = panel.querySelector<HTMLButtonElement>('[aria-label^="Override all service translations with"]')!
    expect(override.getAttribute("aria-pressed")).toBe("false")
    await act(async () => override.click())
    expect(useBibleStore.getState().overrideServiceTranslations).toBe(true)

    const useSaved = panel.querySelector<HTMLButtonElement>('[aria-label="Use saved translations for this service"]')!
    expect(useSaved.getAttribute("aria-pressed")).toBe("true")
    await act(async () => useSaved.click())
    expect(useBibleStore.getState().overrideServiceTranslations).toBe(false)
  })

  it("opens Production tools inside the same Live console with one rundown, Preview, Program and Take", async () => {
    await renderWorkspace()

    await act(async () => openProductionTab("obs"))

    expect(useShellStore.getState().goRequest).toBe("present")
    expect(useProductionTab.getState().selected).toBe("obs")
    expect(document.querySelector('[data-testid="production-tools"]')?.getAttribute("data-embedded")).toBe("true")
    expect(element.querySelector<HTMLButtonElement>('[role="toolbar"][aria-label="Live tools"] [aria-label="Toggle Live tools"]')).not.toBeNull()
    expect(element.querySelectorAll('[aria-label="Close Live tools"]')).toHaveLength(1)
    expect(element.querySelectorAll('[data-testid="rundown-list"]')).toHaveLength(1)
    expect(element.querySelector('[aria-label="Preview"]')?.textContent).toContain("stays private")
    expect(element.querySelector("[data-studio-live]")?.textContent).toContain("Program")
    expect([...element.querySelectorAll('[role="toolbar"][aria-label="Presentation controls"] button')].filter((button) => button.textContent === "Take source live")).toHaveLength(1)
  })
})
