import { afterEach, describe, expect, it, vi } from "vitest"

let frames = 100
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => ({ active: true, framesSent: frames }) }))
const warning = vi.fn()
vi.mock("sonner", () => ({ toast: { warning: (...a: unknown[]) => warning(...a) } }))

import { useBroadcastStore } from "@/stores/broadcast-store"
import { startNdiStallWatch } from "./ndi-stall-watch"

describe("an NDI sender that stops is said wherever the operator is (#411)", () => {
  afterEach(() => vi.useRealTimers())

  it("warns once after 10 s with no new frame, and not while frames come", async () => {
    vi.useFakeTimers()
    useBroadcastStore.setState((s) => ({ outputs: [...s.outputs.filter((o) => o.id !== "ndi-1"), { ...s.outputs[0], id: "ndi-1", name: "Stream NDI", type: "ndi" }], outputStatus: { ...s.outputStatus, "ndi-1": { previewOpen: false, ndiActive: true } } }) as never)
    const stop = startNdiStallWatch()
    for (let i = 0; i < 5; i++) { frames += 30; await vi.advanceTimersByTimeAsync(3000) }
    expect(warning).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000) // frames stop
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning.mock.calls[0][0]).toContain("Stream NDI")
    await vi.advanceTimersByTimeAsync(30_000)
    expect(warning).toHaveBeenCalledTimes(1) // once per stall
    stop()
  })
})
