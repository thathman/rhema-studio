import { PauseIcon, PlayIcon, RotateCcwIcon, TimerIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { elapsedMs, formatMs, isRunning, remainingMs, timerTone } from "@/lib/timer"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"

const PRESETS = [20, 30, 45, 60]

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
  const tone = timerTone(timer, now)
  const label = timer.durationMs > 0 ? formatMs(remainingMs(timer, now)) : formatMs(elapsedMs(timer, now))
  const idle = !running && elapsedMs(timer, now) === 0
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
          {tone === "over" && <span className="text-[0.625rem] font-bold uppercase">over</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-2 text-xs text-muted-foreground">Counts on a clock that cannot be changed by the computer's time. Only you see it.</p>
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
          <Button size="sm" variant="ghost" disabled={idle} onClick={() => useTimerStore.getState().reset()}><RotateCcwIcon /> Reset</Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatMs(elapsedMs(timer, now))} elapsed</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
