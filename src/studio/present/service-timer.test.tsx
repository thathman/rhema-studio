// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { ServiceTimer, ServiceTimerControls } from "./service-timer"
import { useProductionTab } from "@/studio/production/production-tab"
import { useTimerStore } from "@/stores/timer-store"

/** UX audit slice 4: one place for the clock. The status-bar chip opens the Timer tool, which holds the controls. */
describe("Service timer", () => {
  it("the chip opens Live tools at the Timer tool, and the tool's controls start the clock", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<><ServiceTimer /><ServiceTimerControls /></>))
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label^="Service timer"]')!.click())
    expect(useProductionTab.getState()).toMatchObject({ open: true, liveToolsTab: "production", selected: "timekeeper" })
    const start = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start")!
    await act(async () => start.click())
    expect(useTimerStore.getState().timer.startedAt).not.toBeNull()
    await act(async () => useTimerStore.getState().pause())
    await act(async () => root.unmount())
  })
})
