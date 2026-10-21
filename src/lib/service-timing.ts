import type { QueueItem } from "@/types"

export const plannedMs = (item: QueueItem): number => (item.planned_minutes ?? 0) * 60_000

/** Planned length of the whole service. */
export const plannedTotalMs = (items: QueueItem[]): number => items.reduce((sum, i) => sum + plannedMs(i), 0)

export interface TimingSummary {
  totalMs: number
  /** Planned time up to and including the live item. */
  plannedSoFarMs: number
  /** Elapsed minus planned-so-far: positive = running late. Null when nothing is live or nothing is planned. */
  behindMs: number | null
}

/** Where the service stands against its plan, given the live item and the timer's elapsed time. */
export function timingSummary(items: QueueItem[], liveIndex: number | null, elapsedMs: number): TimingSummary {
  const totalMs = plannedTotalMs(items)
  if (liveIndex === null || totalMs === 0) return { totalMs, plannedSoFarMs: 0, behindMs: null }
  const plannedSoFarMs = items.slice(0, liveIndex + 1).reduce((sum, i) => sum + plannedMs(i), 0)
  return { totalMs, plannedSoFarMs, behindMs: elapsedMs - plannedSoFarMs }
}

/**
 * When the service was planned to end and when it now looks like ending
 * (FR-07 "delayed-service projections"), as wall-clock ms. The plan starts
 * when the timer started; running late moves the end by the same amount.
 * Null when nothing is planned or nothing is live yet.
 */
export function projectedEnd(summary: TimingSummary, elapsedMs: number, nowWallMs: number): { plannedEnd: number; expectedEnd: number } | null {
  if (summary.behindMs === null || summary.totalMs === 0) return null
  const plannedEnd = nowWallMs - elapsedMs + summary.totalMs
  return { plannedEnd, expectedEnd: plannedEnd + summary.behindMs }
}

/** "1 h 10 min", "45 min", "" for zero. */
export function formatMinutes(ms: number): string {
  const total = Math.round(ms / 60_000)
  if (total <= 0) return ""
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`
}
