import { mmss } from "@/lib/journal"
import type { ServiceRunCheckpointView } from "@/lib/service-run-checkpoint"
import { runOfShowClockRows } from "@/lib/run-of-show"
import type { ServiceRunSummary } from "@/types"

export type ServiceRunActualState =
  | "complete"
  | "at-checkpoint"
  | "not-started"
  | "unknown-recovery"
  | "unknown-interrupted"
  | "unknown-anchor"
  | "unknown-finish"

export interface ServiceRunReviewRow {
  id: string
  label: string
  kind: "event" | "item"
  plannedMs: number | null
  actualMs: number | null
  actualState: ServiceRunActualState
  differenceMs: number | null
  notInCapturedPlan?: boolean
}

type RunStatus = ServiceRunSummary["status"]

function clockMarkId(entry: ServiceRunCheckpointView["entries"][number]): string | null {
  return entry.kind === "event" || entry.kind === "moment"
    ? entry.eventId ?? entry.itemId ?? null
    : null
}

function hasRecoveryBetween(
  entries: ServiceRunCheckpointView["entries"],
  start: number,
  end: number,
): boolean {
  return entries.some(
    (entry) => entry.kind === "recovery" && entry.mono >= start && entry.mono < end,
  )
}

function actualForEvent(
  id: string,
  checkpoint: ServiceRunCheckpointView,
  status: RunStatus,
): Pick<ServiceRunReviewRow, "actualMs" | "actualState"> {
  const marks = checkpoint.entries.filter(
    (entry) => entry.kind === "event" || entry.kind === "moment",
  )
  const started = marks.some((entry) => clockMarkId(entry) === id)
  if (!started) return { actualMs: null, actualState: "not-started" }

  let totalMs = 0
  let hasOpenInterval = false
  let recoveryTruncated = false
  let invalidTimingAnchor = false

  marks.forEach((mark, index) => {
    if (clockMarkId(mark) !== id) return
    const next = marks[index + 1]
    if (!next) {
      hasOpenInterval = true
      if (status === "active" && checkpoint.checkpointMono !== undefined) {
        if (checkpoint.checkpointMono < mark.mono) {
          invalidTimingAnchor = true
        } else if (hasRecoveryBetween(checkpoint.entries, mark.mono, checkpoint.checkpointMono + 1)) {
          recoveryTruncated = true
        } else {
          totalMs += Math.max(0, checkpoint.checkpointMono - mark.mono)
        }
      }
      return
    }

    if (next.mono < mark.mono) {
      invalidTimingAnchor = true
      return
    }
    if (hasRecoveryBetween(checkpoint.entries, mark.mono, next.mono)) {
      recoveryTruncated = true
      return
    }
    totalMs += Math.max(0, next.mono - mark.mono)
  })

  if (recoveryTruncated) return { actualMs: null, actualState: "unknown-recovery" }
  if (invalidTimingAnchor) return { actualMs: null, actualState: "unknown-anchor" }
  if (hasOpenInterval) {
    if (status === "active") {
      return checkpoint.checkpointMono === undefined
        ? { actualMs: null, actualState: "unknown-anchor" }
        : { actualMs: totalMs, actualState: "at-checkpoint" }
    }
    if (status === "interrupted") return { actualMs: null, actualState: "unknown-interrupted" }
    return { actualMs: null, actualState: "unknown-finish" }
  }
  return { actualMs: totalMs, actualState: "complete" }
}

/** Build event timing from the saved plan and journal without turning missing evidence into zero. */
// eslint-disable-next-line react-refresh/only-export-components -- the row projection is a pure function covered directly by tests.
export function buildServiceRunReviewRows(
  checkpoint: ServiceRunCheckpointView,
  status: RunStatus,
): ServiceRunReviewRow[] {
  const items = checkpoint.plan.map((item) => ({
    id: item.id,
    reference: item.label,
    planned_minutes: checkpoint.plannedMs[item.id] === undefined
      ? null
      : checkpoint.plannedMs[item.id] / 60_000,
  }))
  const { rows } = runOfShowClockRows(items, checkpoint.headers)
  const plannedIds = new Set(rows.map((row) => row.id))

  const plannedRows = rows.map((row) => {
    const plannedMs = row.planned_minutes !== null && row.planned_minutes > 0
      ? row.planned_minutes * 60_000
      : null
    const actual = actualForEvent(row.id, checkpoint, status)
    return {
      id: row.id,
      label: row.reference,
      kind: row.kind,
      plannedMs,
      ...actual,
      differenceMs: actual.actualState === "complete" && plannedMs !== null && actual.actualMs !== null
        ? actual.actualMs - plannedMs
        : null,
    }
  })

  const seenActualOnly = new Set<string>()
  const actualOnlyIds = checkpoint.entries.flatMap((entry) => {
    if (entry.kind !== "event") return []
    const id = clockMarkId(entry)
    if (!id || plannedIds.has(id) || seenActualOnly.has(id)) return []
    seenActualOnly.add(id)
    return [id]
  })
  const actualOnlyRows = actualOnlyIds.map((id) => {
    const start = checkpoint.entries.find((entry) => entry.kind === "event" && clockMarkId(entry) === id)
    const actual = actualForEvent(id, checkpoint, status)
    return {
      id,
      label: start?.label ?? id,
      kind: "event" as const,
      plannedMs: null,
      ...actual,
      differenceMs: null,
      notInCapturedPlan: true,
    }
  })
  return [...plannedRows, ...actualOnlyRows]
}

function actualLabel(row: ServiceRunReviewRow): string {
  switch (row.actualState) {
    case "complete":
      return row.actualMs === null ? "Unknown" : mmss(row.actualMs)
    case "at-checkpoint":
      return row.actualMs === null ? "Unknown" : `${mmss(row.actualMs)} at last checkpoint`
    case "not-started":
      return "Not started"
    case "unknown-recovery":
      return "Unknown after recovery"
    case "unknown-interrupted":
      return "Unknown after interruption"
    case "unknown-anchor":
      return "Unknown; no timing anchor"
    case "unknown-finish":
      return "Unknown; finish was not recorded"
  }
}

function differenceLabel(row: ServiceRunReviewRow): string {
  if (row.actualState === "at-checkpoint") return "Not final"
  if (row.differenceMs === null) return "—"
  if (row.differenceMs === 0) return "0:00"
  return `${row.differenceMs > 0 ? "+" : "−"}${mmss(Math.abs(row.differenceMs))}`
}

/** Private, read-only chronology; it never restores or sends the captured plan to an output. */
export function ServiceRunReview({
  checkpoint,
  status,
}: {
  checkpoint: ServiceRunCheckpointView
  status: RunStatus
}) {
  const rows = buildServiceRunReviewRows(checkpoint, status)
  if (rows.length === 0) return null

  return (
    <section className="mt-2" aria-label="Plan versus actual event timing">
      <h3 className="mb-1 text-sm font-medium">Plan vs actual event timing</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Event</th>
              <th scope="col" className="py-1 pr-3 font-medium">Planned</th>
              <th scope="col" className="py-1 pr-3 font-medium">Actual</th>
              <th scope="col" className="py-1 font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}:${row.id}`} className="border-t border-border/60">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {row.label}
                  {row.notInCapturedPlan && <span className="ml-2 text-muted-foreground">Not in captured plan</span>}
                </th>
                <td className="py-1 pr-3 text-muted-foreground">{row.plannedMs === null ? "No estimate" : mmss(row.plannedMs)}</td>
                <td className="py-1 pr-3">{actualLabel(row)}</td>
                <td className="py-1 text-muted-foreground">{differenceLabel(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
