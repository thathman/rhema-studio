import { describe, expect, it } from "vitest"
import { parseServiceRunCheckpoint } from "./service-run-checkpoint"

const checkpoint = {
  version: 2,
  checkpointAt: 1_800_000_000_000,
  checkpointMono: 12_000,
  entries: [
    {
      at: 1_800_000_000_000,
      mono: 12_000,
      kind: "live",
      label: "John 3:16",
      itemId: "verse-1",
    },
  ],
  startItemIds: ["verse-1"],
  plan: [{ id: "verse-1", label: "John 3:16" }],
  plannedMs: { "verse-1": 180_000 },
  headers: [
    { id: "phase-1", type: "phase", name: "Opening", at: 0 },
    {
      id: "event-1",
      type: "group",
      name: "Welcome",
      at: 0,
      event: { schema_version: 1, duration_minutes: 4 },
    },
  ],
  operator: "Tolu",
}

describe("saved service run checkpoints", () => {
  it("accepts a captured checkpoint and its time anchor", () => {
    expect(parseServiceRunCheckpoint(checkpoint)).toMatchObject({
      entries: checkpoint.entries,
      checkpointAt: checkpoint.checkpointAt,
      checkpointMono: checkpoint.checkpointMono,
      plan: checkpoint.plan,
      headers: checkpoint.headers,
    })
  })

  it("keeps unknown event versions out of the typed History projection", () => {
    const parsed = parseServiceRunCheckpoint({
      ...checkpoint,
      headers: [{ id: "future-event", type: "group", name: "Future", at: 0, event: { schema_version: 2 } }],
    })
    expect(parsed?.headers[0]).not.toHaveProperty("event")
  })

  it.each([
    { ...checkpoint, version: 99 },
    { ...checkpoint, entries: [{ ...checkpoint.entries[0], kind: "unknown" }] },
    { ...checkpoint, entries: [{ ...checkpoint.entries[0], at: "yesterday" }] },
    { ...checkpoint, plan: [{ id: "verse-1", label: 3 }] },
    {
      ...checkpoint,
      headers: [{ id: "phase-1", type: "unknown", name: "Opening", at: 0 }],
    },
    { ...checkpoint, checkpointMono: Number.NaN },
  ])("rejects a malformed checkpoint without trying to repair it", (value) => {
    expect(parseServiceRunCheckpoint(value)).toBeNull()
  })
})
