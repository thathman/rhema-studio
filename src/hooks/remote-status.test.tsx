// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

const calls: Array<[string, Record<string, unknown>]> = []
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => { calls.push([cmd, args]); return null }) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { useRemoteControl } from "./use-remote-control"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useApprovalGateStore } from "@/stores/approval-gate-store"

function Host() {
  useRemoteControl()
  return null
}

describe("phone remote status (OP-006)", () => {
  it("is sent when it changes, without waiting for a timer (a hidden window slows timers)", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    const root = createRoot(document.createElement("div"))
    await act(async () => root.render(<Host />))
    const sent = () => calls.filter(([c]) => c === "update_remote_status").map(([, a]) => a)
    const before = sent().length
    act(() => useBroadcastStore.setState({ rehearsal: true }))
    expect(sent().at(-1)?.rehearsal).toBe(true)
    act(() => useApprovalGateStore.setState({ held: { id: "s", revision: 1, title: "Sunday" } }))
    expect(sent().at(-1)?.waitingForApproval).toBe(true)
    const n = sent().length
    act(() => useBroadcastStore.setState({ rehearsal: true })) // nothing new: not sent again
    expect(sent().length).toBe(n)
    expect(n).toBeGreaterThan(before)
    act(() => root.unmount())
    vi.useRealTimers()
  })
})
