import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { JournalEntry } from "@/lib/journal"
import type { ServiceRunCheckpointView } from "@/lib/service-run-checkpoint"
import { buildServiceRunReviewRows, ServiceRunReview } from "./service-run-review"

const checkpoint = (entries: JournalEntry[], checkpointMono = 420_000): ServiceRunCheckpointView => ({
  entries,
  plan: [
    { id: "moment-welcome", label: "Welcome words" },
    { id: "moment-reading", label: "John 3:16" },
  ],
  plannedMs: { "moment-welcome": 0, "moment-reading": 0 },
  headers: [
    { id: "welcome", name: "Welcome", type: "group", at: 0, event: { schema_version: 1, duration_minutes: 5 } },
    { id: "reading", name: "Scripture", type: "group", at: 1, event: { schema_version: 1, duration_minutes: 1 } },
  ],
  operator: "Tolu",
  checkpointAt: 1_800_000_000_000,
  checkpointMono,
})

const event = (id: string, mono: number): JournalEntry => ({
  at: 1_800_000_000_000 + mono,
  mono,
  kind: "event",
  label: id,
  eventId: id,
})

describe("service run plan-versus-actual review", () => {
  it("shows completed event durations and their difference from the event estimate", () => {
    const rows = buildServiceRunReviewRows(checkpoint([
      event("welcome", 0),
      { ...event("welcome", 60_000), kind: "moment", label: "Welcome words", itemId: "moment-welcome" },
      event("reading", 240_000),
      { at: 1_800_000_420_000, mono: 420_000, kind: "event", label: "Service finished" },
    ]), "finished")

    expect(rows).toEqual([
      { id: "welcome", label: "Welcome", kind: "event", plannedMs: 300_000, actualMs: 240_000, actualState: "complete", differenceMs: -60_000 },
      { id: "reading", label: "Scripture", kind: "event", plannedMs: 60_000, actualMs: 180_000, actualState: "complete", differenceMs: 120_000 },
    ])
  })

  it("includes journaled events added after the captured plan", () => {
    const rows = buildServiceRunReviewRows(checkpoint([
      event("welcome", 0),
      event("added-on-the-day", 60_000),
      event("reading", 240_000),
      { at: 1_800_000_420_000, mono: 420_000, kind: "event", label: "Service finished" },
    ]), "finished")

    expect(rows.at(-1)).toMatchObject({
      id: "added-on-the-day",
      label: "added-on-the-day",
      kind: "event",
      notInCapturedPlan: true,
      plannedMs: null,
      actualMs: 180_000,
      actualState: "complete",
      differenceMs: null,
    })
    const html = renderToStaticMarkup(createElement(ServiceRunReview, {
      checkpoint: checkpoint([
        event("welcome", 0),
        event("added-on-the-day", 60_000),
        event("reading", 240_000),
        { at: 1_800_000_420_000, mono: 420_000, kind: "event", label: "Service finished" },
      ]),
      status: "finished",
    }))
    expect(html).toContain("Not in captured plan")
  })

  it("keeps unstarted and recovery-truncated events distinct from zero", () => {
    const rows = buildServiceRunReviewRows(checkpoint([
      event("welcome", 0),
      { at: 1_800_000_120_000, mono: 120_000, kind: "recovery", label: "Recovered" },
      event("reading", 180_000),
      { at: 1_800_000_240_000, mono: 240_000, kind: "event", label: "Service finished" },
    ]), "finished")

    expect(rows).toMatchObject([
      { id: "welcome", actualMs: null, actualState: "unknown-recovery", differenceMs: null },
      { id: "reading", actualMs: 60_000, actualState: "complete", differenceMs: 0 },
    ])
  })

  it("labels the active event as a checkpoint duration and does not present a final variance", () => {
    const rows = buildServiceRunReviewRows(checkpoint([
      event("welcome", 0),
      event("reading", 240_000),
    ], 300_000), "active")

    expect(rows).toMatchObject([
      { id: "welcome", actualMs: 240_000, actualState: "complete", differenceMs: 240_000 - 300_000 },
      { id: "reading", actualMs: 60_000, actualState: "at-checkpoint", differenceMs: null },
    ])
  })

  it("does not estimate the open duration for an interrupted run", () => {
    const rows = buildServiceRunReviewRows({
      ...checkpoint([event("welcome", 0)], 0),
      checkpointMono: undefined,
    }, "interrupted")

    expect(rows[0]).toMatchObject({ actualMs: null, actualState: "unknown-interrupted", differenceMs: null })
  })

  it("does not turn an event with no journal mark into a zero duration", () => {
    const base = checkpoint([])
    const rows = buildServiceRunReviewRows({
      ...base,
      plan: [...base.plan, { id: "moment-closing", label: "Closing words" }],
      plannedMs: { ...base.plannedMs, "moment-closing": 0 },
      headers: [...base.headers, { id: "closing", name: "Closing", type: "group" as const, at: 2, event: { schema_version: 1 as const } }],
    }, "finished")

    expect(rows[2]).toMatchObject({ id: "closing", plannedMs: null, actualMs: null, actualState: "not-started", differenceMs: null })
  })

  it("reports an active checkpoint without a monotonic anchor as unknown", () => {
    const base = checkpoint([event("welcome", 0)])
    const anchorless = { ...base, checkpointMono: undefined }
    const rows = buildServiceRunReviewRows(anchorless, "active")
    expect(rows[0]).toMatchObject({ actualMs: null, actualState: "unknown-anchor", differenceMs: null })
  })

  it("treats a checkpoint older than the latest event mark as an invalid anchor", () => {
    const rows = buildServiceRunReviewRows(checkpoint([event("welcome", 120_000)], 60_000), "active")
    expect(rows[0]).toMatchObject({ actualMs: null, actualState: "unknown-anchor", differenceMs: null })
  })

  it("renders checkpoint timing as private review with an explicit non-final difference", () => {
    const html = renderToStaticMarkup(createElement(ServiceRunReview, {
      checkpoint: checkpoint([event("welcome", 0)], 60_000),
      status: "active",
    }))

    expect(html).toContain('aria-label="Plan versus actual event timing"')
    expect(html).toContain("Plan vs actual event timing")
    expect(html).toContain("1:00 at last checkpoint")
    expect(html).toContain("Not final")
  })
})
