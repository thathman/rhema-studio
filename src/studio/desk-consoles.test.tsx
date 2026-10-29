// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const sent: Record<string, unknown>[] = []
const asked: Record<string, unknown>[] = []
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, a: { command?: Record<string, unknown>; asked?: Record<string, unknown> } = {}) => {
    if (cmd === "join_lookup" && a.asked) {
      asked.push(a.asked)
      if (a.asked.what === "translations") return { active: 2, translations: [{ id: 1, abbreviation: "KJV", name: "King James", language: "en" }, { id: 2, abbreviation: "YOR", name: "Bibeli Mimo", language: "yo" }] }
      if (a.asked.what === "chapter") return { verses: [16, 17, 18, 19].map((verse) => ({ book: 43, bookName: "John", chapter: 3, verse, text: `Text ${verse}` })) }
      if (a.asked.what === "search") return { verses: [{ book: 45, bookName: "Romans", chapter: 8, verse: 28, text: "all things work together for good" }] }
      return null
    }
    if (cmd !== "join_command") return null
    sent.push(a.command ?? {})
    return null
  }),
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { useJoin } from "@/stores/join-store"
import { useBibleStore } from "@/stores/bible-store"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import type { LiveStateV1 } from "@/lib/live-state"

const live: LiveStateV1 = {
  v: 1, at: 0, church: "CAC", service: null, program: { onAir: true, reference: null, rehearsal: false },
  sources: [], event: { mode: "own", currentId: null }, rundown: [], timing: null, stageMessage: "", scenes: [], outputs: [], notices: [],
  revisions: { lyrics: 7 },
  lyrics: { itemId: "i1", index: 2, title: "Amazing Grace", kind: "hymn", section: 1, sections: ["Verse 1", "Chorus", "Verse 2"] },
  heard: [{ reference: "Psalm 23:1", text: "The LORD is my shepherd", confidence: 0.92, source: "direct" }],
  outputMap: [{ id: "main", name: "Projector", kind: "display", role: "congregation", on: true, scene: "Sermon split" }, { id: "st", name: "Stage TV", kind: "browser", role: "stage", on: false, scene: null }],
  readiness: { ready: false, checks: [{ id: "obs", status: "warn", label: "OBS is not connected" }, { id: "bible", status: "ok", label: "Bible ready" }] },
  presence: [{ name: "Femi's laptop", role: "bible", connected: true, lastSeenMs: 0 }, { name: "Stage iPad", role: "stage", connected: false, lastSeenMs: null }],
}

const render = async (role: string, state: LiveStateV1 = live) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useJoin.setState({ status: "connected", me: { name: "Op", role, ...(role === "screens" ? { outputScope: ["main"] } : {}) }, live: state, error: null, paused: false, note: null })
  const el = document.createElement("div")
  await act(async () => createRoot(el).render(<OperatorsPanel />))
  return el
}
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!
const click = (b: HTMLButtonElement) => act(async () => (b.type === "submit" && b.form ? b.form.requestSubmit() : b.click()))
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const has = (el: HTMLElement, name: string) => !!el.querySelector(`[aria-label="${name}"]`)

beforeEach(() => {
  sent.length = 0
  asked.length = 0
  useBibleStore.setState({ books: [{ id: 43, translation_id: 1, book_number: 43, name: "John", abbreviation: "Jn", testament: "NT" } as never] })
})

describe("desk consoles on a joined computer (#197)", () => {
  it("a Bible desk previews a passage here in the translation it chose, then activates it in that translation", async () => {
    const el = await render("bible")
    expect(el.querySelector<HTMLSelectElement>('[aria-label="Translation"]')!.value).toBe("2")
    await type(el.querySelector<HTMLInputElement>('[aria-label="Reference or words"]')!, "John 3:16")
    await click(button(el, "Find"))
    expect(asked.at(-1)).toEqual({ what: "chapter", translation: 2, book: 43, chapter: 3 })
    const preview = el.querySelector('[aria-label="Preview on this desk"]')!
    expect(preview.textContent).toContain("Text 16")
    expect(preview.textContent).toContain("Text 18")
    expect(preview.textContent).not.toContain("Text 19")
    expect(sent).toEqual([])
    await click(button(el, "Activate John 3:16"))
    expect(sent).toEqual([{ command: "bible_activate", value: { reference: "John 3:16", translation: "YOR" }, seen: { lyrics: 7 } }])
  })

  it("a Bible desk searches the host's Bible by words and activates a heard verse in one click", async () => {
    const el = await render("bible")
    await type(el.querySelector<HTMLInputElement>('[aria-label="Reference or words"]')!, "work together")
    await click(button(el, "Find"))
    expect(asked.at(-1)).toEqual({ what: "search", query: "work together", translation: 2 })
    expect(el.querySelector('[aria-label="Verses found"]')!.textContent).toContain("Romans 8:28")
    const heard = el.querySelector('[aria-label="Heard at the host"]')!
    expect(heard.textContent).toContain("Psalm 23:1")
    expect(heard.textContent).toContain("92%")
    await click([...heard.querySelectorAll("button")].find((b) => b.textContent === "Activate")!)
    expect(sent.at(-1)).toMatchObject({ command: "bible_activate", value: { reference: "Psalm 23:1", translation: "YOR" } })
  })

  it("a worship desk steps the song on the screens section by section, with what it saw", async () => {
    const el = await render("worship")
    const steps = el.querySelector('[aria-label="Sections of the song on the screens"]')!
    expect(steps.textContent).toContain("Amazing Grace")
    expect(steps.textContent).toContain("Chorus (2 of 3)")
    await click(button(el, "Next section"))
    await click(button(el, "Previous section"))
    expect(sent).toEqual([{ command: "song_section", value: 1, seen: { lyrics: 7 } }, { command: "song_section", value: -1, seen: { lyrics: 7 } }])
    const none = await render("worship", { ...live, lyrics: null })
    expect(none.textContent).toContain("No song or hymn on the screens")
    const last = await render("worship", { ...live, lyrics: { ...live.lyrics!, section: 2 } })
    expect(button(last, "Next section").disabled).toBe(true)
  })

  it("a screens desk sees the output map, read only", async () => {
    const el = await render("screens")
    const map = el.querySelector('[aria-label="Output map"]')!
    expect(map.textContent).toContain("Projector")
    expect(map.textContent).toContain("Sermon split")
    expect(map.textContent).not.toContain("stage display")
    expect(map.querySelectorAll("button")).toHaveLength(0)
  })

  it("only the director's desks get the readiness board and the team", async () => {
    const el = await render("present")
    const board = el.querySelector('[aria-label="Director\'s board"]')!
    expect(board.textContent).toContain("1 to check")
    expect(board.textContent).toContain("OBS is not connected")
    expect(board.textContent).toContain("1 of 2 connected")
    expect(board.textContent).toContain("Femi's laptop")
    expect(board.textContent).toContain("Not connected")
    for (const role of ["bible", "worship", "stage", "screens", "timekeeper", "viewer"]) {
      expect(has(await render(role), "Director's board"), role).toBe(false)
    }
    expect(has(await render("configure"), "Director's board")).toBe(true)
  })
})
