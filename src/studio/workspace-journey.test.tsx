// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => {
  const localPrefs = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => localPrefs.get(key) ?? null,
    setItem: (key: string, value: string) => { localPrefs.set(key, String(value)) },
    removeItem: (key: string) => { localPrefs.delete(key) },
    clear: () => { localPrefs.clear() },
    key: (index: number) => [...localPrefs.keys()][index] ?? null,
    get length() { return localPrefs.size },
  } as Storage
  const request = {
    id: "approval-1",
    kind: "plan_approve",
    targetId: "service-1",
    baseRevision: 4,
    requester: { id: "editor-1", name: "Editor desk" },
    payload: { title: "Sunday service", revision: 4, items: 1 },
    reason: "Ready for host review",
    state: "approved",
    createdAt: "2026-11-01T09:00:00Z",
    expiresAt: "2026-11-02T09:00:00Z",
    decidedBy: { id: "host-1", name: "Main desk" },
    decidedAt: "2026-11-01T10:00:00Z",
    decisionNote: null,
  }
  return {
    request,
    requests: [request],
    verses: [{
      id: 1,
      translation_id: 1,
      book_number: 43,
      book_name: "John",
      book_abbreviation: "Jn",
      chapter: 3,
      verse: 16,
      text: "For God so loved the world",
    }],
    diskValues: new Map<string, unknown>(),
    diskPending: new Map<string, unknown>(),
    localPrefs,
    programData: null as unknown,
    reusableSlides: [] as Array<{
      id: string
      kind: "slide" | "announcement"
      title: string
      body: string
      link: string | null
      background_media_id: string | null
      revision: number
      created_at: string
      updated_at: string
    }>,
  }
})

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  ;(globalThis as { CSS?: { escape: (value: string) => string } }).CSS ??= { escape: (value: string) => value }
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
})

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "approvals_list") return state.requests
    if (command === "content_list_reusable_slides") return state.reusableSlides
    if (command === "media_list") return []
    if (command === "approvals_apply") {
      const request = state.requests.find((candidate) => candidate.id === args?.id)
      if (!request) throw new Error("Approval request not found")
      const applied = { ...request, state: "applied" }
      state.requests = state.requests.map((candidate) => candidate.id === applied.id ? applied : candidate)
      return applied
    }
    if (command === "content_replace_items") {
      const rows = args?.items as Array<Record<string, unknown>>
      const items = rows.map((row, position) => ({
        id: String(row.id),
        program_id: "service-1",
        position,
        kind: String(row.kind),
        reference: String(row.reference),
        book_number: typeof row.book_number === "number" ? row.book_number : null,
        chapter: typeof row.chapter === "number" ? row.chapter : null,
        verse: typeof row.verse === "number" ? row.verse : null,
        translation: typeof row.translation === "string" ? row.translation : null,
        secondary_translation: typeof row.secondary_translation === "string" ? row.secondary_translation : null,
        notes: typeof row.notes === "string" ? row.notes : null,
        payload: typeof row.payload === "string" ? row.payload : null,
      }))
      const savedProgram = { ...program, revision: 5, item_count: items.filter((entry) => entry.kind !== "phase" && entry.kind !== "group").length }
      state.programData = { program: savedProgram, items }
      return state.programData
    }
    if (command === "content_get_program") return state.programData
    if (command === "content_approve_program_with_designs") {
      const saved = state.programData as { program: Program; items: unknown[] }
      const approved = { ...saved.program, approved_revision: saved.program.revision, approved_at: "2026-11-02T10:00:00Z" }
      state.programData = { ...saved, program: approved }
      return approved
    }
    if (command === "content_approved_designs") return null
    if (command === "get_verse") {
      return state.verses.find((verse) => verse.translation_id === args?.translationId) ?? null
    }
    if (command.endsWith("_list")) return []
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({
  get: async (key: string) => state.diskPending.has(key) ? state.diskPending.get(key) : state.diskValues.get(key),
  set: async (key: string, value: unknown) => { state.diskPending.set(key, value) },
  save: async () => {
    for (const [key, value] of state.diskPending) state.diskValues.set(key, value)
    state.diskPending.clear()
  },
}) }))
vi.mock("@chenglou/pretext", () => ({ clearCache: vi.fn() }))
vi.mock("@chenglou/pretext/rich-inline", () => ({
  prepareRichInline: vi.fn(() => ({})),
  materializeRichInlineLineRange: vi.fn(() => []),
  measureRichInlineStats: vi.fn(() => ({ width: 0, height: 0, lines: 0 })),
  walkRichInlineLineRanges: vi.fn(),
}))

