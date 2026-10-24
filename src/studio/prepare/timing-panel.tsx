import { useServiceOffset } from "@/stores/service-offset-store"
import { useSettingsStore } from "@/stores/settings-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useQueueStore } from "@/stores"
import { presentActions } from "@/studio/present-actions"
import { formatMinutes, plannedTotalMs } from "@/lib/service-timing"
import { clockMinutes, clockText, phaseRange, planTimeline } from "@/lib/run-of-show"
import type { EventTiming } from "@/lib/timing-engine"
import { mmss } from "@/lib/journal"
import { useServiceTiming } from "@/studio/use-service-timing"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { CuesheetDialog } from "@/studio/prepare/cuesheet-dialog"

function Clock({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl bg-surface-sunken px-2.5 py-2">
      <p className="text-[0.6875rem] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tracking-[-0.03em] tabular-nums">{value}</p>
      {note && <p className="text-[0.6875rem] text-muted-foreground tabular-nums">{note}</p>}
    </div>
  )
}

const wallClock = (ms: number) => { const d = new Date(ms); return clockText(d.getHours() * 60 + d.getMinutes()) }

/** "4 min late", "on time", "1 h 10 min early". */
function lateness(minutes: number): string {
  return minutes === 0 ? "on time" : `${formatMinutes(Math.abs(minutes) * 60_000)} ${minutes > 0 ? "late" : "early"}`
}

/**
 * Run of show timing: the main service's start, when the warm-up begins, the
 * projected finish and each item's planned time. ±5 min moves only the
 * projection (running late or early); the plan stays as prepared. Once the
 * service has been on air, each item also shows when it actually went up and
 * for how long (from the service log; rehearsal is not counted).
 */
export function TimingPanel() {
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const main = headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual")
  const total = formatMinutes(plannedTotalMs(items))
  const { timing, first, onAir } = useServiceTiming()
  const me = useSettingsStore((s) => s.operatorName.trim()) || "Main desk"
  const range = main ? phaseRange(items.length, headers, main.id) : null
  const began = range ? Math.min(...items.slice(range.start, range.end).map((i) => first.get(i.id) ?? Infinity)) : Infinity
  const plannedStart = clockMinutes(main?.starts_at)
  const late = Number.isFinite(began) && plannedStart !== null ? (() => { const d = new Date(began); return d.getHours() * 60 + d.getMinutes() - plannedStart })() : null
  // The plan as prepared; what is expected comes from the timing engine (what happened, the time now, ±5 min).
  const plan = planTimeline(items, headers)
  const expected = new Map(timing?.events.map((e) => [e.index, e]) ?? [])
  const lateMinutes = timing ? Math.round(timing.lateMs / 60_000) : 0
  const [table, setTable] = useState(false)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-panel">
      <div className="flex items-end justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-[0.6875rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Run of show</p>
          <h2 className="text-sm font-semibold">Timing{total ? ` · ${total} planned` : ""}</h2>
        </div>
        {plan && <Button size="xs" variant="outline" onClick={() => setTable(true)}>Table</Button>}
        <CuesheetDialog open={table} onOpenChange={setTable} />
      </div>
      {!main ? (
        <p className="p-4 text-xs text-muted-foreground">Organise the service into phases (under the order of service) to plan its times: when the warm-up begins, when each item starts, when it ends.</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{main.name} starts at</span>
            <Input
              type="time"
              aria-label={`${main.name} start time`}
              value={main.starts_at ?? ""}
              onChange={(e) => useQueueStore.getState().updateHeader(main.id, { starts_at: e.target.value || undefined })}
              className="h-8 w-28 text-sm"
            />
          </label>
          {plan ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Clock label="Start" value={plan.start} />
                <Clock label="Warm-up" value={plan.warmupStart ?? "—"} />
                <Clock label="Finish" value={timing ? wallClock(timing.expectedEnd) : plan.finish} note={timing && lateMinutes !== 0 ? `planned ${plan.finish}` : undefined} />
              </div>
              {late !== null && (
                <p className={cn("text-xs", late > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")} role="status">
                  Began at {wallClock(began)}, {lateness(late)}
                </p>
              )}
              <div className="flex items-center justify-between gap-2" role="group" aria-label="Running late or early">
                <Button size="xs" variant="outline" onClick={() => useServiceOffset.getState().adjust(-5, me)}>−5 min</Button>
                <span className={cn("text-xs font-semibold", lateMinutes > 0 ? "text-confidence-mid" : "text-muted-foreground")} role="status">{lateMinutes === 0 ? "On schedule" : lateness(lateMinutes)}</span>
                <Button size="xs" variant="outline" onClick={() => useServiceOffset.getState().adjust(5, me)}>+5 min</Button>
              </div>
              <ol className="min-h-0 overflow-y-auto border-t border-border pt-2" aria-label="Planned times">
                {plan.rows.map((r, k) => (
                  <li key={k}>
                    <button
                      type="button"
                      disabled={r.index === undefined}
                      onClick={() => r.index !== undefined && presentActions.previewItem(items[r.index])}
                      className="flex w-full items-start gap-2.5 rounded-md px-1 py-1 text-left outline-none enabled:hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <span className="w-11 shrink-0 text-xs text-muted-foreground tabular-nums">{r.time}</span>
                      <span aria-hidden className={cn("mt-1 size-2 shrink-0 rounded-full", r.kind === "milestone" ? "bg-primary" : "border border-muted-foreground")} />
                      <span className="min-w-0">
                        <span className={cn("block truncate text-xs", r.kind === "milestone" && "font-semibold")}>{r.label}</span>
                        {r.kind === "item" && <span className="block text-[0.6875rem] text-muted-foreground">{r.minutes ? `${r.minutes} min` : "no minutes yet"}</span>}
                        {r.index !== undefined && <ExpectedLine event={expected.get(r.index)} />}
                        {r.index !== undefined && first.has(items[r.index].id) && <ActualLine started={first.get(items[r.index].id)!} ms={onAir.get(items[r.index].id) ?? 0} planned={r.minutes} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Set the start time to see when the warm-up begins, when each item starts and when the service ends.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** When an item actually went on air and for how long, against its plan. */
function ActualLine({ started, ms, planned }: { started: number; ms: number; planned?: number }) {
  const over = planned ? ms - planned * 60_000 : 0
  return (
    <span className="block text-[0.6875rem] tabular-nums">
      On air {wallClock(started)} for {mmss(ms)}
      {planned ? <span className={cn(over > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")}> ({over > 0 ? "+" : "−"}{mmss(Math.abs(over))})</span> : null}
    </span>
  )
}

/** When an item that has not run yet is now expected, when that is a minute or more off the plan, and a hard stop cutting it short; or that it was skipped. */
function ExpectedLine({ event }: { event?: EventTiming }) {
  if (!event || event.state === "done") return null
  if (event.state === "skipped") return <span className="block text-[0.6875rem] text-muted-foreground">Skipped</span>
  const off = Math.round((event.expectedStart - event.plannedStart) / 60_000)
  return (
    <>
      {event.state === "upcoming" && off !== 0 && (
        <span className={cn("block text-[0.6875rem] tabular-nums", off > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>Expected {wallClock(event.expectedStart)}</span>
      )}
      {event.squeezed && event.hardStop !== null && (
        <span className="block text-[0.6875rem] font-semibold text-destructive" role="status">Cut short to end by {wallClock(event.hardStop)}</span>
      )}
    </>
  )
}
