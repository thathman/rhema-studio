import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => undefined), listen: vi.fn(async () => () => {}) }))

import { useBroadcastStore } from "@/stores/broadcast-store"

describe("a Stage desk's message for one stage display (remote:stage_send)", () => {
  it("is kept for that stage output only, never a congregation screen, and clears", () => {
    const b = useBroadcastStore.getState()
    const congregation = b.outputs[0].id
    useBroadcastStore.setState({ outputs: [...b.outputs, { ...b.outputs[0], id: "choir", role: "stage" }, { ...b.outputs[0], id: "pulpit", role: "stage" }] })
    useBroadcastStore.getState().setStageMessageFor("choir", "Two minutes")
    useBroadcastStore.getState().setStageMessageFor(congregation, "Never here")
    expect(useBroadcastStore.getState().stageMessageTo).toEqual({ choir: "Two minutes" })
    expect(useBroadcastStore.getState().stageMessage, "the all-stages message is untouched").toBe("")
    useBroadcastStore.getState().setStageMessageFor("choir", "")
    expect(useBroadcastStore.getState().stageMessageTo).toEqual({})
  })
})
