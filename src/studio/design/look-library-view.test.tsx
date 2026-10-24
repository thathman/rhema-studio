// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { LookLibraryView } from "./look-library-view"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  document.body.replaceChildren()
  useBroadcastStore.setState({ themes: BUILTIN_THEMES, scenes: [] })
  useProductionTab.setState({ requested: null, scene: null })
})

async function render() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  await act(async () => createRoot(el).render(<LookLibraryView onOpen={() => {}} />))
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

  it("an announcement look previews as a notice slide", async () => {
    const el = await render()
    expect(card(el, "Classic · Announcement").textContent).toContain("Full screen · Notices · Dark")
  })
})
