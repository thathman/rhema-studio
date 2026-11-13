// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))
// The tools' own panels are not what is tested here.
vi.mock("@/studio/present/quick-find", () => ({ QuickFind: () => null }))
vi.mock("@/studio/production/production-workspace", () => ({ ProductionWorkspace: () => null }))
vi.mock("@/components/panels/transcript-panel", () => ({ TranscriptPanel: () => null }))
vi.mock("@/components/panels/detections-panel", () => ({ DetectionsPanel: () => null }))
const quickScreen = vi.fn()
const back = vi.fn()
vi.mock("@/studio/present-actions", () => ({ presentActions: { quickScreen: (s: string) => quickScreen(s), back: () => back() } }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { LiveToolsDrawer } from "@/studio/present/live-tools-drawer"
import { useBroadcastStore } from "@/stores"

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren() })

describe("Live tools keep Logo, Black and Back one press away (UX audit S1a)", () => {
  it("shows the three in the open drawer, on every tab, and they act", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    useBroadcastStore.setState({ isLive: true, heldLive: null })
    const el = document.createElement("div")
    document.body.appendChild(el)
    root = createRoot(el)
    for (const tab of ["bible", "listening", "production", "controls"] as const) {
      await act(async () => root!.render(<LiveToolsDrawer tab={tab} onTabChange={() => {}} onClose={() => {}} />))
      const group = el.querySelector('[aria-label="Always-there screens"]')!
      const names = [...group.querySelectorAll("button")].map((b) => b.textContent?.trim())
      expect(names, tab).toEqual(["Logo", "Black", "Back"])
    }
    const btn = (n: string) => [...el.querySelectorAll('[aria-label="Always-there screens"] button')].find((b) => b.textContent?.trim() === n) as HTMLButtonElement
    expect(btn("Back").disabled).toBe(true)
    await act(async () => btn("Black").click())
    expect(quickScreen).toHaveBeenCalledWith("black")
    await act(async () => useBroadcastStore.setState({ heldLive: { liveVerse: { reference: "John 3:16" } } as never }))
    expect(btn("Back").disabled).toBe(false)
    await act(async () => btn("Back").click())
    expect(back).toHaveBeenCalled()
  })
})
