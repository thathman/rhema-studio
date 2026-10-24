import { sectionEnd, type OutlineHeader } from "@/lib/run-of-show"
import type { EventState, EventTiming, ServiceTiming } from "@/lib/timing-engine"
import type { RundownTime } from "@/lib/live-state"

const MINUTE = 60_000

export type CueRow =
  | { kind: "group"; id: string; name: string; minutes: number; plannedStart: number; plannedEnd: number; expectedEnd: number }
  | { kind: "item"; event: EventTiming; minutes: number; actualMs: number | null; offsetMinutes: number | null }

/**
 * The run of show as a cuesheet (#196 Prepare columns): each item of the main service with its
 * plan, what happened and what is expected, and a total line above each group. The offset is
 * how far from the plan it started (done, on now) or is expected to start (still to come); a
 * skipped item has none.
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
    rows.push({ kind: "item", event: e, minutes: (e.plannedEnd - e.plannedStart) / MINUTE, actualMs: e.actualStart === null ? null : (onAirMs.get(e.id) ?? 0), offsetMinutes: offsetMinutes(e.state, e.plannedStart, e.expectedStart, e.actualStart) })
  }
  return rows
}

/** How far from the plan it started (done, on now) or is expected to start (to come); none when skipped. */
export function offsetMinutes(state: EventState, plannedStart: number, expectedStart: number, actualStart: number | null): number | null {
  if (state === "skipped") return null
  const started = state === "upcoming" ? expectedStart : (actualStart ?? expectedStart)
  return Math.round((started - plannedStart) / MINUTE)
}

export interface BackstageRow {
  id: string
  label: string
  time: RundownTime
  offsetMinutes: number | null
}

/**
 * The read-only backstage cuesheet (#196 R4) from the host's Live State: each item of the main
 * service with its times. Empty when the host sends none (no start time yet, or an older host).
 */
export function backstageRows(rundown: { id: string; reference: string; time?: RundownTime }[]): BackstageRow[] {
  return rundown.flatMap((r) => (r.time ? [{ id: r.id, label: r.reference, time: r.time, offsetMinutes: offsetMinutes(r.time.state, r.time.plan[0], r.time.expected[0], r.time.actual ?? null) }] : []))
}
