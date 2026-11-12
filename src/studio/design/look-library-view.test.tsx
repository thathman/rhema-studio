// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@/lib/verse-renderer", () => ({ onThemeFontsLoaded: vi.fn(() => () => {}), renderVerse: vi.fn(), drawLowerThird: vi.fn() }))
const mockAsk = vi.hoisted(() => vi.fn(async (...args: unknown[]) => { void args; return true }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...args: unknown[]) => mockAsk(...args) }))
const toasts = vi.hoisted(() => [] as unknown[])
vi.mock("sonner", () => ({ toast: Object.assign((...a: unknown[]) => void toasts.push(a), { error: (...a: unknown[]) => void toasts.push(["error", ...a]), success: (...a: unknown[]) => void toasts.push(a) }) }))
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} })) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { LookLibraryView } from "./look-library-view"
import { DesignWorkspace } from "./design-workspace"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { DEFAULT_STAGE_STYLE } from "@/lib/stage-style"
import { DEFAULT_TICKER_STYLE } from "@/lib/ticker"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useShellStore, type DesignTab } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"
import { resetDesignPacksForTests, useDesignPackStore } from "@/lib/design-packs"
import { SceneDesignPicker } from "@/studio/prepare/scene-design-picker"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useUnsavedStore } from "@/stores/unsaved-store"
import { createBlankRhemaDesign } from "@/design-engine/design-document-utils"
import type { DesignDocument, DesignInput, DesignVersion } from "@/design-engine/design-store"
import type { QueueItem } from "@/types"
import pack from "../../../design-packs/rhema-worship-expressions.rhema-design.json?raw"

let root: Root | null = null
const defaultTakeScene = useBroadcastStore.getState().takeScene

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  document.body.replaceChildren()
  useBroadcastStore.setState({ themes: BUILTIN_THEMES, scenes: [], designDrafts: [], stageStyle: { ...DEFAULT_STAGE_STYLE }, tickerStyle: { ...DEFAULT_TICKER_STYLE }, ticker: null })
  useProductionTab.setState({ requested: null, scene: null, selected: "timekeeper", open: false, liveToolsTab: "bible" })
  useShellStore.setState({ prepareDesignReturn: null, goRequest: null })
  useQueueStore.setState({ items: [], headers: [], activeIndex: null })
  useServiceStore.setState({ current: null })
  useUnsavedStore.setState({ songEditor: null, designEditor: null })
  mockAsk.mockReset().mockResolvedValue(true)
  mockInvoke.mockReset().mockImplementation(async (command: string) => command === "design_list" ? [] : null)
  resetDesignPacksForTests()
  toasts.length = 0
})

async function render() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(<LookLibraryView onOpen={() => {}} />))
  return el
}

async function renderDesignWorkspace(tab: DesignTab = "library") {
  const el = document.createElement("div")
  document.body.appendChild(el)
  useShellStore.setState({ designTab: tab })
  root = createRoot(el)
  await act(async () => root!.render(<DesignWorkspace />))
  return el
}

async function renderScenePicker(onSceneSelected: (sceneId: string) => void) {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(<SceneDesignPicker eventId="event-1" eventTitle="Sunday service" momentId="moment-1" momentTitle="Opening Scripture" onSceneSelected={onSceneSelected} />))
  return el
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  useBroadcastStore.setState({ takeScene: defaultTakeScene })
  useShellStore.setState({ prepareDesignReturn: null, goRequest: null })
  useServiceStore.setState({ current: null })
})
const card = (el: HTMLElement, name: string) => [...el.querySelectorAll("li")].find((li) => li.querySelector("h4")?.textContent === name) as HTMLLIElement

