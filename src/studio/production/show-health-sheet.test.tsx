// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { ShowHealthSheet } from "./show-health-sheet"
import { PRODUCTION_TABS, openProductionTab, useProductionTab } from "./production-tab"
import { useShellStore } from "@/studio/shell-store"

/** UX audit slice 4: Show health is a side sheet over any page, not a Live tool. */
describe("Show health sheet", () => {
  it("is not a Live tool; opening it shows the sheet without changing page", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    expect(PRODUCTION_TABS.map(([id]) => id)).not.toContain("health")
    useShellStore.setState({ workspace: "home", goRequest: null })
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<ShowHealthSheet />))
    expect(document.body.textContent).not.toContain("What needs attention before and during the service")
    await act(async () => openProductionTab("health"))
    expect(useProductionTab.getState().healthOpen).toBe(true)
    expect(useShellStore.getState().goRequest).toBeNull()
    expect(document.body.textContent).toContain("What needs attention before and during the service")
    await act(async () => useProductionTab.setState({ healthOpen: false }))
    await act(async () => root.unmount())
  })
})
