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
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { DEFAULT_STAGE_STYLE } from "@/lib/stage-style"
import { DEFAULT_TICKER_STYLE } from "@/lib/ticker"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"
import { resetDesignPacksForTests, useDesignPackStore } from "@/lib/design-packs"
import pack from "../../../design-packs/rhema-worship-expressions.rhema-design.json?raw"

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  document.body.replaceChildren()
  useBroadcastStore.setState({ themes: BUILTIN_THEMES, scenes: [], designDrafts: [], stageStyle: { ...DEFAULT_STAGE_STYLE }, tickerStyle: { ...DEFAULT_TICKER_STYLE }, ticker: null })
  useProductionTab.setState({ requested: null, scene: null })
  resetDesignPacksForTests()
  toasts.length = 0
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(<LookLibraryView onOpen={() => {}} />))
  return el
}
const card = (el: HTMLElement, name: string) => [...el.querySelectorAll("li")].find((li) => li.querySelector("h4")?.textContent === name) as HTMLLIElement

describe("Design → Library (#299)", () => {
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

  it("Use and edit on a camera scene adds the copy and opens it in Production → Scenes", async () => {
    const el = await render()
    const scene = card(el, "Clean · Camera and scripture")
    const edit = [...scene.querySelectorAll("button")].find((b) => b.textContent?.includes("Use and edit")) as HTMLButtonElement
    await act(async () => edit.click())
    const s = useBroadcastStore.getState()
    expect(s.scenes).toHaveLength(1)
    expect(s.scenes[0].libraryLookId).toBe("look-clean-scene-bible")
    expect(useProductionTab.getState()).toMatchObject({ requested: "programs", scene: s.scenes[0].id })
    expect(useShellStore.getState().goRequest).toBe("production")
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
    const choose = [...look.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use and edit"))!

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
    expect(resetDraft.getAttribute("aria-disabled")).not.toBe("true")
    await act(async () => resetDraft.click())
    expect(useBroadcastStore.getState().stageStyle).toEqual(stageStyle)
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([{ id: "stage:default", value: { background: "#101820", libraryLookId: "look-classic-stage" } }])
  })

  it("choosing a ticker template saves a draft without changing the running ticker", async () => {
    const tickerStyle = { ...DEFAULT_TICKER_STYLE, position: "top" as const }
    const ticker = { items: ["Sunday service"], style: tickerStyle, startedAt: 123 }
    useBroadcastStore.setState({ tickerStyle, ticker, tickerItems: ticker.items })
    const el = await render()
    const look = card(el, "Classic · Notices")
    const choose = [...look.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Use and edit"))!

    await act(async () => choose.click())

    expect(useBroadcastStore.getState().tickerStyle).toEqual(tickerStyle)
    expect(useBroadcastStore.getState().ticker).toEqual(ticker)
    expect(useBroadcastStore.getState().designDrafts).toMatchObject([
      { id: "ticker:default", kind: "ticker", value: { libraryLookId: "look-classic-ticker" } },
    ])
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
    const file = new File([pack], "rhema-worship-expressions.rhema-design.json", { type: "application/json" })
    Object.defineProperty(input, "files", { value: [file], configurable: true })
    await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })))
    await vi.waitFor(() => expect(toasts.map((t) => JSON.stringify(t))).toEqual([expect.stringContaining("Imported")]), { timeout: 15_000 })
    expect(useDesignPackStore.getState().packs).toHaveLength(1)
    // Shown on its own: the pack's family is chosen, with its name over its looks.
    await vi.waitFor(() => expect([...el.querySelectorAll("section")].map((x) => x.getAttribute("aria-label"))).toEqual(["Rhema Studio · Worship Expressions"]), { timeout: 15_000 })
    expect(el.querySelectorAll("li")).toHaveLength(120)
    const after = useBroadcastStore.getState()
    expect([after.outputs, after.scenes, after.themes, after.isLive]).toEqual([before.outputs, before.scenes, before.themes, before.isLive])

    const use = [...card(el, "Midnight Blue · Camera + Bible band").querySelectorAll("button")].find((b) => b.textContent?.includes("Use")) as HTMLButtonElement
    await act(async () => use.click())
    expect(useBroadcastStore.getState().scenes[0]?.libraryLookId).toBe("rhema-worship-expressions/midnight-camera-bible")

    const remove = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Remove pack")) as HTMLButtonElement
    await act(async () => remove.click())
    await vi.waitFor(() => expect(useDesignPackStore.getState().packs).toHaveLength(0), { timeout: 15_000 })
    // The copy stays the church's; the library shows every family again.
    expect(useBroadcastStore.getState().scenes).toHaveLength(1)
    expect(el.querySelector('section[aria-label="Church Classic"]')).not.toBeNull()
  })
})
