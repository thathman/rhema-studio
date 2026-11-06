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

const slide = (id: string, extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id, kind: "slide", slide: { title: id, body: "" }, reference: id, confidence: 1, source: "manual", added_at: 0, ...extra }) as QueueItem
const flush = () => new Promise((r) => setTimeout(r, 0))

describe("a planned-time-up cue and rehearsal (#411 timing hunt)", () => {
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
  it("a 'planned time is up' cue due during rehearsal still fires after it", async () => {
    const now = Date.now()
    useEventClock.getState().start("sermon")
    await flush()
    useBroadcastStore.setState({ rehearsal: true })
    catchUpItemCues(now + 61_000)
    await flush()
    useBroadcastStore.setState({ rehearsal: false })
    catchUpItemCues(now + 70_000)
    await flush()
    expect(useEventClock.getState().currentMomentId).toBe("sermon")
    expect(useBroadcastStore.getState().stageMessage).toBe("Time is up")
  })
})
