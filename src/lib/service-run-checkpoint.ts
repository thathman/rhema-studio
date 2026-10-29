import type { JournalEntry } from "@/lib/journal"
import { parseRunOfShowEvent, type RunOfShowEventPlan } from "@/lib/run-of-show"

export interface ServiceRunCheckpointView {
  entries: JournalEntry[]
  plan: Array<{ id: string; label: string }>
  plannedMs: Record<string, number>
  headers: Array<{
    id: string
    name: string
    type: "phase" | "group"
    at: number
    event?: RunOfShowEventPlan
  }>
  operator: string | null
  checkpointAt?: number
  checkpointMono?: number
}

const JOURNAL_KINDS = [
  "live",
  "clear",
  "restore",
  "quick",
  "message",
  "rehearsal",
  "remote",
  "obs",
  "sound",
  "timing",
  "event",
  "moment",
  "source",
  "recovery",
  "scene",
  "shown",
  "take",
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function isServiceRunJournalEntry(
  value: unknown
): value is JournalEntry {
  if (
    !isRecord(value) ||
    !finite(value.at) ||
    !finite(value.mono) ||
    typeof value.label !== "string" ||
    !JOURNAL_KINDS.includes(value.kind as (typeof JOURNAL_KINDS)[number])
  )
    return false
  for (const key of ["itemId", "eventId"] as const)
    if (
      value[key] !== undefined &&
      value[key] !== null &&
      typeof value[key] !== "string"
    )
      return false
  for (const key of ["source", "by", "outputId", "sceneId"] as const)
    if (value[key] !== undefined && typeof value[key] !== "string") return false
  for (const key of ["revision", "afterMs"] as const)
    if (value[key] !== undefined && !finite(value[key])) return false
  return true
}

/** Parse a saved run for History review; malformed database content never reaches the renderer. */
export function parseServiceRunCheckpoint(
  value: unknown
): ServiceRunCheckpointView | null {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isServiceRunJournalEntry)
  )
    return null
  if (
    !Array.isArray(value.plan) ||
    !value.plan.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.label === "string"
    )
  )
    return null
  if (
    !isRecord(value.plannedMs) ||
    Object.values(value.plannedMs).some(
      (duration) => !finite(duration) || duration < 0
    )
  )
    return null
  if (
    !Array.isArray(value.headers) ||
    !value.headers.every(
      (header) =>
        isRecord(header) &&
        typeof header.id === "string" &&
        typeof header.name === "string" &&
        (header.type === "phase" || header.type === "group") &&
        finite(header.at) &&
        header.at >= 0
    )
  )
    return null
  if (value.operator !== null && typeof value.operator !== "string") return null
  if (
    value.version === 2 &&
    (!finite(value.checkpointAt) || !finite(value.checkpointMono))
  )
    return null
  return {
    entries: value.entries as JournalEntry[],
    plan: value.plan as Array<{ id: string; label: string }>,
    plannedMs: value.plannedMs as Record<string, number>,
    headers: value.headers.map((header) => {
      const raw = header as Record<string, unknown>
      const event = parseRunOfShowEvent(raw.event)
      return {
        id: raw.id as string,
        name: raw.name as string,
        type: raw.type as "phase" | "group",
        at: raw.at as number,
        ...(event ? { event } : {}),
      }
    }) as ServiceRunCheckpointView["headers"],
    operator: value.operator as string | null,
    ...(value.version === 2
      ? {
          checkpointAt: value.checkpointAt as number,
          checkpointMono: value.checkpointMono as number,
        }
      : {}),
  }
}
