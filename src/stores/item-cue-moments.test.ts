import { beforeEach, describe, expect, it, vi } from "vitest"
import type { QueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

const { CUE_ACTIONS } = await import("@/lib/cues")
const pauseTimer = vi.spyOn(CUE_ACTIONS["timer.pause"], "run").mockImplementation(() => undefined)
const { useObsStore } = await import("@/stores/obs-store")
const mark = vi.fn(async () => {})
useObsStore.setState({ mark })
const { catchUpItemCues } = await import("./on-live-cues")
const { useBroadcastStore } = await import("@/stores/broadcast-store")
const { useQueueStore } = await import("@/stores/queue-store")
const { useEventClock } = await import("@/stores/event-clock-store")
const { useHold } = await import("@/stores/hold-store")
const { presentQueueItem } = await import("@/lib/remote-actions")

const slide = (id: string, extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, ...extra }) as QueueItem
const flush = () => new Promise((r) => setTimeout(r, 0))

describe("an item's cues at each moment (#193, #196 R6)", () => {
  beforeEach(() => {
    pauseTimer.mockClear()
    mark.mockClear()
    useHold.setState({ hold: null })
    useEventClock.setState({ mode: "screens", currentId: null, currentMomentId: null })
    useBroadcastStore.setState({ isLive: false, liveItemId: null, rehearsal: false, stageMessage: "" })
    useQueueStore.setState({
      items: [
        slide("welcome", { cues: [{ on: "end", do: "obs.mark", text: "Welcome over" }] }),
        slide("sermon", { planned_minutes: 1, cues: [{ on: "live", do: "obs.mark" }, { on: "finish", do: "stage.message", text: "Time is up" }, { on: "pause", do: "stage.message", text: "Held" }] }),
        { id: "chapter", kind: "cue", reference: "Offering", confidence: 1, source: "manual", added_at: 0, cues: [{ on: "live", do: "obs.mark" }, { on: "live", do: "timer.pause" }] },
        slide("closing"),
      ],
      headers: [],
      activeIndex: null,
    })
  })

  it("marks the end of one item before the start of the next", async () => {
    useEventClock.getState().start("welcome")
    useEventClock.getState().start("sermon")
    await flush()
    expect(mark.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["Welcome over", "sermon"])
  })

  it("fires 'planned time is up' after its minutes (caught up on the tick), and 'paused' at a hold", async () => {
    const now = Date.now()
    useEventClock.getState().start("sermon")
    await flush()
    catchUpItemCues(now + 30_000)
    expect(useBroadcastStore.getState().stageMessage).toBe("")
    useHold.setState({ hold: { reason: "Prayer", since: now } })
    await flush()
    expect(useBroadcastStore.getState().stageMessage).toBe("Held")
    // Due while on hold: waits for Resume.
    catchUpItemCues(now + 61_000)
    expect(useBroadcastStore.getState().stageMessage).toBe("Held")
    useHold.setState({ hold: null })
    catchUpItemCues(now + 62_000)
    await flush()
    expect(useBroadcastStore.getState().stageMessage).toBe("Time is up")
  })

  it("none in rehearsal", async () => {
    useBroadcastStore.setState({ rehearsal: true })
    useEventClock.setState({ currentId: "sermon", currentMomentId: "sermon" })
    await flush()
    expect(mark).not.toHaveBeenCalled()
  })

  it("a cue-only item fires its cues when taken and leaves the screens as they are", async () => {
    useBroadcastStore.setState({ isLive: true, liveItemId: "sermon" })
    useEventClock.setState({ currentId: "sermon", currentMomentId: "sermon" })
    await presentQueueItem(2)
    await flush()
    expect(useEventClock.getState().currentId).toBe("chapter")
    expect(useQueueStore.getState().activeIndex).toBe(2)
    expect(useBroadcastStore.getState().liveItemId).toBe("sermon")
    expect(mark).toHaveBeenCalledWith("Offering")
    expect(pauseTimer).toHaveBeenCalledTimes(1)
    // The screens updating with the same content does not take the event back.
    useBroadcastStore.setState({ stageMessage: "x" })
    expect(useEventClock.getState().currentId).toBe("chapter")
  })
})
