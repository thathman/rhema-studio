// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []), convertFileSrc: (p: string) => p }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { VerseProperties } from "./text-properties"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"

// Renders the whole properties panel: slow on a busy machine (it timed out at the default 5 s).
describe("Theme Designer verse text (bilingual)", { timeout: 30_000 }, () => {
  it("renders the language tabs named after the translations, and Both writes both styles", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({ editingThemeId: theme.id, draftTheme: { ...theme, secondaryVerseText: undefined } })
    useBibleStore.setState({ translations: [{ id: 2, abbreviation: "OYCB" }, { id: 4, abbreviation: "KJV" }] as never, activeTranslationId: 2, secondaryTranslationId: 4 })
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => root.render(<VerseProperties />))
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(["Both", "First · OYCB", "Second · KJV"])
    expect(el.querySelector('[aria-label="Space between languages"]')).not.toBeNull()
    // "Both" (the default tab): typing a font size changes both languages.
    const size = el.querySelector<HTMLInputElement>('input[type="number"]')!
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    act(() => { set.call(size, "61"); size.dispatchEvent(new Event("input", { bubbles: true })) })
    const d = useBroadcastStore.getState().draftTheme!
    expect([d.verseText.fontSize, d.secondaryVerseText?.fontSize]).toEqual([61, 61])
    // Second alone: only the second language changes.
    await act(async () => (el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2]).click())
    const size2 = el.querySelector<HTMLInputElement>('input[type="number"]')!
    act(() => { set.call(size2, "40"); size2.dispatchEvent(new Event("input", { bubbles: true })) })
    const d2 = useBroadcastStore.getState().draftTheme!
    expect([d2.verseText.fontSize, d2.secondaryVerseText?.fontSize]).toEqual([61, 40])
    act(() => root.unmount())
  })
})
