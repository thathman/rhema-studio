import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: { cmd: string; args: Record<string, unknown> }[] = []
const monitors = vi.hoisted(() => ({ list: [] as { name: string | null }[] }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => { calls.push({ cmd, args }); return null }) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn(async () => monitors.list),
  getAllWindows: vi.fn(async () => [{ label: "broadcast-congregation", isVisible: async () => true }]),
}))
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn(async () => {}), error: vi.fn(async () => {}) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { enableOutput } = await import("@/lib/broadcast-output-control")
const { defaultNdiSettings } = await import("@/types")
type Output = Parameters<typeof enableOutput>[0]

/**
 * #411: a display output whose screen is not connected never opens on whatever screen took its
 * number. Here the projector (EPSON) was off at start-up, so the stage TV (DELL) became screen 2.
 */
const congregation = (over: Partial<Output> = {}): Output => ({
  id: "congregation", name: "Congregation", type: "display", themeId: useBroadcastStore.getState().themes[0].id,
  monitorIndex: 1, monitorName: "EPSON", ndi: defaultNdiSettings(), ...over,
}) as Output

beforeEach(() => {
  calls.length = 0
  useBroadcastStore.setState({ outputs: [congregation()] })
})

describe("a display output opens only on its own screen (#411)", () => {
  it("refuses when its named screen is not connected, rather than covering the stage TV", async () => {
    monitors.list = [{ name: "Built-in" }, { name: "DELL" }]
    expect(await enableOutput(congregation())).toBe(false)
    expect(calls.some((c) => c.cmd === "open_broadcast_window")).toBe(false)
  })

  it("a movable window still opens with its screen missing (rehearsing without the projector)", async () => {
    monitors.list = [{ name: "Built-in" }, { name: "DELL" }]
    await enableOutput(congregation({ windowed: true }))
    expect(calls.find((c) => c.cmd === "open_broadcast_window")?.args.monitorIndex).toBe(1)
  })

  it("follows its named screen to its new number", async () => {
    monitors.list = [{ name: "Built-in" }, { name: "DELL" }, { name: "EPSON" }]
    await enableOutput(congregation())
    expect(calls.find((c) => c.cmd === "open_broadcast_window")?.args.monitorIndex).toBe(2)
  })
})
