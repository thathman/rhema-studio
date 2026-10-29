// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.4.0") }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SettingsPage } from "@/components/settings-dialog"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { markSearchHits, searchElsewhere, searchSettings, searchWords, SETTINGS_ELSEWHERE, SETTINGS_SEARCH_INDEX } from "@/lib/settings-search"
import { useShellStore } from "@/studio/shell-store"
import { useSettingsStore } from "@/stores/settings-store"

/** Settings search (#215): the side list filters as you type, Enter opens the first, Esc clears. */
const ALL = (Object.keys(SETTINGS_SEARCH_INDEX) as Array<keyof typeof SETTINGS_SEARCH_INDEX>).map((id) => ({ id, name: id, title: id }))

describe("searchSettings", () => {
  it("finds every section for an empty search, and a section by a label, a keyword or an old name", () => {
    expect(searchSettings("", ALL).map((h) => h.id)).toEqual(ALL.map((s) => s.id))
    expect(searchSettings("gain", ALL)).toEqual([{ id: "audio", labels: ["Input Gain"] }])
    expect(searchSettings("microphone", ALL).map((h) => h.id)).toContain("audio")
    expect(searchSettings("cloud keys", ALL).map((h) => h.id)).toEqual(["speech"])
    expect(searchSettings("  PAIRED   device ", ALL)).toEqual([{ id: "remote", labels: ["Require a key or a paired device", "Paired devices"] }])
    expect(searchSettings("nothing like this", ALL)).toEqual([])
  })

  it("ignores case and accents", () => {
    expect(searchWords("Yorùbá  Bible")).toEqual(["yoruba", "bible"])
    expect(searchSettings("Yorùbá", ALL).map((h) => h.id)).toEqual(["bible"])
  })

  it("marks short labels that hold the search, not whole paragraphs, and clears old marks", () => {
    const box = document.createElement("div")
    box.innerHTML = `<label>Input Gain</label><p>${"Amplifies the incoming audio signal before transcription, and gain ".repeat(3)}</p><span>Other</span>`
    markSearchHits(box, searchWords("gain"))
    expect([...box.querySelectorAll("[data-search-hit]")].map((e) => e.textContent)).toEqual(["Input Gain"])
    markSearchHits(box, [])
    expect(box.querySelectorAll("[data-search-hit]")).toHaveLength(0)
  })
})

describe("searchElsewhere", () => {
  it("points to the pages that hold what Settings does not (#215): church, appearance, cameras, host/join, service defaults, backups", () => {
    const where = (q: string) => searchElsewhere(q).map((e) => e.id)
    expect(where("church name")).toEqual(["church"])
    expect(where("dark mode")).toEqual(["appearance"])
    expect(where("camera router")).toEqual(["cameras"])
    expect(where("join")).toEqual(["hosting"])
    expect(where("roles")).toEqual(["hosting"])
    expect(where("approval")).toEqual(["service-defaults"])
    expect(where("backup")).toEqual(["backups"])
    expect(where("church folder")).toEqual(["backups"])
    // Each is found by its own name, and an empty search finds none of them (they are not Settings).
    for (const e of SETTINGS_ELSEWHERE) expect(where(e.name)).toContain(e.id)
    expect(searchElsewhere("")).toEqual([])
    expect(searchElsewhere("zzz")).toEqual([])
  })
})

describe("Settings page search", () => {
  let root: Root
  let host: HTMLDivElement
  const search = () => host.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
  const sections = () => [...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings sections"] button')].map((b) => b.querySelector("span span")!.textContent)
  async function type(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search(), value)
      search().dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  const press = (key: string) => act(async () => { search().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })) })

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
    useSettingsDialogStore.setState({ activeSection: "audio" })
    useSettingsStore.setState({ sttProvider: "deepgram" })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root.render(<SettingsPage />))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it("lists every section under the five headings until something is typed", () => {
    expect(sections()).toEqual(["Bible", "Outputs", "Heard verses", "Audio", "Speech Recognition", "Remote Control", "AI assistants", "Diagnostics", "Help"])
    expect(host.textContent).toContain("Display and output")
    expect(host.textContent).toContain("Data and diagnostics")
  })

  it("filters as you type, names the matching labels, opens the first on Enter and marks it in the section", async () => {
    await type("deepgram")
    expect(sections()).toEqual(["Speech Recognition"])
    expect(host.querySelector("nav")!.textContent).toContain("Cloud (Deepgram) · Deepgram API Key")
    expect(host.querySelector('[role="status"]')!.textContent).toContain("1 section matches")
    await press("Enter")
    expect(useSettingsDialogStore.getState().activeSection).toBe("speech")
    const marked = [...host.querySelectorAll('section [data-search-hit]')].map((e) => e.textContent?.trim())
    expect(marked).toEqual(expect.arrayContaining(["Cloud (Deepgram)", "Deepgram API Key"]))
  })

  it("shows what lives elsewhere as rows that go there, and Enter opens the first when no section matches", async () => {
    useShellStore.setState({ goRequest: null, designRequest: null })
    await type("camera")
    const group = host.querySelector('[role="group"][aria-label="Elsewhere in Rhema Studio"]')!
    expect(group.textContent).toContain("Cameras and the camera router")
    expect(group.textContent).toContain("Connections")
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Not in Settings")
    await press("Enter")
    expect(useShellStore.getState().goRequest).toBe("connections")

    await type("church name")
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Elsewhere in Rhema Studio"] button')!.click())
    expect(useShellStore.getState().designRequest).toBe("brand")

    const before = useShellStore.getState().deskMenuRequest
    await type("dark")
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Elsewhere in Rhema Studio"] button')!.click())
    expect(useShellStore.getState().deskMenuRequest).toBe(before + 1)

    await type("")
    expect(host.querySelector('[aria-label="Elsewhere in Rhema Studio"]')).toBeNull()
  })

  it("says so when nothing matches, and Esc clears the search", async () => {
    await type("zzz")
    expect(sections()).toEqual([])
    expect(host.textContent).toContain("Nothing in Settings matches")
    await press("Escape")
    expect(search().value).toBe("")
    expect(sections()).toHaveLength(9)
  })
})
