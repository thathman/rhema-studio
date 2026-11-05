import { beforeEach, describe, expect, it, vi } from "vitest"

let monitors: Array<{ name: string }> = []
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: async () => monitors.map((m, i) => ({ name: m.name, size: { width: 1920, height: 1080 }, scaleFactor: 1, position: { x: i * 1920, y: 0 } })),
  primaryMonitor: async () => null,
}))
const enable = vi.fn(async () => true)
const disable = vi.fn(async () => true)
vi.mock("@/lib/broadcast-output-control", () => ({ enableOutput: enable, disableOutput: disable, reconcileOutputStatus: async () => {} }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { check, useMonitorStore } = await import("@/stores/monitor-store")
const { defaultNdiSettings } = await import("@/types")

const projector = { id: "main", name: "Projector", type: "display", themeId: "t", monitorIndex: 1, monitorName: "EPSON PJ", ndi: defaultNdiSettings("main") }

describe("a projector unplugged mid-service (#411 hot-plug)", () => {
  beforeEach(() => {
    enable.mockClear(); disable.mockClear()
    useMonitorStore.setState({ count: null, names: [], sizes: [], primary: null })
    useBroadcastStore.setState({ outputs: [projector as never], outputStatus: { main: { previewOpen: true, ndiActive: false } } as never })
  })

  it("is taken off the operator's screen at once and comes back on its own screen when it returns", async () => {
    monitors = [{ name: "Built-in" }, { name: "EPSON PJ" }]
    await check()
    monitors = [{ name: "Built-in" }]
    await check()
    expect(disable).toHaveBeenCalledTimes(1)
    useBroadcastStore.setState({ outputStatus: { main: { previewOpen: false, ndiActive: false } } as never })
    // Something else plugged in: not its screen, it stays off.
    monitors = [{ name: "Built-in" }, { name: "Stage TV" }]
    await check()
    expect(enable).not.toHaveBeenCalled()
    monitors = [{ name: "Built-in" }, { name: "Stage TV" }, { name: "EPSON PJ" }]
    await check()
    expect(enable).toHaveBeenCalledTimes(1)
  })

  it("a movable window is the operator's to place: left alone", async () => {
    useBroadcastStore.setState({ outputs: [{ ...projector, windowed: true } as never] })
    monitors = [{ name: "Built-in" }, { name: "EPSON PJ" }]
    await check()
    monitors = [{ name: "Built-in" }]
    await check()
    expect(disable).not.toHaveBeenCalled()
  })
})
