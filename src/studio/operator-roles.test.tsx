// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { invoke } from "@tauri-apps/api/core"
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
import { useJournalStore } from "@/stores/journal-store"
import { useSettingsStore } from "@/stores/settings-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import type { LiveStateV1 } from "@/lib/live-state"

/** Delegated operators (Host/Join, ARCH-004): the Bible operator's activation rule and the desks each role gets. */
const hymn = { kind: "lyric" as const, content: "hymn" as const, reference: "Amazing Grace · Verse 1", segments: [], lines: ["Amazing grace"] }

beforeEach(() => {
  vi.mocked(invoke).mockClear()
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
    useJoin.setState({ status: "connected", me: { name: "Op", role }, live, error: null, paused: false, note: null })
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
    expect(screens.textContent).toContain("No congregation output is assigned")
    const all = await render("present")
    expect([has(all, "Event clock desk"), has(all, "Bible desk"), has(all, "Scenes desk")]).toEqual([true, true, true])
  })

  it("a paused desk says so, keeps Talk and notices, and its controls wait", async () => {
    const el = await render("bible")
    await act(async () => useJoin.setState({ paused: true }))
    expect(el.textContent).toContain("Paused by the main desk")
    const nextVerse = [...el.querySelectorAll("button")].find((b) => b.textContent === "Next verse")!
    expect(nextVerse.disabled).toBe(true)
    expect(el.querySelector('[aria-label="Talk desk"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Notices desk"]')).not.toBeNull()
    await act(async () => useJoin.setState({ paused: false }))
    expect(el.textContent).not.toContain("Paused by the main desk")
    expect([...el.querySelectorAll("button")].find((b) => b.textContent === "Next verse")!.disabled).toBe(false)
  })
})

describe("the main desk's operator list", () => {
  it("takes back control from a desk and gives it back, without unpairing it", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useJoin.setState({ status: "off", me: null, live: null, error: null, paused: false, note: null })
    useJournalStore.setState({ entries: [] })
    useSettingsStore.setState({ remoteDevices: [{ hash: "b".repeat(64), name: "Desk C", paired_at: "2026-10-23T09:00:00Z", role: "screens" }] })
    const el = document.createElement("div")
    await act(async () => createRoot(el).render(<OperatorsPanel />))
    const take = el.querySelector<HTMLButtonElement>('[aria-label="Take back control from Desk C"]')!
    await act(async () => take.click())
    expect(useSettingsStore.getState().remoteDevices[0].paused).toBe(true)
    expect(el.textContent).toContain("Paused")
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Main desk took back control from Desk C")
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Give control back to Desk C"]')!.click())
    expect(useSettingsStore.getState().remoteDevices).toHaveLength(1)
    expect(useSettingsStore.getState().remoteDevices[0].paused).toBeUndefined()
    expect(useJournalStore.getState().entries.at(-1)?.label).toBe("Main desk gave control back to Desk C")
  })
})

