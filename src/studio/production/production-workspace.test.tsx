// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ProductionWorkspace } from "./production-workspace"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { openProductionTab, useProductionTab } from "./production-tab"

// Each test's page is taken down after it, so a composer left open does not answer the next test's request.
const roots: Root[] = []
const mount = (el: HTMLElement) => {
  const root = createRoot(el)
  roots.push(root)
  root.render(<ProductionWorkspace />)
}
afterEach(() => {
  act(() => { for (const r of roots.splice(0)) r.unmount() })
})

describe("Production control", () => {
  it("opens on the real timekeeper; Cameras is the camera router panel", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    expect(el.textContent).toContain("The service timer")
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Start"))).toBe(true)
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Cameras") as HTMLButtonElement
    await act(async () => tab.click())
    const panel = el.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("Camera router")
    expect(panel.textContent).toContain("Add a camera")
    expect(panel.textContent).not.toContain("Not built yet")
  })

  it("Scenes (once Programs) is the Scene Composer: a ready-made arrangement, Take, and back to the output's own feed", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useBroadcastStore.setState({ scenes: [], sceneReturn: {} })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Scenes") as HTMLButtonElement
    await act(async () => tab.click())
    const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
    await act(async () => button("Bible and lyrics").click())
    expect(el.querySelector('[aria-label="Layers, bottom first"]')?.textContent).toContain("Bible")
    await act(async () => button("Take Bible and lyrics").click())
    const s = useBroadcastStore.getState()
    expect(s.scenes.map((x) => x.name)).toEqual(["Bible and lyrics"])
    const main = s.outputs.find((o) => (o.role ?? "congregation") === "congregation")!
    expect(main.sceneId).toBe(s.scenes[0].id)
    await act(async () => button("Back to its own feed").click())
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === main.id)?.sceneId).toBeUndefined()
    expect(button("Restore Bible and lyrics")).toBeTruthy()
  })

  it("opens Scenes at the scene another page asked for (Design → Library's Use and edit)", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const scene = (id: string, name: string) => ({ id, name, background: "#000000", layers: [], createdAt: 0, updatedAt: 0 })
    useBroadcastStore.setState({ scenes: [scene("a", "First scene"), scene("b", "Clean · Camera and scripture")], sceneReturn: {} })
    openProductionTab("programs", { sceneId: "b" })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    expect((el.querySelector('[aria-label="Scene name"]') as HTMLInputElement).value).toBe("Clean · Camera and scripture")
    expect(useProductionTab.getState().scene).toBeNull()
    useProductionTab.setState({ requested: null })
  })

  it("OBS sits beside Scenes and says it is OBS's program, separate from Rhema's congregation scenes", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => mount(el))
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
    expect(tabs).not.toContain("Programs")
    expect(tabs.indexOf("OBS")).toBe(tabs.indexOf("Scenes") + 1)
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "OBS") as HTMLButtonElement
    await act(async () => tab.click())
    const panel = el.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("OBS program")
    expect(panel.textContent).toContain("separate from Rhema's congregation scenes")
    expect(panel.textContent).toContain("Open Remote control") // OBS off: where to turn it on
  })
})
