import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

const { CUE_ACTIONS } = await import("@/lib/cues")
const fresh = vi.spyOn(CUE_ACTIONS["timer.fresh"], "run").mockImplementation(() => undefined)
await import("./on-live-cues")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")

const slide = (id: string, on_live?: QueueItem["on_live"]): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, on_live }) as unknown as QueueItem
const goLive = (id: string | null, extra: Record<string, unknown> = {}) => useBroadcastStore.setState({ isLive: true, liveItemId: id, ...extra })

describe("an item's go-live message and cue", () => {
  beforeEach(() => {
    fresh.mockClear()
    useBroadcastStore.setState({ isLive: false, liveItemId: null, rehearsal: false, stageMessage: "" })
    useQueueStore.setState({ items: [slide("sermon", { stage_message: "Wrap up in 2 minutes", cue: "timer.fresh" }), slide("plain"), slide("rehearsed", { cue: "timer.fresh" })] })
  })

  it("runs once as the item goes on air, not again for a Restore or a return from a quick screen", () => {
    goLive("sermon")
    expect(useBroadcastStore.getState().stageMessage).toBe("Wrap up in 2 minutes")
    expect(fresh).toHaveBeenCalledTimes(1)
    useBroadcastStore.setState({ isLive: false })
    goLive("sermon")
    goLive(null)
    goLive("sermon")
    expect(fresh).toHaveBeenCalledTimes(1)
    // Another item, then back: a new go-live.
    goLive("plain")
    goLive("sermon")
    expect(fresh).toHaveBeenCalledTimes(2)
  })

  it("never in rehearsal: leaving it fires nothing; Show this live does, as the congregation then sees it", () => {
    useBroadcastStore.getState().setRehearsal(true)
    goLive("rehearsed")
    expect(fresh).not.toHaveBeenCalled()
    useBroadcastStore.getState().setRehearsal(false)
    expect(useBroadcastStore.getState().liveItemId).toBeNull()
    expect(fresh).not.toHaveBeenCalled()
    useBroadcastStore.getState().setRehearsal(true)
    goLive("rehearsed")
    useBroadcastStore.getState().setRehearsal(false, { keepRehearsed: true })
    expect(fresh).toHaveBeenCalledTimes(1)
  })
})
