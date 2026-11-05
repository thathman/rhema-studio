// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// Before the modules below load (one measures text with a ResizeObserver as it is imported).
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
vi.mock("@/lib/cac-hymnbook", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cac-hymnbook")>()
  return { ...actual, listCacHymns: vi.fn(async () => [{ id: "h1", title: "Ọlọ́run Ọba", authors: "", licence: "public_domain", primary_language: "yo", languages: ["yo", "en"], numbers: ["CAC 12"], first_line: "", revision: 1, updated_at: "" }]) }
})
import { MediaLibrary } from "@/studio/prepare/media-library"
import { HymnBook } from "@/studio/prepare/hymn-book"
import { SongLibrary } from "@/studio/prepare/song-library"
import { LibraryPreviewPane } from "./library-preview-pane"
import { useLibraryPreview } from "@/stores/library-preview-store"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMediaStore } from "@/stores/media-store"
import { useSongStore } from "@/stores/song-store"
import { useQueueStore } from "@/stores/queue-store"
import { useShellStore } from "@/studio/shell-store"
import { useApprovalGateStore } from "@/stores/approval-gate-store"
import type { MediaAssetStatus, SongSummary } from "@/types/content"

/**
 * #447, owner decision 5 Nov 2026: browsing Library never alters Live Preview or Program, the
 * running order, a Prepare return, a held approval or an unsaved Design draft. Only Add to service
 * and Send to Live Preview act, and neither puts anything on air.
 */
let element: HTMLDivElement
let root: Root

const picture = { id: "p1", kind: "image", name: "Welcome.png", file: "p1.png", hash: "p1", size: 1, mime: "image/png", width: 1920, height: 1080, duration_ms: null, source: "import", source_ref: "", path: "/m/p1", present: true } as MediaAssetStatus
const song = { id: "s1", title: "Amazing Grace", authors: "", licence: "public_domain", primary_language: "en", languages: ["en", "yo"], numbers: ["SSS 245"], first_line: "Amazing grace, how sweet", revision: 1, updated_at: "" } as unknown as SongSummary

const live = () => {
  const b = useBroadcastStore.getState()
  const bible = useBibleStore.getState()
  const shell = useShellStore.getState()
  return {
    isLive: b.isLive, liveVerse: b.liveVerse, liveItemId: b.liveItemId, outputs: b.outputs, draftTheme: b.draftTheme,
    selectedSlide: bible.selectedSlide, selectedVerse: bible.selectedVerse, selectedQueueItemId: bible.selectedQueueItemId,
    items: useQueueStore.getState().items, activeIndex: useQueueStore.getState().activeIndex,
    prepareLibraryReturn: shell.prepareLibraryReturn, held: useApprovalGateStore.getState().held,
  }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  useLibraryPreview.getState().clear()
  useMediaStore.setState({ assets: [picture], urls: {}, loaded: true, loading: false, error: null, list: vi.fn(async () => [picture]), dataUrl: vi.fn(async () => null) } as never)
  useSongStore.setState({ results: [song], searching: false, query: "", search: vi.fn(async () => [song]), all: vi.fn(async () => [song]) } as never)
  // Something on air, a Preview the operator chose, a Prepare return, a held approval and an unsaved draft.
  useBroadcastStore.setState({ isLive: true, liveVerse: { reference: "Psalm 23", segments: [{ text: "The Lord is my shepherd" }] }, liveItemId: "q1", draftTheme: { ...useBroadcastStore.getState().themes[0]!, name: "Unsaved draft" } })
  useBibleStore.setState({ selectedSlide: null, selectedVerse: null, selectedQueueItemId: "q1" })
  useQueueStore.setState({ items: [], activeIndex: null })
  useShellStore.setState({ prepareLibraryReturn: { serviceId: "svc", eventId: "e1", eventTitle: "Worship", momentId: null, momentTitle: null, targetHeaderId: "e1" } as never })
  useApprovalGateStore.setState({ held: { id: "svc", revision: 3, title: "Sunday" }, retry: null })
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, draftTheme: null })
  useShellStore.setState({ prepareLibraryReturn: null })
  useApprovalGateStore.setState({ held: null, retry: null })
})

describe("Library browsing is isolated from Live (#447)", () => {
  it("clicking a picture shows it in Library's preview and changes nothing else", async () => {
    const before = live()
    await act(async () => root.render(<MediaLibrary kinds="visual" privatePreview />))
    act(() => element.querySelector<HTMLButtonElement>('button[aria-label="Preview Welcome.png"]')!.click())
    expect(useLibraryPreview.getState().inspected).toMatchObject({ title: "Welcome.png", mediaId: "p1", detail: "Picture · 1920×1080" })
    expect(live()).toEqual(before)
  })

  it("clicking a song shows it in Library's preview and changes nothing else", async () => {
    const before = live()
    await act(async () => root.render(<SongLibrary layout="cards" privatePreview />))
    act(() => element.querySelector<HTMLButtonElement>('button[title="Click to preview"]')!.click())
    expect(useLibraryPreview.getState().inspected).toMatchObject({ title: "Amazing Grace", detail: "Hymn SSS 245 · EN / YO · Amazing grace, how sweet" })
    expect(live()).toEqual(before)
  })

  it("choosing a hymn shows it in its own detail pane and changes nothing else", async () => {
    const before = live()
    await act(async () => root.render(<HymnBook privatePreview />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const hymn = [...element.querySelectorAll<HTMLButtonElement>('[aria-label="Hymns"] button')].find((b) => b.textContent?.includes("12"))!
    expect(hymn).toBeTruthy()
    await act(async () => hymn.click())
    expect(live()).toEqual(before)
  })

  it("outside Library (Prepare's Add picker) a click previews as before", async () => {
    await act(async () => root.render(<MediaLibrary kinds="visual" />))
    act(() => element.querySelector<HTMLButtonElement>('button[aria-label="Preview Welcome.png"]')!.click())
    expect(useBibleStore.getState().selectedSlide?.item).toMatchObject({ kind: "image" })
    expect(useLibraryPreview.getState().inspected).toBeNull()
  })

  it("only the deliberate buttons act: Add to service, and Send to Live Preview (still no Take)", async () => {
    const onAdd = vi.fn()
    await act(async () => root.render(<><MediaLibrary kinds="visual" privatePreview /><LibraryPreviewPane onAdd={onAdd} /></>))
    act(() => element.querySelector<HTMLButtonElement>('button[aria-label="Preview Welcome.png"]')!.click())
    const pane = element.querySelector('[aria-label="Library preview"]')!
    expect(pane.textContent).toContain("Library preview · not on Live")
    const button = (text: string) => [...pane.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!

    act(() => button("Add to service").click())
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: "image" }))

    const program = useBroadcastStore.getState().liveVerse
    act(() => button("Send to Live Preview").click())
    expect(useBibleStore.getState().selectedSlide?.item).toMatchObject({ kind: "image" })
    // Preview only: Program, the held approval and the running order are as they were.
    expect(useBroadcastStore.getState()).toMatchObject({ isLive: true, liveVerse: program, liveItemId: "q1" })
    expect(useApprovalGateStore.getState().held).toMatchObject({ id: "svc" })

    act(() => element.querySelector<HTMLButtonElement>('[aria-label="Close Library preview"]')!.click())
    expect(useLibraryPreview.getState().inspected).toBeNull()
  })
})
