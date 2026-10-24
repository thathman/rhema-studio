import { LockIcon, PinIcon } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useQueueStore } from "@/stores"
import { cuesheet, pauseWords } from "@/lib/cuesheet"
import { mmss } from "@/lib/journal"
import { clockText } from "@/lib/run-of-show"
import { formatMinutes } from "@/lib/service-timing"
import { cn } from "@/lib/utils"
import { DurationInput } from "@/studio/prepare/item-editor-parts"
import { useServiceTiming } from "@/studio/use-service-timing"

const wallClock = (ms: number) => { const d = new Date(ms); return clockText(d.getHours() * 60 + d.getMinutes()) }
const offsetText = (m: number) => (m === 0 ? "on time" : `${m > 0 ? "+" : "−"}${formatMinutes(Math.abs(m) * 60_000)}`)
const STATUS = { done: "Done", live: "On now", upcoming: "", skipped: "Skipped" } as const

/**
 * The run of show as a cuesheet (#196): plan, actual, expected and offset side by side for every
 * item of the main service, the time typed in place. The plan changes only when a time is typed;
 * running late moves what is expected. A fixed start has a pin; a pause before an item is its own
 * thin row with how much lateness it takes up.
 */
export function CuesheetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const { timing, onAir } = useServiceTiming()
  const rows = timing ? cuesheet(timing, headers, items.length, onAir) : []
  const th = "px-2 py-1.5 text-left text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase"
  const td = "px-2 py-1 tabular-nums"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Run of show</DialogTitle>
          <DialogDescription>The plan, what happened and what is now expected. Typing a time changes the plan; running late moves only what is expected. A pinned item has a fixed start: it keeps its time, and ±5 min does not move it. A pause takes up lateness before anything after it moves.</DialogDescription>
        </DialogHeader>
        {!timing ? (
          <p className="text-sm text-muted-foreground">Set the main service's start time to see the run of show.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="border-b border-border">
                <tr>
                  <th className={th}>Item</th><th className={th}>Plan start</th><th className={th}>Plan end</th><th className={cn(th, "w-24")}>Time</th>
                  <th className={th}>Actual</th><th className={th}>Expected</th><th className={th}>Offset</th><th className={th}>End by</th><th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) =>
                  r.kind === "group" ? (
                    <tr key={r.id} className="border-t border-border bg-surface-sunken font-semibold">
                      <td className="px-2 py-1">{r.name}</td>
                      <td className={td}>{wallClock(r.plannedStart)}</td>
                      <td className={td}>{wallClock(r.plannedEnd)}</td>
                      <td className={td}>{formatMinutes(r.minutes * 60_000) || "—"}</td>
                      <td />
                      <td className={td}>ends {wallClock(r.expectedEnd)}</td>
                      <td colSpan={3} />
                    </tr>
                  ) : r.kind === "gap" ? (
                    <GapRow key={r.id} minutes={r.minutes} absorbed={r.absorbedMinutes} beforeFixed={r.beforeFixed} />
                  ) : (
                    <tr key={r.event.id} className={cn("border-t border-border/60", r.event.state === "live" && "bg-primary/10", r.event.state === "skipped" && "text-muted-foreground")}>
                      <td className="max-w-56 truncate px-2 py-1">{r.event.label}</td>
                      <td className={td}>
                        {r.event.fixedStart !== null ? (
                          <span className="inline-flex items-center gap-1" title="A fixed start: it keeps this time whatever runs before it">
                            <PinIcon className="size-3" aria-label="Fixed start" />{wallClock(r.event.plannedStart)}
                          </span>
                        ) : wallClock(r.event.plannedStart)}
                      </td>
                      <td className={td}>{wallClock(r.event.plannedEnd)}</td>
                      <td className="px-2 py-1">
                        <DurationInput
                          aria-label={`Planned time for ${r.event.label}`}
                          minutes={r.minutes || null}
                          onChange={(m) => useQueueStore.getState().updateItem(r.event.id, (i) => ({ ...i, planned_minutes: m }))}
                        />
                      </td>
                      <td className={td}>{r.event.actualStart === null ? "" : `${wallClock(r.event.actualStart)} · ${mmss(r.actualMs ?? 0)}`}</td>
                      <td className={td}>{r.event.state === "done" || r.event.state === "skipped" ? "" : `${wallClock(r.event.expectedStart)}–${wallClock(r.event.expectedEnd)}`}</td>
                      <td className={cn(td, r.offsetMinutes !== null && r.offsetMinutes > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>{r.offsetMinutes === null ? "" : offsetText(r.offsetMinutes)}</td>
                      <td className={td}>
                        {r.event.hardStop !== null && (
                          <span className="inline-flex items-center gap-1" title="A hard stop: the time it may take is cut to fit">
                            <LockIcon className="size-3" aria-hidden />{wallClock(r.event.hardStop)}
                          </span>
                        )}
                      </td>
                      <td className={cn("px-2 py-1", r.event.squeezed ? "font-semibold text-destructive" : r.event.conflict && "font-semibold text-confidence-mid")}>{r.event.squeezed ? "Cut short" : r.event.conflict ? "Late for its fixed start" : STATUS[r.event.state]}</td>
                    </tr>
                  ),
                )}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td className="px-2 py-1.5">Main service</td>
                  <td className={td}>{wallClock(timing.start)}</td>
                  <td className={td}>{wallClock(timing.plannedEnd)}</td>
                  <td className={td}>{formatMinutes(timing.plannedEnd - timing.start) || "—"}</td>
                  <td />
                  <td className={td}>ends {wallClock(timing.expectedEnd)}</td>
                  <td className={cn(td, timing.lateMs > 30_000 && "text-confidence-mid")}>{offsetText(Math.round(timing.lateMs / 60_000))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** A planned pause before an item: a thin row, with how much lateness it is expected to take up. */
function GapRow({ minutes, absorbed, beforeFixed }: { minutes: number; absorbed: number | null; beforeFixed: boolean }) {
  const words = pauseWords(minutes, absorbed, beforeFixed)
  return (
    <tr className="border-t border-dashed border-border/60 text-[0.6875rem] text-muted-foreground">
      <td className="px-2 py-0.5 italic">{words.label}</td>
      <td colSpan={4} />
      <td colSpan={4} className={cn("px-2 py-0.5", absorbed !== null && absorbed > 0 && "font-semibold text-confidence-mid")}>{words.absorbs}</td>
    </tr>
  )
}