vi.mock("@/studio/present/timed-moves", () => ({ TimedMoves: () => null }))
vi.mock("@/studio/present/phase-strip", () => ({ PhaseStrip: () => null }))
vi.mock("@/studio/present/quick-find", () => ({ QuickFind: () => <input aria-label="Quick find" /> }))
vi.mock("@/studio/present/service-timer", () => ({ ServiceTimer: () => null }))
vi.mock("@/studio/present/aux-timers", () => ({ AuxTimerStatus: () => null }))
vi.mock("@/studio/present/stage-message", () => ({ StageMessage: () => null }))
vi.mock("@/studio/present/lower-third", () => ({ LowerThirdControl: () => null }))
vi.mock("@/studio/present/ticker", () => ({ TickerRow: () => null }))
vi.mock("@/studio/present/obs-chip", () => ({ ObsChip: () => null }))
vi.mock("@/studio/present/sound-chip", () => ({ SoundChip: () => null }))
vi.mock("@/studio/present/cue-menu", () => ({ CueMenu: () => null }))
vi.mock("@/studio/present/scenes-strip", () => ({ ScenesStrip: () => null }))
vi.mock("@/studio/present/live-tools-drawer", () => ({ LiveToolsDrawer: () => null }))
vi.mock("@/studio/engage/host-control", () => ({ EngageHostControl: () => null }))
vi.mock("@/studio/present/take-attempt-notice", () => ({ TakeAttemptNotice: () => null }))
vi.mock("@/studio/present/recorder-dock", () => ({ RecorderDock: () => null }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useSlideStore } from "@/stores/slide-store"
import { useJoin } from "@/stores/join-store"
import { useAddDialog } from "@/studio/prepare/add-target"
import { resetApprovalRequests, useApprovalRequestsStore, type ApprovalRequest } from "@/studio/permissions/approval-requests-store"
import { useSceneApprovalsStore } from "@/stores/scene-approvals-store"
import { Sidebar } from "@/studio/shell/sidebar"
import { churchItems } from "@/studio/shell/nav-items"
import { useShellStore, type Workspace } from "@/studio/shell-store"
import { PrepareWorkspace } from "@/studio/prepare/prepare-workspace"
import { PermissionsWorkspace } from "@/studio/permissions/permissions-workspace"
import { PresentWorkspace } from "@/studio/present/present-workspace"
import { LibraryWorkspace } from "@/studio/library/library-workspace"
import type { Program, QueueItem, Verse } from "@/types"

const verse = state.verses[0] as Verse
const item: QueueItem = { id: "moment-1", reference: "John 3:16", confidence: 1, source: "manual", added_at: 0, verse, translation: "KJV", secondary_translation: null }
const program: Program = {
  id: "service-1",
  title: "Sunday service",
  service_date: "2026-11-01",
  revision: 4,
  created_at: "2026-11-01T08:00:00Z",
  updated_at: "2026-11-01T08:30:00Z",
  item_count: 1,
  approved_revision: 4,
  approved_at: "2026-11-01T08:30:00Z",
}
const previousProgram = { reference: "Already on Program", segments: [], content: "bible" }

function WorkspaceJourney() {
  const workspace = useShellStore((store) => store.workspace)
  const isLive = useBroadcastStore((store) => store.isLive)
  const onWorkspace = (next: Workspace) => useShellStore.getState().setWorkspace(next)
  return (
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <Sidebar workspace={workspace} isLive={isLive} church={churchItems(1)} onWorkspace={onWorkspace} onSettings={() => {}} />
        <main>
          {workspace === "prepare" ? <PrepareWorkspace /> : workspace === "permissions" ? <PermissionsWorkspace /> : workspace === "present" ? <PresentWorkspace /> : workspace === "library" ? <LibraryWorkspace /> : null}
        </main>
      </TooltipProvider>
    </ThemeProvider>
  )
}

let host: HTMLDivElement
let root: Root

const navButton = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("nav button")].find((button) => button.textContent?.trim().startsWith(name))!

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never
  state.requests = [{ ...state.request }]
  state.diskValues.clear()
  state.diskPending.clear()
  state.programData = null
  state.reusableSlides = []
  state.localPrefs.clear()
  useShellStore.setState({ workspace: "prepare", sidebarCollapsed: false })
  useQueueStore.setState({ items: [item], headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }], activeIndex: null })
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null, translations: [{ id: 1, title: "King James Version", abbreviation: "KJV", language: "en", is_copyrighted: false, is_downloaded: true }], activeTranslationId: 1, secondaryTranslationId: null })
  useBroadcastStore.setState({ outputs: [], outputStatus: {}, isLive: true, liveVerse: previousProgram as never, liveSourceVerse: null, liveSlide: null, liveItemId: "previous-item", rehearsal: false, scenes: [] })
  useServiceStore.setState({ programs: [program], current: program, dirty: false, loading: false, saving: false, error: null, conflict: null, unsupportedItems: [], corruptItems: [], missingTranslations: [], approvedDesigns: null, approvedDesignRevision: 4, approvedDesignsError: null })
  useSettingsStore.setState({ operatorName: "Main desk", remoteDevices: [] })
  useSlideStore.setState({ slides: [], loading: false, error: null, query: "", pendingSourceId: null })
  useAddDialog.getState().close()
  useJoin.setState({ status: "off", me: null, live: null })
  resetApprovalRequests()
  useApprovalRequestsStore.setState({ requests: [{ ...state.request } as ApprovalRequest], hydrated: true, loading: false, error: null })
  useSceneApprovalsStore.setState({ requests: [], audit: [], hydrated: true, error: null })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.replaceChildren()
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, selectedQueueItemId: null })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null })
  useBroadcastStore.setState({ outputs: [], outputStatus: {}, liveVerse: null, liveSourceVerse: null, liveSlide: null, liveItemId: null, isLive: false })
  useServiceStore.setState({ programs: [], current: null, dirty: false, loading: false, saving: false })
  useShellStore.setState({ workspace: "home" })
  resetApprovalRequests()
})

