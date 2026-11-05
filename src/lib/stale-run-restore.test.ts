import { beforeEach, describe, expect, it } from "vitest"
import { restoreJournal } from "@/lib/live-recovery"
import { useJournalStore } from "@/stores/journal-store"

/**
 * #411: an unfinished run with a durable checkpoint came back into the live log at every launch,
 * however old, and the next service was added to it. Only a recent one comes back; an older one
 * is offered in History (the recovery banner's durable runs).
 */
const kept = (ageMs: number) => {
  const at = Date.now() - ageMs
  return {
    v: 2 as const,
    at,
    checkpointMono: 0,
    entries: [{ at, mono: 0, kind: "event" as const, label: "Opening", itemId: "opening" }],
    startItemIds: ["opening"],
    runStatus: "active" as const,
    finalizedLogId: null,
    runContext: {
      runId: "last-week",
      programId: "service-1",
      programRevision: 4,
      title: "Sunday service",
      serviceDate: "2026-10-29",
      timeZone: "Africa/Lagos",
      startedAt: new Date(at).toISOString(),
      operator: null,
      plan: [{ id: "opening", label: "Opening" }],
      plannedMs: {},
      headers: [],
      startItemIds: ["opening"],
    },
  }
}

beforeEach(() => useJournalStore.setState({ entries: [], runContext: null }))

describe("an unfinished run comes back into the live log only while recent (#411)", () => {
  it("leaves a week-old run with a durable checkpoint to History", () => {
    expect(restoreJournal(kept(7 * 24 * 60 * 60 * 1000) as never)).toBe(false)
    expect(useJournalStore.getState().entries).toEqual([])
    expect(useJournalStore.getState().runContext).toBeNull()
  })

  it("still brings back a run from an hour ago", () => {
    expect(restoreJournal(kept(60 * 60 * 1000) as never)).toBe(true)
    expect(useJournalStore.getState().runContext?.runId).toBe("last-week")
  })
})
