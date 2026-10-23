import { sectionEnd, type OutlineHeader } from "@/lib/run-of-show"
import type { EventTiming, ServiceTiming } from "@/lib/timing-engine"

const MINUTE = 60_000

export type CueRow =
  | { kind: "group"; id: string; name: string; minutes: number; plannedStart: number; plannedEnd: number; expectedEnd: number }
  | { kind: "item"; event: EventTiming; minutes: number; actualMs: number | null; offsetMinutes: number }

/**
 * The run of show as a cuesheet (#196 Prepare columns): each item of the main service with its
 * plan, what happened and what is expected, and a total line above each group. The offset is
 * how far from the plan it started (done, on now) or is expected to start (still to come).
 */
export function cuesheet(timing: ServiceTiming, headers: OutlineHeader[], itemCount: number, onAirMs: Map<string, number>): CueRow[] {
  const groups = headers.filter((h) => h.type === "group")
  const rows: CueRow[] = []
  for (const e of timing.events) {
    const g = groups.find((h) => h.at === e.index)
    if (g) {
      const end = sectionEnd(itemCount, headers, g.id)
      const inside = timing.events.filter((x) => x.index >= g.at && x.index < end)
      rows.push({ kind: "group", id: g.id, name: g.name, minutes: inside.reduce((m, x) => m + (x.plannedEnd - x.plannedStart), 0) / MINUTE, plannedStart: inside[0].plannedStart, plannedEnd: inside.at(-1)!.plannedEnd, expectedEnd: inside.at(-1)!.expectedEnd })
    }
    const started = e.state === "upcoming" ? e.expectedStart : (e.actualStart ?? e.expectedStart)
    rows.push({ kind: "item", event: e, minutes: (e.plannedEnd - e.plannedStart) / MINUTE, actualMs: e.actualStart === null ? null : (onAirMs.get(e.id) ?? 0), offsetMinutes: Math.round((started - e.plannedStart) / MINUTE) })
  }
  return rows
}