describe("Design → Templates (#299)", () => {
  it("keeps the current Design section when an unsaved document must stay open", async () => {
    mockAsk.mockReset().mockResolvedValue(false)
    const el = await renderDesignWorkspace("library")
    useUnsavedStore.getState().setDesignEditor("First design")
    const style = el.querySelector<HTMLButtonElement>('[role="tab"]#design-group-style')!
    await act(async () => style.click())

    expect(mockAsk).toHaveBeenCalledWith("Your changes to ‘First design’ are not saved. Discard them?", expect.any(Object))
    expect(useShellStore.getState().designTab).toBe("library")
  })

  it("shows Make, Style and Where used as accessible groups, each with its own sections (#818)", async () => {
    const el = await renderDesignWorkspace()
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="Design groups"] [role="tab"]')]
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["Make", "Style", "Where used"])
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
    const sections = () => [...el.querySelectorAll<HTMLButtonElement>('nav[aria-label="Design sections"] button')]
    expect(sections().map((button) => button.textContent?.trim())).toEqual(["My Designs", "Templates", "Lower thirds", "News ticker", "Countdown", "Stage"])
    expect(sections().find((button) => button.textContent === "Templates")?.getAttribute("aria-current")).toBe("page")
    expect(el.querySelector("button[aria-label^='Design tools']")).toBeNull()

    // Arrow keys move focus between groups without opening one; Enter (a click) opens it.
    tabs[0].focus()
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })))
    expect(document.activeElement).toBe(tabs[1])
    expect(useShellStore.getState().designTab).toBe("library")
    await act(async () => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })))
    expect(document.activeElement).toBe(tabs[0])
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })))
    expect(document.activeElement).toBe(tabs[2])

    await act(async () => tabs[1].click())
    expect(useShellStore.getState().designTab).toBe("themes")
    expect(sections().map((button) => button.textContent?.trim())).toEqual(["Themes", "Brand kit"])
    await act(async () => sections()[1].click())
    expect(useShellStore.getState().designTab).toBe("brand")

    await act(async () => tabs[2].click())
    expect(useShellStore.getState().designTab).toBe("used-on")
    expect(sections().map((button) => button.textContent?.trim())).toEqual(["Outputs overview"])
    expect(el.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("design-group-where-used design-section-current")

    // Back to a group returns to the section last open in it.
    await act(async () => tabs[0].click())
    expect(useShellStore.getState().designTab).toBe("library")
    await act(async () => tabs[1].click())
    expect(useShellStore.getState().designTab).toBe("brand")
  })

  // Each section's own designer, found by something only that designer renders.
  it.each([
    ["my-designs", "Make", "My Designs", '[aria-label="My designs"]'],
    ["library", "Make", "Templates", '[aria-label="Layout"]'],
    ["lower-thirds", "Make", "Lower thirds", '[aria-label="Styles"]'],
    ["ticker", "Make", "News ticker", '[aria-label="Between items"]'],
    ["countdown", "Make", "Countdown", '[aria-label="What the countdown counts"]'],
    ["stage", "Make", "Stage", '[aria-label^="Stage display preview"]'],
    ["themes", "Style", "Themes", '[aria-label="Search themes"]'],
    ["brand", "Style", "Brand kit", '[aria-label="Logo corner"]'],
    ["used-on", "Where used", "Outputs overview", 'section[aria-labelledby="design-usage-themes"]'],
    ["outputs", "Where used", "Outputs overview", 'section[aria-labelledby="design-usage-themes"]'],
  ] as const)("opens the former %s tab in %s → %s with its own designer (#818)", async (tab, group, section, marker) => {
    const el = await renderDesignWorkspace(tab)
    const selected = el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!
    const current = el.querySelector<HTMLElement>('nav[aria-label="Design sections"] [aria-current="page"]')!
    expect(selected.textContent).toBe(group)
    expect(current.textContent).toBe(section)
    const panel = el.querySelector<HTMLElement>('[role="tabpanel"]')!
    // The panel is named by the selected group tab and the open section.
    expect(panel.getAttribute("aria-labelledby")).toBe(`${selected.id} ${current.id}`)
    expect(selected.id).toBe(`design-group-${group === "Where used" ? "where-used" : group.toLowerCase()}`)
    expect(selected.getAttribute("aria-controls")).toBe(panel.id)
    expect(el.querySelector(marker)).not.toBeNull()
    // No other section's designer is mounted alongside it.
    for (const other of ['[aria-label="My designs"]', '[aria-label="Styles"]', '[aria-label="Between items"]', '[aria-label="What the countdown counts"]', '[aria-label="Logo corner"]', '[aria-label="Search themes"]']) {
      if (other !== marker) expect(el.querySelector(other)).toBeNull()
    }
    if (section === "Outputs overview") expect(el.textContent).toContain("this overview covers every output at once")
  })

  it("wraps arrow keys and jumps with Home and End across the group tabs, without opening a group", async () => {
    const el = await renderDesignWorkspace("brand")
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const key = async (target: HTMLElement, k: string) => act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })))
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1])
    tabs[1].focus()
    await key(tabs[1], "ArrowRight")
    expect(document.activeElement).toBe(tabs[2])
    await key(tabs[2], "ArrowRight")
    expect(document.activeElement).toBe(tabs[0])
    await key(tabs[0], "ArrowLeft")
    expect(document.activeElement).toBe(tabs[2])
    await key(tabs[2], "Home")
    expect(document.activeElement).toBe(tabs[0])
    await key(tabs[0], "End")
    expect(document.activeElement).toBe(tabs[2])
    expect(useShellStore.getState().designTab).toBe("brand")
    expect(tabs[1].getAttribute("aria-selected")).toBe("true")
  })

  it("starts primary Templates from a canonical private design instead of a legacy scene", async () => {
    const createdDesign = {
      id: "design-template-copy",
      title: "Clean · Camera and scripture",
      kind: "design",
      document: {},
      revision: 1,
      latestVersion: null,
      createdAt: "2026-11-02T00:00:00Z",
      updatedAt: "2026-11-02T00:00:00Z",
    }
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "design_list") return []
      if (command === "design_create") return createdDesign
      if (command === "design_used_on" || command === "design_list_versions") return []
      return null
    })
    const before = useBroadcastStore.getState()
    const el = await renderDesignWorkspace("library")
    const stage = card(el, "Classic · Calm stage")
    expect([...stage.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent?.includes("Add a copy"))).toBe(true)
    const scene = card(el, "Clean · Camera and scripture")
    const choose = [...scene.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Add a copy"))!

    await act(async () => choose.click())

    expect(mockInvoke).toHaveBeenCalledWith("design_create", expect.objectContaining({
      input: expect.objectContaining({ kind: "design", document: expect.any(Object) }),
    }))
    expect(el.textContent).toContain("Added to My Designs")
    expect(document.activeElement).toBe(el.querySelector("#chosen-design-title"))
    expect(useBroadcastStore.getState().scenes).toEqual([])
    expect(useBroadcastStore.getState()).toMatchObject({
      outputs: before.outputs,
      liveVerse: before.liveVerse,
      isLive: before.isLive,
    })
    expect(useProductionTab.getState()).toMatchObject({ requested: null, scene: null })
    expect(useShellStore.getState().goRequest).toBeNull()
  })

  it("moves focus into the canonical editor after customizing a scene template", async () => {
    const createdDesign = {
      id: "customized-template-copy",
      title: "Clean · Camera and scripture",
      kind: "design",
      document: createBlankRhemaDesign("Clean · Camera and scripture"),
      revision: 1,
      latestVersion: null,
      createdAt: "2026-11-02T00:00:00Z",
      updatedAt: "2026-11-02T00:00:00Z",
    }
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "design_list") return []
      if (command === "design_create") return createdDesign
      if (command === "design_used_on" || command === "design_list_versions") return []
      return null
    })
    const el = await renderDesignWorkspace("library")
    const scene = card(el, "Clean · Camera and scripture")
    const customize = [...scene.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Customize a copy"))!

    await act(async () => customize.click())
    await vi.waitFor(() => expect(document.activeElement).toBe(el.querySelector<HTMLInputElement>("#design-document-title")))
  })

  it("shows the bundled Worship Expressions gallery on a clean install; Use creates a copy without taking it live", async () => {
    const el = await render()
    const section = el.querySelector<HTMLElement>('section[aria-label="Rhema Studio · Worship Expressions"]')
    expect(section).not.toBeNull()
    expect(section!.querySelectorAll("li")).toHaveLength(120)
    expect(section!.textContent).toContain("Included offline")
    expect(useDesignPackStore.getState().packs).toHaveLength(0)

    const before = useBroadcastStore.getState()
    const scene = card(el, "Midnight Blue · Camera + Bible band")
    const use = [...scene.querySelectorAll("button")].find((b) => b.textContent?.includes("Customize a copy")) as HTMLButtonElement
    await act(async () => use.click())

    const after = useBroadcastStore.getState()
    expect(after.scenes[0]?.libraryLookId).toBe("rhema-worship-expressions/midnight-camera-bible")
    expect([after.outputs, after.liveVerse, after.isLive]).toEqual([before.outputs, before.liveVerse, before.isLive])
    expect(useDesignPackStore.getState().packs).toHaveLength(0)
  })

  it("OBS overlay keeps the keyed lower thirds and tickers", async () => {
    const el = await render()
    const chip = [...el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "OBS overlay") as HTMLButtonElement
    await act(async () => chip.click())
    const names = [...el.querySelectorAll("h4")].map((h) => h.textContent)
    expect(names).toContain("Clean · Name strip")
    expect(names).toContain("Clean · News crawl")
    expect(names).not.toContain("Clean · Camera and scripture")
    expect(names).not.toContain("Classic · Announcement")
    expect(card(el, "Clean · Name strip").textContent).toContain("OBS overlay")
  })

  it("Customize a copy on a camera scene adds the copy and opens Live → Scenes", async () => {
    const el = await render()
    const scene = card(el, "Clean · Camera and scripture")
    const edit = [...scene.querySelectorAll("button")].find((b) => b.textContent?.includes("Customize a copy")) as HTMLButtonElement
    await act(async () => edit.click())
    const s = useBroadcastStore.getState()
    expect(s.scenes).toHaveLength(1)
    expect(s.scenes[0].libraryLookId).toBe("look-clean-scene-bible")
    expect(useProductionTab.getState()).toMatchObject({ requested: "programs", scene: s.scenes[0].id })
    expect(useShellStore.getState().goRequest).toBe("present")
    // The card now lists the church's copy, with Reset in its menu.
    expect(card(el, "Clean · Camera and scripture").textContent).toContain(`In your scenes: ${s.scenes[0].name}`)
    expect(card(el, "Clean · Camera and scripture").querySelector('[aria-label="More for Clean · Camera and scripture"]')).not.toBeNull()
  })

  it("choosing a stage template saves a draft without changing a connected stage", async () => {
    const stageStyle = { ...DEFAULT_STAGE_STYLE, background: "#18202a" }
    const output = { ...useBroadcastStore.getState().outputs[0], id: "stage", name: "Sanctuary stage", role: "stage" as const }
    const frame = { stage: { style: stageStyle } } as never
    useBroadcastStore.setState({ stageStyle, outputs: [output], outputFrames: frame })
    const el = await render()
    const look = card(el, "Classic · Calm stage")
    const choose = [...look.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Customize a copy"))!

    await act(async () => choose.click())

    expect(useBroadcastStore.getState().stageStyle).toEqual(stageStyle)
    expect(useBroadcastStore.getState().outputFrames).toEqual(frame)
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([
      { id: "stage:default", kind: "stage", value: { libraryLookId: "look-classic-stage" } },
    ])

    const chosenDraft = useBroadcastStore.getState().designDrafts.find((draft) => draft.id === "stage:default")
    if (!chosenDraft || chosenDraft.kind !== "stage") throw new Error("Stage template did not create the expected draft")
    await act(async () => useBroadcastStore.setState({ designDrafts: [{ ...chosenDraft, value: { ...chosenDraft.value, background: "#ffff00" } }] }))
    const more = look.querySelector<HTMLButtonElement>('[aria-label="More for Classic · Calm stage"]')!
    await act(async () => more.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
    const resetDraft = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("Your stage draft"))!
    await act(async () => resetDraft.click())
    expect(useBroadcastStore.getState().stageStyle).toEqual(stageStyle)
    expect(useBroadcastStore.getState().outputFrames).toEqual(frame)
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([{ id: "stage:default", value: { background: "#101820", libraryLookId: "look-classic-stage" } }])
  })

  it("choosing a ticker template saves a draft without changing the running ticker", async () => {
    const tickerStyle = { ...DEFAULT_TICKER_STYLE, position: "top" as const }
    const ticker = { items: ["Sunday service"], style: tickerStyle, startedAt: 123 }
    useBroadcastStore.setState({ tickerStyle, ticker, tickerItems: ticker.items })
    const el = await render()
    const look = card(el, "Classic · Notices")
    const choose = [...look.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Customize a copy"))!

    await act(async () => choose.click())

    expect(useBroadcastStore.getState().tickerStyle).toEqual(tickerStyle)
    expect(useBroadcastStore.getState().ticker).toEqual(ticker)
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([
      { id: "ticker:default", kind: "ticker", value: { libraryLookId: "look-classic-ticker" } },
    ])

    const chosenDraft = useBroadcastStore.getState().designDrafts.find((draft) => draft.id === "ticker:default")
    if (!chosenDraft || chosenDraft.kind !== "ticker") throw new Error("Ticker template did not create the expected draft")
    await act(async () => useBroadcastStore.setState({ designDrafts: [{ ...chosenDraft, value: { ...chosenDraft.value, position: "top" } }] }))
    const more = look.querySelector<HTMLButtonElement>('[aria-label="More for Classic · Notices"]')!
    await act(async () => more.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
    const resetDraft = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("Your ticker draft"))!
    await act(async () => resetDraft.click())
    expect(useBroadcastStore.getState().tickerStyle).toEqual(tickerStyle)
    expect(useBroadcastStore.getState().ticker).toEqual(ticker)
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([{ id: "ticker:default", value: { position: "bottom", libraryLookId: "look-classic-ticker" } }])
  })

  it("an announcement look previews as a notice slide", async () => {
    const el = await render()
    expect(card(el, "Classic · Announcement").textContent).toContain("Full screen · Notices · Dark")
  })

  it("Import design pack: the pack's looks join the library under its name, Use works on them, and nothing goes on air", { timeout: 60_000 }, async () => {
    const el = await render()
    const before = useBroadcastStore.getState()
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!
    // jsdom's File has no text() (WebKit's has): read it the old way.
    File.prototype.text ??= function (this: File) {
      return new Promise<string>((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.readAsText(this)
      })
    }
    const customized = JSON.stringify({ ...JSON.parse(pack), id: "local-worship-expressions" })
    const file = new File([customized], "local-worship-expressions.rhema-design.json", { type: "application/json" })
    Object.defineProperty(input, "files", { value: [file], configurable: true })
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })))
    await vi.waitFor(() => expect(toasts.map((t) => JSON.stringify(t))).toEqual([expect.stringContaining("Imported")]), { timeout: 15_000 })
    expect(useDesignPackStore.getState().packs).toHaveLength(1)
    // Shown on its own: the pack's family is chosen, with its name over its looks.
    await vi.waitFor(() => expect([...el.querySelectorAll("section")].map((x) => x.getAttribute("aria-label"))).toEqual(["Rhema Studio · Worship Expressions"]), { timeout: 15_000 })
    expect(el.querySelectorAll("li")).toHaveLength(120)
    const after = useBroadcastStore.getState()
    expect([after.outputs, after.scenes, after.themes, after.isLive]).toEqual([before.outputs, before.scenes, before.themes, before.isLive])

    const use = [...card(el, "Midnight Blue · Camera + Bible band").querySelectorAll("button")].find((b) => b.textContent?.includes("Add a copy")) as HTMLButtonElement
    await act(async () => use.click())
    expect(useBroadcastStore.getState().scenes[0]?.libraryLookId).toBe("local-worship-expressions/midnight-camera-bible")

    const remove = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Remove pack")) as HTMLButtonElement
    await act(async () => remove.click())
    await vi.waitFor(() => expect(useDesignPackStore.getState().packs).toHaveLength(0), { timeout: 15_000 })
    // The copy stays the church's; the bundled default remains available in the library.
    expect(useBroadcastStore.getState().scenes).toHaveLength(1)
    expect(el.querySelector('section[aria-label="Church Classic"]')).not.toBeNull()
    expect(el.querySelector('section[aria-label="Rhema Studio · Worship Expressions"]')).not.toBeNull()
  })

  it("searches accented scene descriptions without accents", async () => {
    const el = await render()
    const search = el.querySelector<HTMLInputElement>('input[type="search"]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    await act(async () => {
      setValue.call(search, "yoruba")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(card(el, "Aurora Teal · Scripture full")).toBeTruthy()
    expect(el.querySelectorAll("li").length).toBeLessThan(120)
  })

  it("attaches an immutable template version to the same stable event moment without changing Live", async () => {
    const moment = { id: "moment-1", kind: "slide", slide: { title: "Opening Scripture", body: "Read together" }, reference: "Opening Scripture", confidence: 1, source: "manual", added_at: 0 } as QueueItem
    useQueueStore.setState({ items: [moment], activeIndex: null })
    const takeScene = vi.fn()
    useBroadcastStore.setState({ takeScene })
    const before = useBroadcastStore.getState()
    let created: DesignDocument | null = null
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "design_create") {
        const input = args.input as DesignInput
        created = { id: "design-from-look", title: input.title, kind: "design", document: input.document, revision: 1, latestVersion: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }
        return created
      }
      if (command === "design_create_version" && created) {
        return { designId: created.id, version: 1, fromRevision: 1, title: created.title, document: created.document, note: "Started from template", savedBy: "Tolu", createdAt: new Date(1).toISOString() } satisfies DesignVersion
      }
      throw new Error(`Unexpected host command: ${command}`)
    })
    const onSceneSelected = vi.fn((sceneId: string) => useQueueStore.getState().updateItem("moment-1", (item) => ({ ...item, scene_id: sceneId })))
    const el = await renderScenePicker(onSceneSelected)
    await act(async () => (el.querySelector("button[aria-label='Choose a scene design for Opening Scripture']") as HTMLButtonElement).click())
    const scene = card(document.body, "Clean · Camera and scripture")
    const use = [...scene.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use for this moment"))!
    await act(async () => use.click())
    await vi.waitFor(() => expect(onSceneSelected).toHaveBeenCalledTimes(1))

    const after = useBroadcastStore.getState()
    const chosen = after.scenes[0]
    expect(chosen?.design).toEqual({ id: "design-from-look", version: 1 })
    expect(useQueueStore.getState().items[0]).toMatchObject({ id: "moment-1", scene_id: chosen?.id, slide: { designRef: { id: "design-from-look", version: 1 } } })
    expect(mockInvoke).toHaveBeenCalledWith("design_create_version", expect.objectContaining({ id: "design-from-look", expectedRevision: 1 }))
    expect(useQueueStore.getState().activeIndex).toBeNull()
    expect(after.outputs).toBe(before.outputs)
    expect(after.isLive).toBe(before.isLive)
    expect(after.liveItemId).toBe(before.liveItemId)
    expect(takeScene).not.toHaveBeenCalled()
    expect(useProductionTab.getState().requested).toBeNull()
  })

  it("keeps a template customization private until its version is used", async () => {
    const moment = { id: "moment-1", kind: "slide", slide: { title: "Opening Scripture", body: "Read together" }, reference: "Opening Scripture", confidence: 1, source: "manual", added_at: 0 } as QueueItem
    useQueueStore.setState({ items: [moment], activeIndex: null })
    const scenesBefore = useBroadcastStore.getState().scenes
    let created: DesignDocument | null = null
    mockInvoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "design_create") {
        const input = args.input as DesignInput
        created = { id: "design-private-copy", title: input.title, kind: "design", document: input.document, revision: 1, latestVersion: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }
        return created
      }
      if (command === "design_list") return created ? [{ id: created.id, title: created.title, kind: created.kind, revision: created.revision, latestVersion: created.latestVersion, updatedAt: created.updatedAt }] : []
      if (command === "design_get" && created && args.id === created.id) return created
      if (command === "design_list_versions") return []
      throw new Error(`Unexpected host command: ${command}`)
    })
    const el = await renderScenePicker(() => {})
    await act(async () => (el.querySelector("button[aria-label='Choose a scene design for Opening Scripture']") as HTMLButtonElement).click())
    const scene = card(document.body, "Clean · Camera and scripture")
    const customize = [...scene.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Customize a copy"))!
    await act(async () => customize.click())
    await vi.waitFor(() => expect(document.body.querySelector<HTMLInputElement>("#design-document-title")).not.toBeNull())
    expect(useBroadcastStore.getState().scenes).toEqual(scenesBefore)
    expect(useQueueStore.getState().items[0]).not.toHaveProperty("scene_id")
    expect(useQueueStore.getState().items[0]).toMatchObject({ id: "moment-1", slide: { title: "Opening Scripture" } })
    expect(useShellStore.getState().prepareDesignReturn).toBeNull()
    expect(useProductionTab.getState().requested).toBeNull()
    expect(useShellStore.getState().goRequest).toBeNull()
  })
})
