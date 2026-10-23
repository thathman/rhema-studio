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
  /** "event": a run-of-show event started (the event clock, ADR 0001); the others are what the screens and desk did. */
  kind: "live" | "clear" | "restore" | "quick" | "message" | "rehearsal" | "remote" | "obs" | "sound" | "timing" | "event" | "source"
  /** Reference, title or message text. */
  label: string
  itemId?: string | null
  /** The live source it came from or changed (ADR 0001): "Bible", "Hymns"… Shown in the log. */
  source?: string
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
      const next = entries.slice(i + 1).find((n) => n.kind !== "message" && n.kind !== "rehearsal" && n.kind !== "remote" && n.kind !== "obs" && n.kind !== "sound" && n.kind !== "timing" && n.kind !== "event" && n.kind !== "source")
      return { entry: e, itemId: e.itemId ?? null, label: e.label, ms: Math.max(0, (next?.mono ?? nowMono) - e.mono) }
    })
}

/** Total time on air per rundown item id, for the planned-versus-actual line. */
export function actualByItem(entries: JournalEntry[], nowMono: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of actualDurations(entries, nowMono)) if (d.itemId) out.set(d.itemId, (out.get(d.itemId) ?? 0) + d.ms)
  return out
}

/** When each run-of-show event first started (wall clock ms), from the event clock's entries (C03). */
export function eventStarts(entries: JournalEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) if (e.kind === "event" && e.itemId && !out.has(e.itemId)) out.set(e.itemId, e.at)
  return out
}

/** How long each event ran: until the next event started, the last one until `nowMono`. */
export function eventTimes(entries: JournalEntry[], nowMono: number): Map<string, number> {
  const out = new Map<string, number>()
  const starts = entries.filter((e) => e.kind === "event" && e.itemId)
  starts.forEach((e, i) => out.set(e.itemId!, (out.get(e.itemId!) ?? 0) + Math.max(0, (starts[i + 1]?.mono ?? nowMono) - e.mono)))
  return out
}

/** When each rundown item first went on air (wall clock ms), for the run of show's actual times. */
export function firstOnAir(entries: JournalEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) if ((e.kind === "live" || e.kind === "restore") && e.itemId && !out.has(e.itemId)) out.set(e.itemId, e.at)
  return out
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
export const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`

/** A plain-text log a person can read or paste into a report. */
/** The service as planned, in order, for the planned-versus-actual section (FR-09). */
export interface RundownLine {
  id: string
  label: string
  /** Added after the service first went on air (during the service). */
  inserted?: boolean
}

export function formatJournal(title: string, entries: JournalEntry[], nowMono: number, planned: Map<string, number> = new Map(), rundown?: RundownLine[]): string {
  const lines = [`${title}`, `Service log — ${entries[0] ? new Date(entries[0].at).toLocaleDateString() : ""}`, ""]
  const durations = actualDurations(entries, nowMono)
  for (const e of entries) {
    const d = durations.find((x) => x.entry === e)
    const verb = { live: "LIVE", clear: "clear", restore: "restore", quick: "quick screen", message: "stage message", rehearsal: "rehearsal", remote: "remote", obs: "OBS", sound: "sound", timing: "timer", event: "EVENT", source: "source" }[e.kind]
    const dur = d && (e.kind === "live" || e.kind === "quick" || e.kind === "restore") ? `  (${mmss(d.ms)})` : ""
    lines.push(`${hhmm(e.at)}  ${verb.padEnd(13)} ${e.label}${dur}${e.source && e.kind !== "source" ? `  · ${e.source}` : ""}`)
  }
  const totals = actualByItem(entries, nowMono)
  const versus = (ms: number | undefined, plan: number | undefined) =>
    `${ms === undefined ? "not shown" : mmss(ms)}${plan ? ` (planned ${mmss(plan)}${ms === undefined ? "" : `, ${ms > plan ? "+" : "−"}${mmss(Math.abs(ms - plan))}`})` : ""}`
  if (rundown && rundown.length > 0) {
    // Every item in service order, including those never shown and those added on the day.
    lines.push("", "Planned vs actual:")
    for (const r of rundown) lines.push(`  ${r.label}: ${versus(totals.get(r.id), planned.get(r.id))}${r.inserted ? "  [added during the service]" : ""}`)
    // What was shown that is not (or no longer) in the service: spontaneous verses, removed items.
    const inRundown = new Set(rundown.map((r) => r.id))
    const other = new Map<string, number>()
    for (const d of actualDurations(entries, nowMono)) {
      if (d.entry.kind === "quick" || (d.itemId && inRundown.has(d.itemId))) continue
      other.set(d.label, (other.get(d.label) ?? 0) + d.ms)
    }
    if (other.size > 0) {
      lines.push("", "Also shown (not in the service):")
      for (const [label, ms] of other) lines.push(`  ${label}: ${mmss(ms)}`)
    }
  } else if (totals.size > 0) {
    lines.push("", "Planned vs actual:")
    for (const [id, ms] of totals) {
      const label = entries.find((e) => e.itemId === id)?.label ?? id
      lines.push(`  ${label}: ${versus(ms, planned.get(id))}`)
    }
  }
  return lines.join("\n")
}
