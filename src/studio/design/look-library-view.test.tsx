// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }))
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
import { useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"
import { resetDesignPacksForTests, useDesignPackStore } from "@/lib/design-packs"
import { SceneDesignPicker } from "@/studio/prepare/scene-design-picker"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
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

async function renderDesignWorkspace() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  useShellStore.setState({ designTab: "library" })
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
  it("labels reusable looks Templates so the content Library stays distinct", async () => {
    const el = await renderDesignWorkspace()
    const tabs = [...el.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
    const templates = tabs.find((tab) => tab.textContent?.trim() === "Templates")
    expect(templates?.getAttribute("aria-selected")).toBe("true")
    expect(tabs.some((tab) => tab.textContent?.trim() === "Library")).toBe(false)
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

  it("attaches a copied Design scene to the same stable event moment without changing Live", async () => {
    const moment = { id: "moment-1", kind: "slide", slide: { title: "Opening Scripture", body: "Read together" }, reference: "Opening Scripture", confidence: 1, source: "manual", added_at: 0 } as QueueItem
    useQueueStore.setState({ items: [moment], activeIndex: null })
    const takeScene = vi.fn()
    useBroadcastStore.setState({ takeScene })
    const before = useBroadcastStore.getState()
    const onSceneSelected = (sceneId: string) => useQueueStore.getState().updateItem("moment-1", (item) => ({ ...item, scene_id: sceneId }))
    const el = await renderScenePicker(onSceneSelected)
    await act(async () => (el.querySelector("button[aria-label='Choose a scene design for Opening Scripture']") as HTMLButtonElement).click())
    const scene = card(document.body, "Clean · Camera and scripture")
    const use = [...scene.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use for this moment"))!
    await act(async () => use.click())

    const after = useBroadcastStore.getState()
    const chosen = after.scenes[0]
    expect(chosen?.libraryLookId).toBe("look-clean-scene-bible")
    expect(useQueueStore.getState().items[0]).toMatchObject({ id: "moment-1", scene_id: chosen?.id })
    expect(useQueueStore.getState().activeIndex).toBeNull()
    expect(after.outputs).toBe(before.outputs)
    expect(after.isLive).toBe(before.isLive)
    expect(after.liveItemId).toBe(before.liveItemId)
    expect(takeScene).not.toHaveBeenCalled()
    expect(useProductionTab.getState().requested).toBeNull()
  })

  it("keeps a return path when a service scene copy is customized", async () => {
    const moment = { id: "moment-1", kind: "slide", slide: { title: "Opening Scripture", body: "Read together" }, reference: "Opening Scripture", confidence: 1, source: "manual", added_at: 0 } as QueueItem
    useQueueStore.setState({ items: [moment], activeIndex: null })
    const el = await renderScenePicker(() => {})
    await act(async () => (el.querySelector("button[aria-label='Choose a scene design for Opening Scripture']") as HTMLButtonElement).click())
    const scene = card(document.body, "Clean · Camera and scripture")
    const customize = [...scene.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Customize a copy"))!
    await act(async () => customize.click())
    const copy = useBroadcastStore.getState().scenes[0]
    expect(useShellStore.getState().prepareDesignReturn).toMatchObject({ eventId: "event-1", momentId: "moment-1", sceneId: copy.id })
    expect(useProductionTab.getState()).toMatchObject({ requested: "programs", scene: copy.id })
    expect(useShellStore.getState().goRequest).toBe("present")
  })
})
