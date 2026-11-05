// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

const handlers = new Map<string, (e: { payload: string }) => void>()
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (event: string, fn: (e: { payload: string }) => void) => {
    handlers.set(event, fn)
    return () => handlers.delete(event)
  }),
}))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { warning: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { REMOTE_EVENTS } from "@/lib/remote-events"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useHold } from "@/stores/hold-store"

/** #411: a joined desk's Hold or Resume the host refuses is not silent: the main desk is told who asked and why. */
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  toast.warning.mockClear()
  useHold.setState({ hold: null, past: [] })
  useBroadcastStore.setState({ rehearsal: true })
})

describe("a desk's refused Hold reaches the main desk (#411)", () => {
  it("says the hold was not made, by whom and why", async () => {
    const root = createRoot(document.createElement("div"))
    function Host() {
      useRemoteControl()
      return null
    }
    await act(async () => root.render(createElement(Host)))
    await vi.waitFor(() => expect(handlers.has(REMOTE_EVENTS.hold)).toBe(true))
    await act(async () => handlers.get(REMOTE_EVENTS.hold)!({ payload: JSON.stringify({ reason: "Waiting for pastor", by: "Timekeeper" }) }))
    expect(useHold.getState().hold).toBeNull()
    expect(toast.warning).toHaveBeenCalledWith("Hold not made", { description: expect.stringContaining("Timekeeper: Not in rehearsal") })
    // A second Hold while already held is done as asked: no warning.
    useBroadcastStore.setState({ rehearsal: false })
    useHold.getState().start("Waiting")
    toast.warning.mockClear()
    await act(async () => handlers.get(REMOTE_EVENTS.hold)!({ payload: JSON.stringify({ reason: "Again", by: "Phone" }) }))
    expect(toast.warning).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})
