import { useEffect, useState } from "react"
import { PauseIcon, PlayIcon, RotateCcwIcon, TimerIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { elapsedMs, formatMs, isRunning, remainingMs, timerTone } from "@/lib/timer"
import { monotonicNow, wallAt, useTimerStore } from "@/stores/timer-store"
import { useJournalStore } from "@/stores/journal-store"
import { resetTimerLogged } from "@/lib/timer-reset"
import { useQueueStore } from "@/stores"
import { endByLeftMs, formatMinutes, projectedEnd, timingSummary } from "@/lib/service-timing"
import { useServiceTiming } from "@/studio/use-service-timing"
import { useHold } from "@/stores/hold-store"
import { timeText } from "@/lib/church-time"
import { churchTimeZone } from "@/stores/timing-input"

const PRESETS = [20, 30, 45, 60]
/** Manual timing correction, with its line in the service log (FR-07 "with audit"). */
function correct(minutes: number) {
  useTimerStore.getState().adjustMinutes(minutes)
  useJournalStore.getState().add({ kind: "timing", label: `timer corrected by ${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} min` })
}


/**
 * The service timer, in the Present header: counts the sermon or the whole
 * service and turns amber under two minutes, red when over. Operator-only;
 * nothing here reaches an output.
 */
export function ServiceTimer() {
  const timer = useTimerStore((s) => s.timer)
  useTimerStore((s) => s.tick)
  const now = monotonicNow()
  const running = isRunning(timer)
  // With phases and a start time, the run of show's timing engine; otherwise from when the timer started.
  const { timing, zone } = useServiceTiming()
  // The item happening may warn earlier or later than two minutes before its end (#196 R1.3).
  const tone = timerTone(timer, now, timing?.events.find((e) => e.state === "live")?.warnMs)
  const label = timer.durationMs > 0 ? formatMs(remainingMs(timer, now)) : formatMs(elapsedMs(timer, now))
  const idle = !running && elapsedMs(timer, now) === 0
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const plan = timingSummary(items, idle ? null : activeIndex, elapsedMs(timer, now))
  const behind = plan.behindMs === null ? null : Math.round(plan.behindMs / 60_000)
  const ends = timing ? { plannedEnd: timing.plannedEnd, expectedEnd: timing.expectedEnd } : projectedEnd(plan, elapsedMs(timer, now), wallAt(now))
  // The item in hand may have to finish by a clock time ("sermon ends by 12:15").
  const endBy = activeIndex !== null ? items[activeIndex]?.end_by ?? null : null
  const endByLeft = endByLeftMs(endBy, wallAt(now), zone)
  const [armReset, setArmReset] = useState(false)
  // The timer store only ticks while the service timer runs; an end-by countdown must move regardless.
  const [, setClock] = useState(0)
  useEffect(() => {
    if (!endBy) return
    const id = setInterval(() => setClock((c) => c + 1), 5000)
    return () => clearInterval(id)
  }, [endBy])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
            tone === "over" && "border-destructive/50 text-destructive",
            tone === "warn" && "text-confidence-mid"
          )}
          title="Service timer"
          aria-label={`Service timer ${idle ? "not started" : label}`}
        >
          <TimerIcon className="size-3.5" />
          {idle ? "Timer" : label}
          {tone === "over" && <span className="text-[0.6875rem] font-bold uppercase">over</span>}
          {endBy && endByLeft !== null && (
            <span
              className={cn("text-[0.6875rem] font-semibold", endByLeft < 0 ? "text-destructive" : endByLeft <= 120_000 ? "text-confidence-mid" : "text-muted-foreground")}
              title={`This item should finish by ${endBy}`}
            >
              {endByLeft < 0 ? `past ${endBy} by ${Math.max(1, Math.floor(-endByLeft / 60_000))} min` : `by ${endBy} · ${Math.ceil(endByLeft / 60_000)} min`}
            </span>
          )}
          {behind !== null && behind !== 0 && (
            <span className={cn("text-[0.6875rem] font-semibold", behind > 0 ? "text-destructive" : "text-confidence-high")} title="Against the planned minutes of the items so far">
              {behind > 0 ? `${behind} min late` : `${-behind} min early`}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-xs text-muted-foreground">Counts on a clock that cannot be changed by the computer's time. Only you see it.{plan.totalMs ? ` The service plan is ${formatMinutes(plan.totalMs)}.` : ""}</p>
        <div className="mb-2 flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="timer-minutes">Planned</label>
          <Input
            id="timer-minutes"
            type="number"
            min={0}
            max={600}
            value={Math.round(timer.durationMs / 60_000) || ""}
            placeholder="min"
            onChange={(e) => useTimerStore.getState().setDurationMinutes(Number(e.target.value) || 0)}
            className="h-8 w-20 text-xs"
          />
          <span className="text-xs text-muted-foreground">min (blank = count up)</span>
        </div>
        <div className="mb-3 flex flex-wrap gap-1">
          {PRESETS.map((m) => (
            <Button key={m} variant="outline" size="xs" onClick={() => useTimerStore.getState().setDurationMinutes(m)}>{m} min</Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <Button size="sm" onClick={() => useTimerStore.getState().pause()}><PauseIcon /> Pause</Button>
          ) : (
            <Button size="sm" onClick={() => useTimerStore.getState().start()}><PlayIcon /> {idle ? "Start" : "Resume"}</Button>
          )}
          <Button
            size="sm"
            variant={armReset ? "destructive" : "ghost"}
            disabled={idle}
            onClick={() => {
              // A minute or more would be lost: ask once (FR-07 "explicit confirm"), and log it.
              if (!armReset && elapsedMs(timer, now) >= 60_000) {
                setArmReset(true)
                setTimeout(() => setArmReset(false), 5000) // asks again later rather than staying armed
                return
              }
              setArmReset(false)
              resetTimerLogged()
            }}
          >
            <RotateCcwIcon /> {armReset ? `Reset ${formatMs(elapsedMs(timer, now))}?` : "Reset"}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatMs(elapsedMs(timer, now))} elapsed</span>
        </div>
        {ends && (
          <p className="mt-2 text-xs tabular-nums">
            Planned end {timeText(ends.plannedEnd, zone)}
            {Math.abs(ends.expectedEnd - ends.plannedEnd) >= 60_000 && (
              <span className={cn("font-semibold", ends.expectedEnd > ends.plannedEnd ? "text-destructive" : "text-confidence-high")}> · now about {timeText(ends.expectedEnd, zone)}</span>
            )}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Correct the timer</span>
          <Button size="xs" variant="outline" disabled={idle} onClick={() => correct(-1)}>−1 min</Button>
          <Button size="xs" variant="outline" disabled={idle} onClick={() => correct(1)}>+1 min</Button>
          <span className="text-muted-foreground">(noted in the service log)</span>
        </div>
        <HoldControl />
      </PopoverContent>
    </Popover>
  )
}

/** Hold the service with a reason (issue #196): logged, on the stage display; loops and timed moves wait until Resume. */
export function HoldControl() {
  const hold = useHold((s) => s.hold)
  const [reason, setReason] = useState("")
  // Refused by the run state (#196 R3.7): a finished service has nothing to hold.
  const [refused, setRefused] = useState<string | null>(null)
  if (hold) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md border border-confidence-mid/40 bg-confidence-mid/10 px-2 py-1.5 text-xs" role="status">
        <span className="min-w-0 flex-1"><b>On hold</b> since {timeText(hold.since, churchTimeZone())}: {hold.reason}{hold.by ? ` · by ${hold.by}` : ""}</span>
        <Button size="xs" onClick={() => useHold.getState().resume()}>Resume</Button>
      </div>
    )
  }
  return (
    <form className="mt-3 flex items-center gap-1.5 text-xs" onSubmit={(e) => { e.preventDefault(); setRefused(useHold.getState().start(reason)); setReason("") }}>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. waiting for the pastor" maxLength={80} aria-label="Reason for the hold" className="h-7 flex-1 text-xs" />
      <Button size="xs" variant="outline" type="submit" title="Hold: noted in the service log and shown on the stage display; loops and timed moves wait until Resume">Hold</Button>
      {refused && <span className="text-muted-foreground" role="status">{refused}</span>}
    </form>
  )
}
