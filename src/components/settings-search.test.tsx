// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.3.2") }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { SettingsPage } from "@/components/settings-dialog"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { markSearchHits, searchSettings, searchWords, SETTINGS_SEARCH_INDEX } from "@/lib/settings-search"
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

  it("says so when nothing matches, and Esc clears the search", async () => {
    await type("zzz")
    expect(sections()).toEqual([])
    expect(host.textContent).toContain("Nothing in Settings matches")
    await press("Escape")
    expect(search().value).toBe("")
    expect(sections()).toHaveLength(9)
  })
})
