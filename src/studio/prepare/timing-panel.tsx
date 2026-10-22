import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useQueueStore } from "@/stores"
import { presentActions } from "@/studio/present-actions"
import { formatMinutes, plannedTotalMs } from "@/lib/service-timing"
import { planTimeline } from "@/lib/run-of-show"
import { cn } from "@/lib/utils"

function Clock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-sunken px-2.5 py-2">
      <p className="text-[0.625rem] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tracking-[-0.03em] tabular-nums">{value}</p>
    </div>
  )
}

/**
 * Run of show timing: the main service's start, when the warm-up begins, the
 * projected finish and each item's planned time. ±5 min moves only the
 * projection (running late or early); the plan stays as prepared.
 */
export function TimingPanel() {
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const [delay, setDelay] = useState(0)
  const main = headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual")
  const plan = planTimeline(items, headers, delay)
  const total = formatMinutes(plannedTotalMs(items))
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[17px] border border-border bg-card shadow-panel">
      <div className="border-b border-border px-4 py-3">
        <p className="text-[0.625rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Run of show</p>
        <h2 className="text-sm font-semibold">Timing{total ? ` · ${total} planned` : ""}</h2>
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
                <Clock label="Finish" value={plan.finish} />
              </div>
              <div className="flex items-center justify-between gap-2" role="group" aria-label="Running late or early">
                <Button size="xs" variant="outline" onClick={() => setDelay((d) => d - 5)}>−5 min</Button>
                <span className={cn("text-xs font-semibold", delay > 0 ? "text-confidence-mid" : "text-muted-foreground")}>{delay === 0 ? "On schedule" : delay > 0 ? `${delay} min late` : `${-delay} min early`}</span>
                <Button size="xs" variant="outline" onClick={() => setDelay((d) => d + 5)}>+5 min</Button>
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
