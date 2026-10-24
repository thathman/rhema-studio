// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { ProductionWorkspace } from "./production-workspace"
import { useBroadcastStore } from "@/stores/broadcast-store"

describe("Production control", () => {
  it("opens on the real timekeeper; Cameras is the camera router panel", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => createRoot(el).render(<ProductionWorkspace />))
    expect(el.textContent).toContain("The service timer")
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Start"))).toBe(true)
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Cameras") as HTMLButtonElement
    await act(async () => tab.click())
    const panel = el.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("Camera router")
    expect(panel.textContent).toContain("Add a camera")
    expect(panel.textContent).not.toContain("Not built yet")
  })

  it("Programs is the Scene Composer: a ready-made arrangement, Take, and back to the output's own feed", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useBroadcastStore.setState({ scenes: [], sceneReturn: {} })
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => createRoot(el).render(<ProductionWorkspace />))
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Programs") as HTMLButtonElement
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

  it("OBS sits beside Programs and says it is OBS's program, separate from Rhema's congregation scenes", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => createRoot(el).render(<ProductionWorkspace />))
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
    expect(tabs.indexOf("OBS")).toBe(tabs.indexOf("Programs") + 1)
    const tab = [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "OBS") as HTMLButtonElement
    await act(async () => tab.click())
    const panel = el.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toContain("OBS program")
    expect(panel.textContent).toContain("separate from Rhema's congregation scenes")
    expect(panel.textContent).toContain("Open Remote control") // OBS off: where to turn it on
  })
})