describe("a Screens group Take", () => {
  it("keeps single Take as the default and sends one exact request only after review", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const live: LiveStateV1 = {
      v: 1,
      at: Date.now(),
      church: "Grace Chapel",
      service: { id: "service-1", title: "Sunday" },
      program: { onAir: true, reference: "Welcome", rehearsal: false },
      sources: [],
      event: { mode: "screens", currentId: null },
      rundown: [],
      timing: null,
      stageMessage: "",
      revisions: { "scene:sermon": 4, "output:sanctuary": 8, "output:overflow": 3 },
      scenes: [{ id: "sermon", name: "Sermon", layers: [{ id: "bible", name: "Bible", kind: "feed", shows: ["bible"], box: { x: 2, y: 65, w: 96, h: 30 }, opacity: 1, visible: true }] }, { id: "welcome", name: "Welcome" }],
      outputs: [
        { id: "sanctuary", name: "Sanctuary", sceneId: "welcome", sceneName: "Welcome", impact: { language: "first", aspectRatio: "16:9", themeId: "classic-dark", themeFor: { bible: "classic-dark" }, shows: ["bible"], themeNames: { "classic-dark": "Classic Dark" }, themeRevisions: { "classic-dark": 1 } } },
        { id: "overflow", name: "Overflow", sceneId: null, impact: { language: "both", aspectRatio: "4:3", themeId: "classic-dark", themeFor: {}, shows: ["song"], themeNames: { "classic-dark": "Classic Dark" }, themeRevisions: { "classic-dark": 1 } } },
      ],
      notices: [],
    }
    useJoin.setState({ status: "connected", me: { name: "Screens desk", role: "screens", outputScope: ["sanctuary", "overflow"], groupTakeScope: ["sanctuary", "overflow"] }, live, error: null, paused: false, note: null })
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<OperatorsPanel />))

    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Edit Sermon"]')!.click())
    const sceneName = el.querySelector<HTMLInputElement>('[aria-label="Scene name"]')!
    const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
      setInputValue.call(sceneName, "Unsaved scene edit")
      sceneName.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Choose group targets"))!.click())
    await act(async () => el.querySelector<HTMLInputElement>('input[aria-label="Include Sanctuary in group Take"]')!.click())
    await act(async () => el.querySelector<HTMLInputElement>('input[aria-label="Include Overflow in group Take"]')!.click())
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Review 2 outputs"))!.click())
    expect(document.body.textContent).toContain("Review this group Take")
    await act(async () => useJoin.setState({ status: "reconnecting" }))
    await act(async () => useJoin.setState({ status: "connected" }))
    expect(el.querySelector<HTMLInputElement>('[aria-label="Scene name"]')?.value).toBe("Unsaved scene edit")
    expect(document.body.textContent).not.toContain("Review this group Take")
    expect(el.querySelector('input[aria-label="Include Sanctuary in group Take"]')).toBeNull()
    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("Choose group targets"))).toBe(true)

    expect([...el.querySelectorAll("button")].some((button) => button.textContent?.includes("Take Sermon"))).toBe(true)
    const groupToggle = [...el.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Choose group targets"))
    expect(groupToggle).toBeDefined()
    expect(groupToggle?.disabled).toBe(false)
    await act(async () => groupToggle!.click())
    await act(async () => el.querySelector<HTMLInputElement>('input[aria-label="Include Sanctuary in group Take"]')!.click())
    await act(async () => el.querySelector<HTMLInputElement>('input[aria-label="Include Overflow in group Take"]')!.click())
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "join_command")).toBe(false)
    await act(async () => [...el.querySelectorAll("button")].find((button) => button.textContent?.includes("Review 2 outputs"))!.click())

    expect(document.body.textContent).toContain("Sanctuary · Current Program: Welcome → Take: Sermon")
    expect(document.body.textContent).toContain("Overflow · Current Program: its own feed → Take: Sermon")
    expect(document.body.textContent).toContain("Language: First language · Frame: 16:9")
    expect(document.body.textContent).toContain("Looks: Default: Classic Dark · Bible: Classic Dark")
    expect(document.body.textContent).toContain("Scene feed layers follow: Bible")
    expect(document.body.textContent).toContain("Layout sketch only. Source frames and receiver status are separate.")
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "join_command")).toBe(false)
    await act(async () => [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("Take these 2 outputs"))!.click())

    const calls = vi.mocked(invoke).mock.calls.filter(([command]) => command === "join_command")
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[1]).toMatchObject({
      command: {
        command: "group_take_scene",
        value: { outputs: ["sanctuary", "overflow"], scene: "sermon" },
        id: expect.any(String),
      },
      service: "service-1",
    })
    const id = (calls[0]?.[1] as { command: { id: string } }).command.id
    await act(async () => useJoin.setState({ live: { ...live, groupTakeResults: [{ requestId: id, scene: "sermon", at: Date.now(), outputs: [
      { id: "sanctuary", name: "Sanctuary", status: "pending" },
      { id: "overflow", name: "Overflow", status: "pending" },
    ] }] } }))
    expect(el.textContent).toContain("Waiting for the host result.")
    expect(el.textContent).not.toContain("Not applied on host")
    await act(async () => useJoin.setState({ live: { ...live, groupTakeResults: [{ requestId: id, scene: "sermon", at: Date.now(), by: "Screens desk", outputs: [
      { id: "sanctuary", name: "Sanctuary", status: "host-applied" },
      { id: "overflow", name: "Overflow", status: "host-applied" },
    ] }] } }))
    expect(el.textContent).toContain("Applied on host; receiver confirmation is not available.")
    await act(async () => root.unmount())
  })
})
