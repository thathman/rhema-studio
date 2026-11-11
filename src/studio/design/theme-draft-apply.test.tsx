// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const emitTo = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string) => command === "design_list" ? [] : null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo }))
vi.mock("@/lib/verse-renderer", () => ({ onThemeFontsLoaded: vi.fn(() => () => {}), renderVerse: vi.fn(), drawLowerThird: vi.fn() }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} })) }))
// The theme canvas and panels are not under test; Design's draft bar and section wiring are.
vi.mock("@/components/broadcast/theme-library", () => ({ ThemeLibrary: () => <div aria-label="Theme library" /> }))
vi.mock("@/components/broadcast/design-canvas", () => ({ DesignCanvas: () => <div aria-label="Theme canvas" /> }))
vi.mock("@/components/broadcast/properties-panel", () => ({ PropertiesPanel: () => <div aria-label="Theme properties" /> }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { designDraftId } from "@/lib/design-drafts"
import { themeDraftChanged, useBroadcastStore } from "@/stores/broadcast-store"
import { useShellStore } from "@/studio/shell-store"
import { DesignWorkspace, ThemeDraftActions } from "./design-workspace"
import type { BroadcastTheme } from "@/types"

let root: Root | null = null
const custom: BroadcastTheme = { ...BUILTIN_THEMES[0], id: "church-look", name: "Church look", builtin: false }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  const main = useBroadcastStore.getState().outputs[0]!
  useBroadcastStore.setState({
    themes: [...BUILTIN_THEMES, custom],
    scenes: [],
    designDrafts: [],
    editingThemeId: null,
    draftTheme: null,
    liveDesign: false,
    outputs: [
      { ...main, id: "main", name: "Sanctuary", themeId: custom.id, sceneId: undefined },
      { ...main, id: "overflow", name: "Overflow", themeId: BUILTIN_THEMES[0].id, sceneId: undefined },
    ],
  })
  emitTo.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(node: React.ReactNode) {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(node))
  return el
}

const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)

describe("Themes use Save draft → Apply to outputs (#830 S6)", () => {
  it("saving a theme draft does not change the saved theme, the outputs or Program until Apply", async () => {
    const store = useBroadcastStore.getState()
    store.startEditing(custom.id)
    store.updateDraft({ name: "Church look, Easter" })
    expect(themeDraftChanged()).toBe(true)

    useBroadcastStore.getState().saveThemeDraft()

    const after = useBroadcastStore.getState()
    expect(after.themes.find((t) => t.id === custom.id)?.name).toBe("Church look")
    expect(after.outputs.map((o) => o.themeId)).toEqual([custom.id, BUILTIN_THEMES[0].id])
    expect(emitTo).not.toHaveBeenCalled()
    expect(after.designDrafts.map((d) => d.id)).toEqual([designDraftId("theme", custom.id)])
    // Kept, so it is not "unsaved" any more.
    expect(themeDraftChanged()).toBe(false)

    // Leaving and coming back reopens the saved draft, still without touching the theme.
    useBroadcastStore.getState().setDesignerOpen(false)
    useBroadcastStore.getState().startEditing(custom.id)
    expect(useBroadcastStore.getState().draftTheme?.name).toBe("Church look, Easter")
    expect(useBroadcastStore.getState().themes.find((t) => t.id === custom.id)?.name).toBe("Church look")

    // Apply is what changes the saved theme, and the draft is then done with.
    useBroadcastStore.getState().saveDraft()
    expect(useBroadcastStore.getState().themes.find((t) => t.id === custom.id)?.name).toBe("Church look, Easter")
    expect(useBroadcastStore.getState().designDrafts).toEqual([])
  })

  it("keeps a built-in theme draft from repointing outputs until Apply", async () => {
    const builtin = BUILTIN_THEMES[0]
    useBroadcastStore.getState().startEditing(builtin.id)
    useBroadcastStore.getState().updateDraft({ name: "Warmer" })
    useBroadcastStore.getState().saveThemeDraft()
    expect(useBroadcastStore.getState().themes.some((t) => t.name.endsWith("(Custom)"))).toBe(false)
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "overflow")?.themeId).toBe(builtin.id)
  })

  it("discarding a saved theme draft drops it and goes back to the saved theme", async () => {
    useBroadcastStore.getState().startEditing(custom.id)
    useBroadcastStore.getState().updateDraft({ name: "Throwaway" })
    useBroadcastStore.getState().saveThemeDraft()
    useBroadcastStore.getState().discardDraft()
    expect(useBroadcastStore.getState().designDrafts).toEqual([])
    expect(useBroadcastStore.getState().draftTheme?.name).toBe("Church look")
  })

  it("names the affected outputs before Apply, and only Apply changes the theme", async () => {
    useBroadcastStore.getState().startEditing(custom.id)
    const el = await render(<ThemeDraftActions />)
    expect(el.textContent).toContain("Used on: Sanctuary")
    await act(async () => useBroadcastStore.getState().updateDraft({ name: "Church look v2" }))

    await act(async () => button(el, "Save draft")!.click())
    expect(el.textContent).toContain("Saved draft · outputs unchanged")
    expect(useBroadcastStore.getState().themes.find((t) => t.id === custom.id)?.name).toBe("Church look")

    await act(async () => button(el, "Apply to outputs…")!.click())
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain("Affected outputs")
    expect(dialog.textContent).toContain("Sanctuary")
    expect(dialog.textContent).not.toContain("Overflow")
    expect(useBroadcastStore.getState().themes.find((t) => t.id === custom.id)?.name).toBe("Church look")

    await act(async () => button(document.body, "Apply to outputs")!.click())
    expect(useBroadcastStore.getState().themes.find((t) => t.id === custom.id)?.name).toBe("Church look v2")
    expect(useBroadcastStore.getState().designDrafts).toEqual([])
  })

  it("opening Themes does not start editing the first theme", async () => {
    useShellStore.setState({ designTab: "themes" })
    const el = await render(<DesignWorkspace />)
    expect(useBroadcastStore.getState().editingThemeId).toBeNull()
    expect(useBroadcastStore.getState().draftTheme).toBeNull()
    expect(el.textContent).toContain("Choose a theme on the left to edit it")
    expect(button(el, "Save theme")).toBeUndefined()
  })
})
