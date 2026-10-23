// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const verse = (b: number, c: number, v: number): Verse => ({ id: 0, translation_id: 1, book_number: b, book_name: "Romans", book_abbreviation: "", chapter: c, verse: v, text: `text ${c}:${v}` })
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, a: Record<string, number>) => (cmd === "get_verse" ? verse(a.bookNumber, a.chapter, a.verse) : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { activateBibleReference } from "@/lib/bible-activate"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJoin } from "@/stores/join-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import type { LiveStateV1 } from "@/lib/live-state"

/** Delegated operators (Host/Join, ARCH-004): the Bible operator's activation rule and the desks each role gets. */
const hymn = { kind: "lyric" as const, content: "hymn" as const, reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace"] }

beforeEach(() => {
  useBibleStore.setState({ books: [{ id: 45, translation_id: 1, book_number: 45, name: "Romans", abbreviation: "Rom", testament: "NT" }], activeTranslationId: 1, secondaryTranslationId: null, overrideServiceTranslations: false, translations: [{ id: 1, abbreviation: "KJV", title: "", language: "en", is_copyrighted: false, is_downloaded: true }] })
  useBroadcastStore.setState({ isLive: false, liveVerse: null, liveItemId: null, sources: {}, rehearsal: false, rehearsalReturn: null, cleared: false, heldLive: null })
})

describe("a Bible activation from another computer", () => {
  it("shows on the main screens when they show Bible or nothing; only on Bible feeds while a hymn is up", async () => {
    expect(await activateBibleReference("Rom 8 28")).toBe("presented")
    expect(useBroadcastStore.getState().liveVerse?.reference).toContain("8:28")
    useBroadcastStore.getState().setLiveVerse(hymn, null, { goLive: true })
    await activateBibleReference("Romans 8:29")
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe("Amazing Grace · Verse 1")
    expect(useBroadcastStore.getState().sources.bible?.value.reference).toContain("8:29")
    expect(await activateBibleReference("not a reference")).toBeNull()
  })
})

describe("the desks a joined computer gets", () => {
  const live: LiveStateV1 = {
    v: 1, at: 0, church: "CAC", service: null, program: { onAir: false, reference: null, rehearsal: false }, sources: [{ id: "bible", reference: "Romans 8:28", on: true, revision: 1 }],
    event: { mode: "own", currentId: null }, rundown: [{ id: "w", reference: "Welcome", plannedMinutes: 5 }], timing: null, stageMessage: "",
    scenes: [{ id: "split", name: "Sermon split" }], outputs: [{ id: "main", name: "Projector", sceneId: null }], notices: [],
  }
  const render = async (role: string) => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useJoin.setState({ status: "connected", me: { name: "Op", role }, live, error: null })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<OperatorsPanel />))
    return el
  }
  it("each role sees only its part", async () => {
    const has = (el: HTMLElement, name: string) => !!el.querySelector(`[aria-label="${name}"]`)
    const tk = await render("timekeeper")
    expect([has(tk, "Event clock desk"), has(tk, "Bible desk"), has(tk, "Scenes desk")]).toEqual([true, false, false])
    const bible = await render("bible")
    expect([has(bible, "Event clock desk"), has(bible, "Bible desk"), has(bible, "Scenes desk")]).toEqual([false, true, false])
    expect(bible.textContent).toContain("Romans 8:28")
    const screens = await render("screens")
    expect([has(screens, "Event clock desk"), has(screens, "Bible desk"), has(screens, "Scenes desk")]).toEqual([false, false, true])
    expect(screens.textContent).toContain("Take Sermon split")
    const all = await render("present")
    expect([has(all, "Event clock desk"), has(all, "Bible desk"), has(all, "Scenes desk")]).toEqual([true, true, true])
  })
})
