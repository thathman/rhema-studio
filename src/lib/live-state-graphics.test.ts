import { afterEach, describe, expect, it, vi } from "vitest"
import { buildLiveState } from "@/lib/live-state"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import type { QueueItem } from "@/types"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))

describe("host graphics queue projection", () => {
  afterEach(() => {
    useQueueStore.setState({ items: [], headers: [] })
    useEventClock.setState({
      mode: "own",
      currentId: null,
      currentMomentId: null,
    })
    useServiceStore.setState({ current: null, dirty: false })
  })

  it("publishes current service moments with service approval and event-clock context", () => {
    const item = {
      id: "moment-welcome",
      kind: "slide",
      reference: "Welcome",
      confidence: 1,
      source: "manual",
      added_at: 0,
      slide: { title: "Welcome", body: "" },
    } as QueueItem
    useServiceStore.setState({
      current: {
        id: "service",
        title: "Sunday service",
        service_date: null,
        revision: 3,
        created_at: "",
        updated_at: "",
        item_count: 1,
        approved_revision: 3,
      },
      dirty: false,
    })
    useQueueStore.setState({
      items: [item],
      headers: [
        {
          id: "event-welcome",
          type: "group",
          name: "Welcome",
          at: 0,
          event: { schema_version: 1 },
        },
      ],
    })
    useServiceStore.setState({ dirty: false })
    useEventClock.setState({
      mode: "screens",
      currentId: "event-welcome",
      currentMomentId: "moment-welcome",
    })

    expect(buildLiveState(1_800_000_000_000).graphicsQueue).toEqual({
      planState: "approved",
      items: [
        {
          id: "moment-welcome",
          title: "Welcome",
          kind: "Slide",
          eventId: "event-welcome",
          eventTitle: "Welcome",
          state: "Current moment",
          destinations: ["Per output source settings"],
        },
      ],
    })
  })
})
