// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { drawStage } = vi.hoisted(() => ({ drawStage: vi.fn() }))
vi.mock("@/lib/stage-canvas", () => ({ drawStage }))
vi.mock("@/studio/present/rundown-list", () => ({ SlideList: () => null }))
vi.mock("@/components/panels/preview-panel", () => ({ PreviewPanel: () => null }))
vi.mock("@/studio/prepare/timing-rules", () => ({ TimingRules: () => null }))
vi.mock("@/studio/prepare/item-editor-parts", () => Object.fromEntries([
  "BackgroundPicker", "CommentsEditor", "CueItemEditor", "CustomSlideEditor", "ImageItemControls", "ItemCuesEditor",
  "LookAndScene", "NoteEditor", "GoLiveCues", "PlannedMinutes", "SongApprovalNote", "TakeSteps", "TimedAdvance", "SongItemControls",
].map((name) => [name, () => null])))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ImageQueueItem, MediaAssetStatus, SongQueueItem, SongWithSections } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSongPins } from "@/stores/song-pins-store"
import { useSongStore } from "@/stores/song-store"
import { useMediaStore } from "@/stores/media-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTimerStore } from "@/stores/timer-store"
import { stageFontVh } from "@/lib/stage"
import { StagePreview } from "./item-editor"

const item: SongQueueItem = {
  id: "hymn-245",
  kind: "song",
  song: { song_id: "song-1", title: "Hymn 245", hymn: true, hymn_numbers: ["CAC 245"], arrangement_id: "concert", languages: ["yo", "en"] },
  reference: "Hymn 245",
  notes: "Start after the prayer",
  confidence: 1,
  source: "manual",
  added_at: 0,
}

const hymn = (revision: number, title: string, english: string, yoruba: string): SongWithSections => ({
  song: {
    id: "song-1", title, authors: "Author", copyright: "", ccli_number: null, licence: "public_domain", licence_note: "",
    primary_language: "en", tags: "cacghb", notes: "", key: "", tempo: null, revision, created_at: "", updated_at: "",
  },
  sections: [
    { id: "verse", kind: "verse", label: "Verse 1", texts: { en: english, yo: "Verse Yoruba" } },
    { id: "chorus", kind: "chorus", label: "Chorus", texts: { en: "Chorus English", yo: yoruba } },
  ],
  arrangements: [{ id: "concert", name: "Concert", sequence: ["verse", "chorus", "verse", "chorus"], is_default: true }],
  numbers: [{ hymnbook_id: "book-1", hymnbook_code: "CAC", number: "245" }],
})

let root: Root | null = null
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  drawStage.mockClear()
  originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext
  const selected = { ...item }
  useQueueStore.setState({ items: [selected, { ...selected, id: "next", reference: "Opening prayer" }], headers: [], activeIndex: 0 })
  useBibleStore.setState({ selectedSlide: { item: selected, index: 3 }, selectedVerse: null })
  useSongStore.setState({ songs: { "song-1": hymn(2, "New library title", "New library verse", "New library chorus") }, missing: [] })
  useSongPins.setState({ programId: "service-1", pins: { "song-1": hymn(1, "Approved hymn", "Approved verse", "Approved Yoruba chorus") }, latest: [] })
  useBroadcastStore.setState({ isLive: false, liveItemId: null, liveSlide: null, stageMessage: "" })
  useTimerStore.setState({ timer: { durationMs: 0, startedAt: null, accumulatedMs: 0 }, tick: 0 })
  useMediaStore.setState({ assets: [], loaded: true, loading: false, error: null })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  HTMLCanvasElement.prototype.getContext = originalGetContext
  document.body.replaceChildren()
})

const lastPayload = () => drawStage.mock.calls.at(-1)?.[3] as { current: { title: string; lines: string[] } | null; next: string | null; note: string | null }

