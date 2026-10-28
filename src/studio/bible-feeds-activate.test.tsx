// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse, VerseRenderData } from "@/types"

const verse = (b: number, c: number, v: number): Verse => ({ id: 0, translation_id: 1, book_number: b, book_name: "Romans", book_abbreviation: "", chapter: c, verse: v, text: `text ${c}:${v}` })
const emitTo = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, a: Record<string, number>) => {
    if (cmd === "get_verse") return verse(a.bookNumber, a.chapter, a.verse)
    if (cmd === "get_chapter") return Array.from({ length: 39 }, (_, i) => verse(a.bookNumber, a.chapter, i + 1))
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: (...args: unknown[]) => emitTo(...args),
  listen: vi.fn(async (event: string, fn: (e: { payload: string }) => void) => {
    handlers.set(event, fn)
    return () => handlers.delete(event)
  }),
}))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { activateOnBibleFeeds, bibleFeedCount } from "@/lib/bible-activate"
import { buildLiveState } from "@/lib/live-state"
import { putBack, type LiveSnapshot } from "@/lib/live-recovery"
import { handleVerseDetections } from "@/hooks/use-detection-events"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { useBibleStore } from "@/stores/bible-store"
import { actingAs, autoModeOf, useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { LiveSourcesStrip } from "@/studio/present/live-sources-strip"
import { MAIN_OUTPUT_ID, defaultNdiSettings, type DetectionResult } from "@/types"

/**
 * "Activate on Bible feeds" from the main desk, Auto for the Bible feeds only, and who activated
 * each live source (#243, ADR 0001): the Bible source and the feeds that follow it change; the main
 * screens do not.
 */
const hymn: VerseRenderData = { kind: "lyric", content: "hymn", reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace"] }
const last = (label: string) => emitTo.mock.calls.filter((c) => c[0] === label).map((c) => c[2] as { verse: VerseRenderData | null }).at(-1)
const heard = (v: number): DetectionResult =>
  ({ verse_ref: `Romans 8:${v}`, book_number: 45, book_name: "Romans", chapter: 8, verse: v, verse_text: "text", confidence: 0.95, source: "direct", auto_queued: false, is_chapter_only: false }) as unknown as DetectionResult

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  emitTo.mockClear()
  const themeId = useBroadcastStore.getState().themes[0].id
  useBibleStore.setState({ selectedVerse: null, selectedSlide: null, pendingNavigation: null, books: [{ id: 45, translation_id: 1, book_number: 45, name: "Romans", abbreviation: "Rom", testament: "NT" }], activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useBroadcastStore.setState({
    isLive: false, liveVerse: null, liveSourceVerse: null, liveItem: null, liveSlide: null, liveItemId: null, heldLive: null, cleared: false, rehearsal: false, rehearsalReturn: null,
    sources: {}, scenes: [], autoLive: false, autoBibleFeeds: false,
    outputs: [
      { id: MAIN_OUTPUT_ID, name: "Projector", type: "display", themeId, monitorIndex: 0, ndi: defaultNdiSettings() },
      { id: "bible-l3", name: "Rhema Bible | Lower Third", type: "ndi", themeId, monitorIndex: 0, ndi: defaultNdiSettings("Rhema Bible | Lower Third"), shows: ["bible"] },
    ],
  })
  useSettingsStore.setState({ operatorName: "Tolu", confidenceThreshold: 0.8 })
  useServiceStore.setState({ current: null })
  useJournalStore.setState({ entries: [] })
})

describe("Activate on Bible feeds (main desk)", () => {
  it("changes the Bible source and the Bible feeds; the projector keeps the hymn", async () => {
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    expect(await activateOnBibleFeeds(verse(45, 8, 28))).toBe("presented")
    const s = useBroadcastStore.getState()
    expect(s.liveVerse).toBe(hymn)
    expect(s.isLive).toBe(true)
    expect(s.sources.bible?.value.reference).toContain("8:28")
    expect(last("broadcast-bible-l3")?.verse?.reference).toContain("8:28")
    expect(last("broadcast-main")?.verse?.reference).toBe("Amazing Grace · Verse 1")
    // It waits in the preview for Show live, and the service log has it, with who.
    expect(useBibleStore.getState().selectedVerse?.verse).toBe(28)
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Bible: Romans 8:28 (KJV) · by Tolu")
  })

  it("even with a verse on the projector: the projector keeps Romans 8:28 while the Bible feeds take 8:29", async () => {
    await activateOnBibleFeeds(verse(45, 8, 27))
    useBroadcastStore.getState().setLiveVerse({ reference: "Romans 8:28 (KJV)", segments: [{ text: "x" }], content: "bible" }, verse(45, 8, 28), { goLive: true })
    await activateOnBibleFeeds(verse(45, 8, 29))
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Romans 8:28 (KJV)")
    expect(last("broadcast-main")?.verse?.reference).toBe("Romans 8:28 (KJV)")
    expect(last("broadcast-bible-l3")?.verse?.reference).toContain("8:29")
    expect(useJournalStore.getState().entries.at(-1)?.label).toContain("Bible: Romans 8:29")
  })

  it("is offered only where an output follows Bible, on its own or through a scene's Bible box", () => {
    const [main, l3] = useBroadcastStore.getState().outputs
    expect(bibleFeedCount([main], [])).toBe(0)
    expect(bibleFeedCount([main, l3], [])).toBe(1)
    const scene = { id: "sc", name: "Camera + Bible", background: null, layers: [{ id: "l", name: "Bible", kind: "feed", shows: ["bible"] }] } as never
    expect(bibleFeedCount([{ ...main, sceneId: "sc" }], [scene])).toBe(1)
  })
})

describe("Auto: Bible feeds only", () => {
  it("a heard verse reaches the Bible source and feeds, never the main screens, recorded as Auto", async () => {
    useBroadcastStore.getState().setAutoMode("bible")
    expect(autoModeOf(useBroadcastStore.getState())).toBe("bible")
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    handleVerseDetections([heard(31)])
    await vi.waitFor(() => expect(useBroadcastStore.getState().sources.bible?.value.reference).toContain("8:31"))
    expect(useBroadcastStore.getState().liveVerse).toBe(hymn)
    expect(useBroadcastStore.getState().sources.bible?.by).toBe("Auto")
    expect(last("broadcast-main")?.verse?.reference).toBe("Amazing Grace · Verse 1")
    // Nothing on the projector either: it stays dark.
    useBroadcastStore.getState().setLive(false)
    handleVerseDetections([heard(32)])
    await vi.waitFor(() => expect(useBroadcastStore.getState().sources.bible?.value.reference).toContain("8:32"))
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("is one of three choices: Auto on turns it off, and the old switch still means Auto on/off", () => {
    const b = useBroadcastStore.getState()
    b.setAutoMode("bible")
    b.setAutoMode("auto")
    expect(useBroadcastStore.getState()).toMatchObject({ autoLive: true, autoBibleFeeds: false })
    b.setAutoMode("bible")
    b.setAutoLive(false)
    expect(autoModeOf(useBroadcastStore.getState())).toBe("manual")
  })

  it("is saved under its own key; a saved Auto on wins and older settings load as before", async () => {
    for (const [saved, expected] of [[{}, "manual"], [{ autoBibleFeeds: true }, "bible"], [{ autoLiveOptIn: true, autoBibleFeeds: true }, "auto"], [{ autoLiveOptIn: false }, "manual"]] as const) {
      vi.resetModules()
      vi.doMock("@tauri-apps/plugin-store", () => ({
        load: async () => ({ get: async (key: string) => (saved as Record<string, unknown>)[key], set: async () => {}, save: async () => {} }),
      }))
      const m = await import("@/stores/broadcast-store")
      await m.hydrateBroadcastThemes()
      expect(m.autoModeOf(m.useBroadcastStore.getState()), JSON.stringify(saved)).toBe(expected)
      vi.doUnmock("@tauri-apps/plugin-store")
    }
  })
})

describe("who activated each source", () => {
  it("records the operator here, a joined desk for its commands, and publishes both in the Live State", async () => {
    await activateOnBibleFeeds(verse(45, 8, 28))
    expect(useBroadcastStore.getState().sources.bible).toMatchObject({ by: "Tolu", on: true })
    expect(useBroadcastStore.getState().sources.bible!.activatedAt).toBeGreaterThan(0)
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    expect(useBroadcastStore.getState().sources.hymn?.by).toBe("Tolu")
    // A remote command is carried out for its sender, even though the verse loads after it returns.
    await actingAs("Femi's laptop", () => activateOnBibleFeeds(verse(45, 8, 29)))
    expect(useBroadcastStore.getState().sources.bible?.by).toBe("Femi's laptop")
    const live = buildLiveState()
    expect(live.sources.find((s) => s.id === "bible")).toMatchObject({ reference: expect.stringContaining("8:29"), by: "Femi's laptop", activatedAt: expect.any(Number) })
    expect(live.sources.find((s) => s.id === "hymn")?.by).toBe("Tolu")
  })

  it("a joined Bible desk's activation (remote:bible_activate with who sent it) is theirs", async () => {
    const el = document.createElement("div")
    const root = createRoot(el)
    function Host() {
      useRemoteControl()
      return null
    }
    await act(async () => root.render(<Host />))
    await vi.waitFor(() => expect(handlers.has("remote:verse_next")).toBe(true))
    await act(async () => handlers.get("remote:bible_activate")!({ payload: JSON.stringify({ reference: "Romans 8:30", by: "Bible desk" }) }))
    await vi.waitFor(() => expect(useBroadcastStore.getState().sources.bible?.value.reference).toContain("8:30"))
    expect(useBroadcastStore.getState().sources.bible?.by).toBe("Bible desk")
    // Next verse from the desk: the step looks the chapter up first, and is still theirs.
    await act(async () => handlers.get("remote:verse_next")!({ payload: JSON.stringify({ by: "Bible desk" }) }))
    await vi.waitFor(() => expect(useBroadcastStore.getState().sources.bible?.value.reference).toContain("8:31"))
    expect(useBroadcastStore.getState().sources.bible?.by).toBe("Bible desk")
    // Back at the main desk, Show live is the operator's again.
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    expect(useBroadcastStore.getState().sources.hymn?.by).toBe("Tolu")
    root.unmount()
  })

  it("shows in the live sources strip: Bible · Romans 8:28 · by Tolu 10:42", async () => {
    const at = new Date(2026, 9, 25, 10, 42).getTime()
    useBroadcastStore.setState({ sources: { bible: { value: { reference: "Romans 8:28", segments: [], content: "bible" }, itemId: null, revision: 1, activatedAt: at, by: "Tolu", on: true } } })
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))
    const time = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    expect(el.textContent).toContain(`by Tolu ${time}`)
    expect(el.querySelector(`[title="Bible · Romans 8:28 · by Tolu ${time}"]`)).not.toBeNull()
    root.unmount()
  })

  it("an older recovery snapshot (sources without who) still loads and shows", async () => {
    const old = { v: 1, at: Date.now(), service: null, isLive: false, liveVerse: null, liveItemId: null, outputsOn: [], scenes: {}, eventId: null,
      sources: { bible: { value: { reference: "John 3:16", segments: [], content: "bible" }, itemId: null, revision: 4, activatedAt: 1000, on: true } } } as LiveSnapshot
    await putBack(old)
    expect(useBroadcastStore.getState().sources.bible?.value.reference).toBe("John 3:16")
    expect(useBroadcastStore.getState().sources.bible?.by).toBeUndefined()
    expect(buildLiveState().sources[0]).toEqual({ id: "bible", reference: "John 3:16", on: true, revision: 4, activatedAt: 1000 })
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<LiveSourcesStrip />))
    expect(el.textContent).toContain("John 3:16")
    expect(el.textContent).not.toContain("by ")
    root.unmount()
  })
})
