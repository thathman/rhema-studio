// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { ProductionWorkspace } from "./production-workspace"
import { useBroadcastStore } from "@/stores/broadcast-store"

describe("Production control", () => {
  it("opens on the real timekeeper; the planned parts (cameras, operators) say so and offer no controls", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => createRoot(el).render(<ProductionWorkspace />))
    expect(el.textContent).toContain("The service timer")
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Start"))).toBe(true)
    const tab = (name: string) => [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLButtonElement
    for (const name of ["Cameras", "Operators"]) {
      await act(async () => tab(name).click())
      const panel = el.querySelector('[role="tabpanel"]')!
      expect(panel.textContent).toContain("Not built yet")
      expect(panel.querySelectorAll("button, input, select").length).toBe(0)
    }
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
})