describe("Prepare confidence preview (#389)", () => {
  it("uses the approved song, selected repeated bilingual chorus, note, and next item", async () => {
    await act(async () => root!.render(<StagePreview item={item} index={0} />))

    expect(lastPayload()).toMatchObject({
      current: { title: "CAC 245 · Approved hymn · Chorus", lines: ["Approved Yoruba chorus", "Chorus English"] },
      next: "Opening prayer",
      note: "Start after the prayer",
    })
    expect(lastPayload()).toMatchObject({ timer: null, message: null })
  })

  it("shows the currently selected section from the service arrangement", async () => {
    useBibleStore.setState({ selectedSlide: { item, index: 0 } })
    await act(async () => root!.render(<StagePreview item={item} index={0} />))

    expect(lastPayload().current).toMatchObject({ title: "CAC 245 · Approved hymn · Verse 1", lines: ["Verse Yoruba", "Approved verse"] })
  })

  it("uses the song snapshot and slide that are already on air", async () => {
    const liveSong = hymn(3, "Live snapshot", "Live snapshot verse", "Live snapshot chorus")
    useBibleStore.setState({ selectedSlide: { item, index: 0 } })
    useBroadcastStore.setState({
      isLive: true,
      liveItemId: item.id,
      liveSlide: { itemId: item.id, songId: "song-1", index: 1, total: 4, arrangementId: "concert", languages: ["en"], song: liveSong },
    })
    await act(async () => root!.render(<StagePreview item={item} index={0} />))

    expect(lastPayload().current).toMatchObject({ title: "CAC 245 · Live snapshot · Chorus", lines: ["Chorus English"] })
  })

  it("includes the actual timer and operator message only for the live item", async () => {
    useBroadcastStore.setState({ isLive: true, liveItemId: item.id, stageMessage: "Wrap up" })
    useTimerStore.setState({ timer: { durationMs: 600_000, startedAt: null, accumulatedMs: 120_000 }, tick: 0 })
    await act(async () => root!.render(<StagePreview item={item} index={0} />))

    expect(lastPayload()).toMatchObject({ timer: { label: "8:00", tone: "ok" }, message: "Wrap up" })
  })

  it("keeps the complete long bilingual lyric lines for the stage renderer to wrap", async () => {
    const longEnglish = Array.from({ length: 12 }, (_, n) => `A long English lyric line ${n + 1}`).join("\n")
    const longSong = hymn(1, "Hymn", longEnglish, "Long Yoruba chorus")
    useSongPins.setState({ pins: { "song-1": longSong } })
    useBibleStore.setState({ selectedSlide: { item, index: 0 } })
    await act(async () => root!.render(<StagePreview item={item} index={0} />))

    expect(lastPayload().current?.lines).toHaveLength(13)
    expect(lastPayload().current?.lines[0]).toBe("Verse Yoruba")
    expect(lastPayload().current?.lines[1]).toBe("A long English lyric line 1")
    expect(stageFontVh(lastPayload().current?.lines ?? [])).toBeLessThan(9)
  })

  it("shows a clear offline warning instead of invented words when the chosen language is absent", async () => {
    useQueueStore.setState({ items: [{ ...item, song: { ...item.song, languages: ["fr"] } }] })
    useBibleStore.setState({ selectedSlide: null })
    useSongPins.setState({ programId: null, pins: {}, latest: [] })
    useSongStore.setState({ songs: { "song-1": hymn(1, "Hymn", "English only", "Yoruba only") }, missing: [] })
    await act(async () => root!.render(<StagePreview item={{ ...item, song: { ...item.song, languages: ["fr"] } }} index={0} />))

    expect(lastPayload().current).toBeNull()
    expect(document.body.textContent).toContain("No FR lyrics are available for this song.")
  })

  it("identifies a song missing from this offline library without fabricating a lyric", async () => {
    useSongStore.setState({ songs: {}, missing: ["song-1"] })
    useSongPins.setState({ pins: {} })
    await act(async () => root!.render(<StagePreview item={item} index={0} />))

    expect(lastPayload().current).toBeNull()
    expect(document.body.textContent).toContain("This song isn't available on this computer, so its words can't be previewed.")
  })

  it("names an unavailable local audio file instead of implying it has stage lyrics", async () => {
    const audio: ImageQueueItem = {
      id: "audio-1", kind: "image", image: { media_id: "media-audio-1", name: "Opening track", fit: "contain" },
      reference: "Opening track", confidence: 1, source: "manual", added_at: 0,
    }
    const missingAsset: MediaAssetStatus = {
      id: "media-audio-1", kind: "audio", name: "Opening track", file: "opening.mp3", hash: "hash", size: 10,
      mime: "audio/mpeg", width: null, height: null, duration_ms: 1000, source: "import", source_ref: "",
      original_path: "opening.mp3", created_at: "", path: "", present: false,
    }
    useMediaStore.setState({ assets: [missingAsset] })
    await act(async () => root!.render(<StagePreview item={audio} index={0} />))

    expect(document.body.textContent).toContain("Audio file “Opening track” is missing from this computer's media library.")
  })
})
