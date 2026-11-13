import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}), emitTo: vi.fn(async () => {}) }))

import { startAtFromDesk } from "@/hooks/use-remote-control"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceOffset } from "@/stores/service-offset-store"

describe("a Timekeeper desk's Service starts at (#196)", () => {
  it("sets the lateness from this computer's planned start, with who", () => {
    useQueueStore.setState({ items: [], headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }], activeIndex: null })
    useServiceOffset.setState({ minutes: 0, by: null })
    expect(startAtFromDesk("10:25", "Timekeeper desk")).toBeNull()
    expect(useServiceOffset.getState()).toMatchObject({ minutes: 25, by: "Timekeeper desk" })
    expect(startAtFromDesk("16:00", "Timekeeper desk")).toContain("more than 2 hours early or 4 hours late")
    expect(useServiceOffset.getState().minutes).toBe(25)
  })

  it("works during a hold before the start", async () => {
    const { useHold } = await import("@/stores/hold-store")
    useQueueStore.setState({ items: [], headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual", role: "main", starts_at: "10:00" }], activeIndex: null })
    useServiceOffset.setState({ minutes: 0, by: null })
    expect(useHold.getState().start("Waiting for the pastor")).toBeNull()
    expect(startAtFromDesk("10:15")).toBeNull()
    expect(useServiceOffset.getState().minutes).toBe(15)
    useHold.getState().resume()
  })

  it("says why when the plan has no start time", () => {
    useQueueStore.setState({ items: [], headers: [{ id: "main", type: "phase", name: "Main service", at: 0, rule: "manual" }], activeIndex: null })
    expect(startAtFromDesk("10:25")).toBe("the plan has no start time for the main service")
  })
})
