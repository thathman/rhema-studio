// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { ProductionWorkspace } from "./production-workspace"

describe("Production control", () => {
  it("opens on the real timekeeper; planned parts say so and offer no controls", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const el = document.createElement("div")
    document.body.appendChild(el)
    await act(async () => createRoot(el).render(<ProductionWorkspace />))
    expect(el.textContent).toContain("The service timer")
    expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Start"))).toBe(true)
    const tab = (name: string) => [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLButtonElement
    for (const name of ["Programs", "Cameras", "Operators"]) {
      await act(async () => tab(name).click())
      const panel = el.querySelector('[role="tabpanel"]')!
      expect(panel.textContent).toContain("Not built yet")
      expect(panel.querySelectorAll("button, input, select").length).toBe(0)
    }
  })
})
