import { useState } from "react"
import { AlarmClockIcon, PauseIcon, PlayIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { formatMs, isRunning, remainingMs, timerTone } from "@/lib/timer"
import { cn } from "@/lib/utils"
import { MAX_AUX_TIMERS, useAuxTimers } from "@/stores/aux-timers-store"
import { monotonicNow } from "@/stores/timer-store"

const toneClass = (tone: "ok" | "warn" | "over") => (tone === "over" ? "text-destructive" : tone === "warn" ? "text-confidence-mid" : "")

/** Present: a few named countdowns beside the service timer (issue #196), each on its own; any can show on the stage. */
export function AuxTimers() {
  const timers = useAuxTimers((s) => s.timers)
  useAuxTimers((s) => s.tick)
  const now = monotonicNow()
  const [label, setLabel] = useState("")
  const [minutes, setMinutes] = useState("5")
  const running = timers.find((t) => isRunning(t.timer))
  const add = () => {
    const m = Number(minutes)
    if (!label.trim() || !(m > 0)) return
    useAuxTimers.getState().add(label, m)
    setLabel("")
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" title="Other timers: a few named countdowns beside the service timer">
          <AlarmClockIcon className="size-3.5" />
          {running ? <span className={toneClass(timerTone(running.timer, now))}>{running.label} {formatMs(remainingMs(running.timer, now))}</span> : <span className="max-[1200px]:sr-only">Timers</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <p className="mb-2 text-xs text-muted-foreground">Countdowns that run on their own, apart from the service timer. "On stage" shows one on the stage display. For this session only.</p>
        {timers.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1.5">
            {timers.map((t) => {
              const on = isRunning(t.timer)
              return (
                <li key={t.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
                  <span className={cn("w-14 text-right font-semibold tabular-nums", toneClass(timerTone(t.timer, now)))}>{formatMs(remainingMs(t.timer, now))}</span>
                  <Button size="icon-xs" variant="outline" aria-label={`${on ? "Pause" : "Start"} ${t.label}`} onClick={() => useAuxTimers.getState().toggle(t.id)}>{on ? <PauseIcon /> : <PlayIcon />}</Button>
                  <Button size="icon-xs" variant="ghost" aria-label={`Reset ${t.label}`} onClick={() => useAuxTimers.getState().reset(t.id)}><RotateCcwIcon /></Button>
                  <label className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                    <Switch checked={t.onStage} onCheckedChange={(v) => useAuxTimers.getState().setOnStage(t.id, v)} aria-label={`Show ${t.label} on the stage display`} />
                    On stage
                  </label>
                  <Button size="icon-xs" variant="ghost" aria-label={`Remove ${t.label}`} onClick={() => useAuxTimers.getState().remove(t.id)}><XIcon /></Button>
                </li>
              )
            })}
          </ul>
        )}
        {timers.length < MAX_AUX_TIMERS ? (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); add() }}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Communion prep" maxLength={40} aria-label="New timer name" className="h-8 flex-1 text-xs" />
            <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} type="number" min={0.5} max={600} step={0.5} aria-label="Minutes" className="h-8 w-16 text-xs" />
            <span className="text-xs text-muted-foreground">min</span>
            <Button size="sm" type="submit" disabled={!label.trim() || !(Number(minutes) > 0)}><PlusIcon /> Add</Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Up to {MAX_AUX_TIMERS} timers; remove one to add another.</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
