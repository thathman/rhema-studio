import { sectionEnd, type OutlineHeader } from "@/lib/run-of-show"
import type { EventState, EventTiming, ServiceTiming } from "@/lib/timing-engine"
import type { RundownTime } from "@/lib/live-state"
import { formatMinutes } from "@/lib/service-timing"

const MINUTE = 60_000

export type CueRow =
  | { kind: "group"; id: string; name: string; minutes: number; plannedStart: number; plannedEnd: number; expectedEnd: number }
  | { kind: "item"; event: EventTiming; minutes: number; actualMs: number | null; offsetMinutes: number | null }
  /** A planned pause before an item (#196 R3): how long, and how much lateness it is expected to take up (null once that item has begun or was skipped). */
  | { kind: "gap"; id: string; minutes: number; absorbedMinutes: number | null; beforeFixed: boolean }

/**
 * The run of show as a cuesheet (#196 Prepare columns): each item of the main service with its
 * plan, what happened and what is expected, and a total line above each group. The offset is
 * how far from the plan it started (done, on now) or is expected to start (still to come); a
 * skipped item has none. A pause before an item (its gap, or the free time before a fixed start) is
 * its own thin row, above the group's when the item opens a group.
 */
export function cuesheet(timing: ServiceTiming, headers: OutlineHeader[], itemCount: number, onAirMs: Map<string, number>): CueRow[] {
  const groups = headers.filter((h) => h.type === "group")
  const rows: CueRow[] = []
  for (const e of timing.events) {
    const g = groups.find((h) => h.at === e.index)
    if (e.gapMs > 0) rows.push(gapRow(e))
    if (g) {
      const end = sectionEnd(itemCount, headers, g.id)
      const inside = timing.events.filter((x) => x.index >= g.at && x.index < end)
      rows.push({ kind: "group", id: g.id, name: g.name, minutes: inside.reduce((m, x) => m + (x.plannedEnd - x.plannedStart), 0) / MINUTE, plannedStart: inside[0].plannedStart, plannedEnd: inside.at(-1)!.plannedEnd, expectedEnd: inside.at(-1)!.expectedEnd })
    }
    rows.push({ kind: "item", event: e, minutes: (e.plannedEnd - e.plannedStart) / MINUTE, actualMs: e.actualStart === null ? null : (onAirMs.get(e.id) ?? 0), offsetMinutes: offsetMinutes(e.state, e.plannedStart, e.expectedStart, e.actualStart) })
  }
  return rows
}

function gapRow(e: EventTiming): CueRow {
  return { kind: "gap", id: `gap:${e.id}`, minutes: e.gapMs / MINUTE, absorbedMinutes: e.state === "upcoming" ? Math.round(e.absorbedMs / MINUTE) : null, beforeFixed: e.fixedStart !== null }
}

/** A pause row's words, here and on a desk: "Pause · 5 min" and "absorbs 3 min" (nothing once its item has begun). */
export function pauseWords(minutes: number, absorbedMinutes: number | null, beforeFixed: boolean): { label: string; absorbs: string } {
  const all = formatMinutes(minutes * MINUTE)
  const label = `${beforeFixed ? "Pause before the fixed start" : "Pause"} · ${all}`
  if (absorbedMinutes === null) return { label, absorbs: "" }
  return { label, absorbs: absorbedMinutes <= 0 ? `can absorb ${all}` : absorbedMinutes >= Math.round(minutes) ? `absorbs ${all} · used up` : `absorbs ${formatMinutes(absorbedMinutes * MINUTE)}` }
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
