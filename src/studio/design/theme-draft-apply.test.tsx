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
import { themeDraftChanged, themeDraftStale, useBroadcastStore } from "@/stores/broadcast-store"
import { newScene, SCENE_PRESETS } from "@/lib/scenes"
import { useShellStore } from "@/studio/shell-store"
import { DesignWorkspace, ThemeDraftActions } from "./design-workspace"
import type { BroadcastTheme, Scene } from "@/types"

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

describe("built-in Apply repoints exactly what named the built-in (#830 review)", () => {
  const builtin = BUILTIN_THEMES[0]
  const other = BUILTIN_THEMES[1]
  const customId = () => useBroadcastStore.getState().themes.find((t) => t.name === `${builtin.name} (Custom)`)!.id
  const out = (id: string) => useBroadcastStore.getState().outputs.find((o) => o.id === id)!

  function sceneUsingBuiltin(name: string): Scene {
    const scene = newScene(name, SCENE_PRESETS[0])
    return { ...scene, layers: scene.layers.map((layer) => ({ ...layer, themeId: builtin.id })) }
  }

  /** main: built-in main + bible; song-only: built-in for songs only; scene: a saved scene layer; taken: a taken scene; plain: unrelated. */
  function fixture() {
    const base = useBroadcastStore.getState().outputs[0]!
    const scene = sceneUsingBuiltin("Sermon")
    useBroadcastStore.setState({
      scenes: [scene],
      outputs: [
        { ...base, id: "main", name: "Sanctuary", themeId: builtin.id, themeFor: { bible: builtin.id, song: other.id }, sceneId: undefined, sceneSnapshot: undefined, sceneAppearanceSnapshot: undefined },
        { ...base, id: "song-only", name: "Overflow", themeId: other.id, themeFor: { song: builtin.id, bible: other.id }, sceneId: undefined, sceneSnapshot: undefined, sceneAppearanceSnapshot: undefined },
        { ...base, id: "scene", name: "Lobby", themeId: other.id, themeFor: undefined, sceneId: scene.id, sceneSnapshot: undefined, sceneAppearanceSnapshot: undefined },
        { ...base, id: "taken", name: "Stream", themeId: other.id, themeFor: undefined, sceneId: scene.id, sceneSnapshot: structuredClone(scene), sceneAppearanceSnapshot: { themes: { [builtin.id]: builtin }, logoUrl: null } },
        { ...base, id: "plain", name: "Foyer", themeId: other.id, themeFor: undefined, sceneId: undefined, sceneSnapshot: undefined, sceneAppearanceSnapshot: undefined },
      ],
    })
    return scene
  }

  function applyBuiltinEdit() {
    useBroadcastStore.getState().startEditing(builtin.id)
    useBroadcastStore.getState().updateDraftNested("textBox.padding", 77)
    expect(useBroadcastStore.getState().saveDraft()).toBe(true)
  }

  it("repoints the main theme and every content slot that named the built-in", () => {
    fixture()
    applyBuiltinEdit()
    expect(out("main").themeId).toBe(customId())
    expect(out("main").themeFor).toEqual({ bible: customId(), song: other.id })
    expect(useBroadcastStore.getState().activeThemeId).toBe(customId())
  })

  it("repoints a content-only use without touching the output's main theme or other slots", () => {
    fixture()
    applyBuiltinEdit()
    expect(out("song-only").themeId).toBe(other.id)
    expect(out("song-only").themeFor).toEqual({ song: customId(), bible: other.id })
    expect(out("plain")).toMatchObject({ themeId: other.id })
    expect(out("plain").themeFor).toBeUndefined()
  })

  it("moves saved scene layers to the copy, and a taken scene keeps the built-in's look until the next Take", () => {
    const scene = fixture()
    applyBuiltinEdit()
    const saved = useBroadcastStore.getState().scenes.find((s) => s.id === scene.id)!
    expect(saved.layers.every((layer) => layer.themeId === customId())).toBe(true)
    // The taken revision is immutable; its appearance holds the old look under the copy's id too.
    expect(out("taken").sceneSnapshot!.layers.every((layer) => layer.themeId === builtin.id)).toBe(true)
    expect(out("taken").sceneAppearanceSnapshot!.themes[customId()]).toEqual(builtin)
    expect(out("taken").themeId).toBe(other.id)
  })

  it("lists in the dialog exactly the outputs Apply changes, and when", async () => {
    fixture()
    const before = useBroadcastStore.getState().outputs
    useBroadcastStore.getState().startEditing(builtin.id)
    const el = await render(<ThemeDraftActions />)
    await act(async () => useBroadcastStore.getState().updateDraftNested("textBox.padding", 77))
    await act(async () => button(el, "Apply to outputs…")!.click())
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const listed = [...dialog.querySelectorAll("li")].map((li) => li.textContent)
    expect(listed).toEqual(["Sanctuary", "Overflow", "Lobby", "Stream (after the next Take)", "Sermon"])

    await act(async () => button(document.body, "Apply to outputs")!.click())
    const after = useBroadcastStore.getState().outputs
    const changed = after.filter((o, i) => JSON.stringify(o) !== JSON.stringify(before[i])).map((o) => o.name)
    // Lobby changes through its saved scene, not its own record.
    expect(changed).toEqual(["Sanctuary", "Overflow", "Stream"])
    expect(useBroadcastStore.getState().scenes[0]!.layers[0]!.themeId).toBe(customId())
  })
})

describe("a theme draft remembers what it began from (#830 review)", () => {
  it("refuses Apply over a newer save of the theme until the operator confirms", async () => {
    useBroadcastStore.getState().startEditing(custom.id)
    useBroadcastStore.getState().updateDraft({ name: "Church look, draft" })
    useBroadcastStore.getState().saveThemeDraft()
    expect(useBroadcastStore.getState().designDrafts[0]!.base).toBeTruthy()
    // Someone saves the theme another way (Brand Kit, another desk) after the draft began.
    const newer = { ...custom, textBox: { ...custom.textBox, padding: custom.textBox.padding + 7 } }
    await act(async () => useBroadcastStore.getState().saveTheme(newer))
    // Leaving and reopening keeps the draft's base, not the newer theme's.
    useBroadcastStore.getState().setDesignerOpen(false)
    useBroadcastStore.getState().startEditing(custom.id)
    expect(themeDraftStale()).toBe(true)
    expect(useBroadcastStore.getState().saveDraft()).toBe(false)
    expect(useBroadcastStore.getState().themes.find((t) => t.id === custom.id)).toEqual(newer)

    const el = await render(<ThemeDraftActions />)
    await act(async () => button(el, "Apply to outputs…")!.click())
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("has been saved since this draft began")
    const apply = button(document.body, "Apply to outputs")!
    expect(apply.disabled).toBe(true)
    await act(async () => dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    expect(apply.disabled).toBe(false)
    await act(async () => apply.click())
    expect(useBroadcastStore.getState().themes.find((t) => t.id === custom.id)?.name).toBe("Church look, draft")
  })

  it("does not warn when nothing else saved the theme", () => {
    useBroadcastStore.getState().startEditing(custom.id)
    useBroadcastStore.getState().updateDraft({ name: "Fine" })
    expect(themeDraftStale()).toBe(false)
    expect(useBroadcastStore.getState().saveDraft()).toBe(true)
  })
})