describe("Prepare → Permissions → Live journey", () => {
  it("reviews the approved service revision, keeps Program unchanged in Preview, and changes it only on Take", async () => {
    await act(async () => root.render(<WorkspaceJourney />))
    expect(host.querySelector('[aria-label="Service rundown"]')).not.toBeNull()
    expect(host.textContent).toContain("John 3:16")

    const programBefore = useBroadcastStore.getState().liveVerse
    const moment = host.querySelector<HTMLElement>('[data-rundown-item-id="moment-1"]')!
    await act(async () => moment.querySelector<HTMLButtonElement>('button[title="Click to preview"]')!.click())
    expect(useBibleStore.getState().selectedVerse).toMatchObject({ book_number: 43, chapter: 3, verse: 16 })
    expect(useBibleStore.getState().selectedQueueItemId).toBe("moment-1")
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    await act(async () => navButton("Permissions").click())
    expect(host.textContent).toContain("Approval Requests")
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Confirm approved revision"))!.click())
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "approval-1", state: "applied" }])
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    await act(async () => navButton("Live").click())
    expect(host.querySelector("[data-studio-live]")).not.toBeNull()
    expect(host.textContent).toContain("John 3:16")
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Take John 3:16 live"]')!.click())

    expect(useBroadcastStore.getState().liveVerse).toMatchObject({ reference: "John 3:16 (KJV)", content: "bible" })
    expect(useBroadcastStore.getState().liveSourceVerse).toMatchObject({ book_number: 43, chapter: 3, verse: 16 })
    expect(useBroadcastStore.getState().liveItemId).toBe("moment-1")
  })

  it("saves and reopens a reordered mixed-content service before approval and an explicit Take", async () => {
    await act(async () => root.render(<WorkspaceJourney />))
    const programBefore = useBroadcastStore.getState().liveVerse
    const welcome: QueueItem = {
      id: "welcome-slide",
      kind: "slide",
      slide: { title: "Welcome", body: "Welcome to the service." },
      reference: "Welcome",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    act(() => {
      useQueueStore.getState().addItem(welcome, "end")
      useQueueStore.getState().reorderItems(0, 1)
    })
    expect(useQueueStore.getState().items.map((entry) => entry.id)).toEqual(["welcome-slide", "moment-1"])
    expect(useServiceStore.getState().dirty).toBe(true)

    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save")!
    await act(async () => save.click())
    expect(useServiceStore.getState()).toMatchObject({ current: { revision: 5 }, dirty: false })
    expect((state.programData as { items: Array<{ id: string; kind: string }> }).items.filter((entry) => entry.kind !== "phase").map((entry) => entry.id)).toEqual(["welcome-slide", "moment-1"])
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    await act(async () => {
      expect(useServiceStore.getState().closeProgram()).toBe("closed")
      expect(await useServiceStore.getState().openProgram("service-1")).toBe("ok")
    })
    expect(useServiceStore.getState().current).toMatchObject({ revision: 5, approved_revision: 4 })
    expect(useQueueStore.getState().items.map((entry) => entry.id)).toEqual(["welcome-slide", "moment-1"])
    expect(useQueueStore.getState().items[0]).toMatchObject({ kind: "slide", slide: { title: "Welcome", body: "Welcome to the service." } })

    const request = { ...state.request, baseRevision: 5, payload: { ...state.request.payload, revision: 5 } }
    state.requests = [request]
    await act(async () => useApprovalRequestsStore.setState({ requests: [request as ApprovalRequest], hydrated: true, loading: false, error: null }))
    const slideRow = host.querySelector<HTMLElement>('[data-rundown-item-id="welcome-slide"]')!
    await act(async () => slideRow.querySelector<HTMLButtonElement>('button[title="Click to preview"]')!.click())
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe("welcome-slide")
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    const approve = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Approve"))!
    await act(async () => approve.click())
    expect(useServiceStore.getState().current).toMatchObject({ revision: 5, approved_revision: 5 })
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    await act(async () => navButton("Permissions").click())
    expect(host.textContent).toContain("revision 5")
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Confirm approved revision"))!.click())
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "approval-1", state: "applied", payload: { revision: 5 } }])
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    await act(async () => navButton("Live").click())
    expect(host.textContent).toContain("Welcome")
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Take Welcome live"]')!.click())
    expect(useBroadcastStore.getState().liveVerse).toMatchObject({ reference: "Welcome", kind: "slide", content: "slide" })
    expect(useBroadcastStore.getState().liveItemId).toBe("welcome-slide")
  })

  it("adds from the Library to the originating Event, returns focus, and keeps Program unchanged until an explicit Take", async () => {
    const source = {
      id: "reusable-welcome",
      kind: "slide" as const,
      title: "Welcome",
      body: "Reusable welcome words",
      link: null,
      background_media_id: null,
      revision: 3,
      created_at: "2026-11-02T08:00:00Z",
      updated_at: "2026-11-02T08:00:00Z",
    }
    state.reusableSlides = [source]
    const sermonMoment: QueueItem = {
      id: "sermon-moment",
      kind: "slide",
      slide: { title: "Sermon", body: "Sermon outline" },
      reference: "Sermon",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    useQueueStore.setState({
      items: [item, sermonMoment],
      headers: [
        { id: "event-opening", type: "group", name: "Opening", at: 0, event: { schema_version: 1 } },
        { id: "event-sermon", type: "group", name: "Sermon", at: 1, event: { schema_version: 1 } },
      ],
      activeIndex: null,
      addTarget: null,
    })
    useServiceStore.setState({ programs: [program], current: program, dirty: false, loading: false, saving: false, error: null })
    useBroadcastStore.setState({ isLive: true, liveVerse: previousProgram as never, liveItemId: "previous-item", liveSlide: null })
    await act(async () => {
      root.render(<WorkspaceJourney />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const programBefore = useBroadcastStore.getState().liveVerse
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Edit event: Opening"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === "Add content to Opening")!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const addDialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const slidesTab = [...addDialog.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find((button) => button.textContent?.trim() === "Slides")!
    await act(async () => { slidesTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); slidesTab.click() })
    await act(async () => {
      await vi.waitFor(() => {
        const browseButton = [...addDialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Browse reusable slides"))
        expect(browseButton).toBeTruthy()
      })
      const browseButton = [...addDialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Browse reusable slides"))!
      browseButton.click()
      await vi.waitFor(() => expect(useShellStore.getState().workspace).toBe("library"))
    })

    expect(useShellStore.getState()).toMatchObject({
      workspace: "library",
      prepareLibraryReturn: { serviceId: "service-1", targetHeaderId: "event-opening", eventId: "event-opening", momentId: null },
    })
    await act(async () => {
      await vi.waitFor(() => {
        const welcomeButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-pressed") === "false" && button.textContent?.includes("Welcome"))
        expect(welcomeButton).toBeTruthy()
      })
    })
    const sourceButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-pressed") === "false" && button.textContent?.includes("Welcome"))!
    await act(async () => sourceButton.click())
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add to service")!.click()
      await vi.waitFor(() => expect(useShellStore.getState().workspace).toBe("prepare"))
    })

    expect(useShellStore.getState().workspace).toBe("prepare")
    const insertedQueue = useQueueStore.getState()
    expect(insertedQueue.items.map((entry) => entry.id)).toEqual(["moment-1", expect.any(String), "sermon-moment"])
    expect(insertedQueue.headers.map(({ id, at }) => [id, at])).toEqual([["event-opening", 0], ["event-sermon", 2]])
    const added = insertedQueue.items[1]!
    expect(added).toMatchObject({ kind: "slide", slide: { title: "Welcome", body: "Reusable welcome words", source_asset_id: source.id, source_revision: 3 } })
    expect(useQueueStore.getState().addTarget).toBeNull()
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Event content"]')?.getAttribute("aria-selected")).toBe("true")
    const focusedMoment = host.querySelector<HTMLElement>(`#event-content-moment-${added.id}`)!
    expect(focusedMoment.className).toContain("ring-2")
    expect(document.activeElement).toBe(focusedMoment)
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save")!
    await act(async () => {
      save.click()
      await vi.waitFor(() => expect(useServiceStore.getState()).toMatchObject({ current: { revision: 5 }, dirty: false }))
    })
    expect(useServiceStore.getState()).toMatchObject({ current: { revision: 5 }, dirty: false })
    expect((state.programData as { items: Array<{ id: string; kind: string }> }).items.filter((entry) => entry.kind !== "phase" && entry.kind !== "group").map((entry) => entry.id)).toEqual(["moment-1", added.id, "sermon-moment"])
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    await act(async () => {
      expect(useServiceStore.getState().closeProgram()).toBe("closed")
      expect(await useServiceStore.getState().openProgram("service-1")).toBe("ok")
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(useServiceStore.getState().current).toMatchObject({ revision: 5, approved_revision: 4 })
    expect(useQueueStore.getState().items.map((entry) => entry.id)).toEqual(["moment-1", added.id, "sermon-moment"])
    expect(useQueueStore.getState().headers.map(({ id, at }) => [id, at])).toEqual([["event-opening", 0], ["event-sermon", 2]])

    const request = { ...state.request, baseRevision: 5, payload: { ...state.request.payload, revision: 5 } }
    state.requests = [request]
    await act(async () => useApprovalRequestsStore.setState({ requests: [request as ApprovalRequest], hydrated: true, loading: false, error: null }))
    const slideRow = host.querySelector<HTMLElement>(`[data-rundown-item-id="${added.id}"]`)!
    await act(async () => slideRow.querySelector<HTMLButtonElement>('button[title="Click to preview"]')!.click())
    expect(useBibleStore.getState().selectedSlide?.item.id).toBe(added.id)
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    const approve = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Approve"))!
    await act(async () => {
      approve.click()
      await vi.waitFor(() => expect(useServiceStore.getState().current).toMatchObject({ revision: 5, approved_revision: 5 }))
    })
    expect(useServiceStore.getState().current).toMatchObject({ revision: 5, approved_revision: 5 })
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    await act(async () => navButton("Permissions").click())
    expect(host.textContent).toContain("revision 5")
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Confirm approved revision"))!.click()
      await vi.waitFor(() => expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "approval-1", state: "applied", payload: { revision: 5 } }]))
    })
    expect(useApprovalRequestsStore.getState().requests).toMatchObject([{ id: "approval-1", state: "applied", payload: { revision: 5 } }])
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)

    await act(async () => navButton("Live").click())
    expect(host.textContent).toContain("Welcome")
    expect(useBroadcastStore.getState().liveVerse).toBe(programBefore)
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Take Welcome live"]')!.click()
      await vi.waitFor(() => expect(useBroadcastStore.getState().liveVerse).toMatchObject({ reference: "Welcome", kind: "slide", content: "slide" }))
    })
    expect(useBroadcastStore.getState().liveVerse).toMatchObject({ reference: "Welcome", kind: "slide", content: "slide" })
    expect(useBroadcastStore.getState().liveItemId).toBe(added.id)
  })
})
