/**
 * What actually happened in the service: every time something went on air,
 * was cleared, or a quick screen or stage message appeared. Pure data plus a
 * text export; the store feeds it from broadcast-store changes.
 */
export interface JournalEntry {
  /** Wall clock, for the printed log. */
  at: number
  /** Monotonic ms, for durations (immune to clock changes). */
  mono: number
  kind: "live" | "clear" | "restore" | "quick" | "message" | "rehearsal" | "remote" | "obs" | "sound"
  /** Reference, title or message text. */
  label: string
  itemId?: string | null
}

export interface ActualDuration {
  /** The log entry this duration belongs to. */
  entry: JournalEntry
  itemId: string | null
  label: string
  /** Milliseconds the item (or screen) was on air before the next change. */
  ms: number
}

/** Time on air per entry: each entry lasts until the next entry (or `nowMono` for the last). */
export function actualDurations(entries: JournalEntry[], nowMono: number): ActualDuration[] {
  return entries
    .filter((e) => e.kind === "live" || e.kind === "quick" || e.kind === "restore")
    .map((e) => {
      const i = entries.indexOf(e)
      const next = entries.slice(i + 1).find((n) => n.kind !== "message" && n.kind !== "rehearsal" && n.kind !== "remote" && n.kind !== "obs" && n.kind !== "sound")
      return { entry: e, itemId: e.itemId ?? null, label: e.label, ms: Math.max(0, (next?.mono ?? nowMono) - e.mono) }
    })
}

/** Total time on air per rundown item id, for the planned-versus-actual line. */
export function actualByItem(entries: JournalEntry[], nowMono: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of actualDurations(entries, nowMono)) if (d.itemId) out.set(d.itemId, (out.get(d.itemId) ?? 0) + d.ms)
  return out
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`

/** A plain-text log a person can read or paste into a report. */
export function formatJournal(title: string, entries: JournalEntry[], nowMono: number, planned: Map<string, number> = new Map()): string {
  const lines = [`${title}`, `Service log — ${entries[0] ? new Date(entries[0].at).toLocaleDateString() : ""}`, ""]
  const durations = actualDurations(entries, nowMono)
  for (const e of entries) {
    const d = durations.find((x) => x.entry === e)
    const verb = { live: "LIVE", clear: "clear", restore: "restore", quick: "quick screen", message: "stage message", rehearsal: "rehearsal", remote: "remote", obs: "OBS", sound: "sound" }[e.kind]
    const dur = d && (e.kind === "live" || e.kind === "quick" || e.kind === "restore") ? `  (${mmss(d.ms)})` : ""
    lines.push(`${hhmm(e.at)}  ${verb.padEnd(13)} ${e.label}${dur}`)
  }
  const totals = actualByItem(entries, nowMono)
  if (totals.size > 0) {
    lines.push("", "Planned vs actual:")
    for (const [id, ms] of totals) {
      const label = entries.find((e) => e.itemId === id)?.label ?? id
      const plan = planned.get(id)
      lines.push(`  ${label}: ${mmss(ms)}${plan ? ` (planned ${mmss(plan)}, ${ms > plan ? "+" : "−"}${mmss(Math.abs(ms - plan))})` : ""}`)
    }
  }
  return lines.join("\n")
}
