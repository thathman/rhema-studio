// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { SetAsideNotices } from "./set-aside-notices"
import { useRecovery } from "@/lib/live-recovery"
import { useShellStore } from "@/studio/shell-store"

/** UX audit §5.6: what was set aside from the attention line waits in the bell. */
describe("Set aside in the notices tray", () => {
  it("shows a set-aside recovery offer and saved runs; Show again brings the line back, nothing is put on the screens", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    useRecovery.setState({ offer: null, dismissed: false, durableRuns: [], durableRunsDismissed: false })
    await act(async () => root.render(<SetAsideNotices />))
    expect(host.textContent).toBe("")

    await act(async () => useRecovery.setState({ offer: { at: Date.now() } as never, dismissed: true, durableRuns: [{ title: "Sunday" } as never], durableRunsDismissed: true }))
    expect(host.textContent).toContain("can still be put back")
    expect(host.textContent).toContain("“Sunday” has a saved checkpoint in History")

    const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!
    await act(async () => button("Show again").click())
    expect(useRecovery.getState()).toMatchObject({ dismissed: false })
    expect(useRecovery.getState().offer).not.toBeNull()
    await act(async () => button("Open History").click())
    expect(useShellStore.getState().goRequest).toBe("archive")

    useRecovery.setState({ offer: null, dismissed: false, durableRuns: [], durableRunsDismissed: false })
    await act(async () => root.unmount())
  })
})
