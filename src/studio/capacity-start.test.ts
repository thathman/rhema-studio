import { beforeEach, describe, expect, it, vi } from "vitest"

const ask = vi.fn(async () => true)
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string) => (cmd === "machine_info" ? { cores: 8, physicalCores: 4, memoryTotalMb: 16384, os: "macos", arch: "x86_64" } : null)) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: vi.fn(async () => []), getAllWindows: vi.fn(async () => []) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => ask(...(a as [])) }))

const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useSettingsStore } = await import("@/stores/settings-store")
const { confirmStart, resetStartConfirmations } = await import("@/lib/broadcast-output-control")
const { MAIN_OUTPUT_ID, defaultNdiSettings } = await import("@/types")

const ndi = (id: string, frameRate: "fps30" | "fps60" = "fps30") => ({ id, name: id, type: "ndi" as const, themeId: "t", monitorIndex: 0, ndi: { ...defaultNdiSettings(id), frameRate } })

/** Turning an output on (#243 G13): past a limit, or 60 fps on a smaller computer, asks first. */
describe("confirm before starting an output", () => {
  beforeEach(() => {
    ask.mockReset()
    ask.mockResolvedValue(true)
    resetStartConfirmations()
    useSettingsStore.setState({ capacityLimits: {}, cameras: [] })
    useBroadcastStore.setState({
      outputStatus: {},
      outputs: [{ id: MAIN_OUTPUT_ID, name: "Projector", type: "display", themeId: "t", monitorIndex: 0, ndi: defaultNdiSettings() }, ndi("a"), ndi("b"), ndi("c"), ndi("d"), ndi("e"), ndi("fast", "fps60")],
    })
  })

  it("does not ask within the limits", async () => {
    expect(await confirmStart(ndi("a"))).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })

  it("asks before a sender past the NDI limit, and keeps it off on no", async () => {
    for (const id of ["a", "b", "c", "d"]) useBroadcastStore.getState().setOutputStatus(id, { previewOpen: false, ndiActive: true })
    ask.mockResolvedValue(false)
    expect(await confirmStart(ndi("e"))).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]).toEqual([expect.stringContaining("with e on it runs 5 NDI senders (it suits about 4)"), expect.objectContaining({ title: "Turn on e?", okLabel: "Turn it on", cancelLabel: "Keep it off" })])
    // A higher limit set in Settings: no question.
    useSettingsStore.getState().setCapacityLimit("ndiSenders", 6)
    expect(await confirmStart(ndi("e"))).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it("asks once per output about 60 fps on a computer below what it needs", async () => {
    expect(await confirmStart(ndi("fast", "fps60"))).toBe(true)
    expect(ask.mock.calls[0]).toEqual([expect.stringContaining("below what 60 fps NDI needs"), expect.objectContaining({ title: "Start fast at 60 fps?", okLabel: "Start at 60 fps" })])
    expect(await confirmStart(ndi("fast", "fps60"))).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it("does not ask about an output already on", async () => {
    useBroadcastStore.getState().setOutputStatus("fast", { previewOpen: false, ndiActive: true })
    expect(await confirmStart(ndi("fast", "fps60"))).toBe(true)
    expect(ask).not.toHaveBeenCalled()
  })
})
