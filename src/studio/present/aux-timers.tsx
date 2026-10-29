import { AlarmClockIcon, PaletteIcon, PauseIcon, PlayIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { formatMs, isRunning, remainingMs, timerTone } from "@/lib/timer"
import { cn } from "@/lib/utils"
import { MAX_AUX_TIMERS, useAuxTimers } from "@/stores/aux-timers-store"
import { useServiceStore } from "@/stores/service-store"
import { REMOTE_ROLES } from "@/lib/remote-roles"
import { useShellStore } from "@/studio/shell-store"
import {
  EMPTY_AUX_TIMER_DRAFT,
  NO_SERVICE_TIMER_DRAFT_KEY,
  usePresentDraftsStore,
} from "@/studio/present/present-drafts-store"

/** Roles a timer can belong to: the specialist desks (the timekeeping desks run every timer anyway). */
const OWNERS = REMOTE_ROLES.filter((r) => !["timekeeper", "present", "configure", "obs-companion"].includes(r.id))

function OwnerSelect({ value, onChange, label }: { value: string; onChange: (owner: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 max-w-28 rounded-md border border-input bg-card px-1 text-[0.6875rem]" title="Besides the Timekeeper and the main desk, the joined desk with this role may start, pause and reset it">
      <option value="">Timekeeper</option>
      {OWNERS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      {value && !OWNERS.some((r) => r.id === value) && <option value={value}>{value}</option>}
    </select>
  )
}
import { monotonicNow } from "@/stores/timer-store"

const toneClass = (tone: "ok" | "warn" | "over") => (tone === "over" ? "text-destructive" : tone === "warn" ? "text-confidence-mid" : "")

/** Present: a few named countdowns beside the service timer (issue #196), each on its own; any can show on the stage. */
export function AuxTimers() {
  const timers = useAuxTimers((s) => s.timers)
  useAuxTimers((s) => s.tick)
  const now = monotonicNow()
  const running = timers.find((t) => isRunning(t.timer))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" title="Other timers: a few named countdowns beside the service timer">
          <AlarmClockIcon className="size-3.5" />
          {running ? <span className={toneClass(timerTone(running.timer, now))}>{running.label} {formatMs(remainingMs(running.timer, now))}</span> : <span className="max-[1200px]:sr-only">Timers</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[30rem] max-w-[calc(100vw-2rem)]">
        <AuxTimersPanel />
      </PopoverContent>
    </Popover>
  )
}

/** The timers themselves: start, pause, reset, show on the stage, remove; add a new one. Also on the Production page. */
export function AuxTimersPanel() {
  const timers = useAuxTimers((s) => s.timers)
  useAuxTimers((s) => s.tick)
  const now = monotonicNow()
  const serviceId = useServiceStore((s) => s.current?.id ?? null)
  const draft = usePresentDraftsStore(
    (s) =>
      s.auxTimerDrafts[
        serviceId ?? NO_SERVICE_TIMER_DRAFT_KEY
      ] ?? EMPTY_AUX_TIMER_DRAFT,
  )
  const { label, minutes, owner } = draft
  const updateAuxTimer = usePresentDraftsStore((s) => s.updateAuxTimer)
  const service = useServiceStore((s) => s.current?.title ?? null)
  const add = () => {
    const m = Number(minutes)
    if (!label.trim() || !(m > 0)) return
    const countBeforeAdd = useAuxTimers.getState().timers.length
    useAuxTimers.getState().add(label, m, owner)
    if (useAuxTimers.getState().timers.length > countBeforeAdd) {
      usePresentDraftsStore.getState().updateAuxTimer(serviceId, { label: "" })
    }
  }
  return (
    <>
    <p className="mb-2 text-xs text-muted-foreground">Countdowns that run on their own, apart from the service timer. "On stage" shows one on the stage display. Joined desks see them; the Timekeeper, and the desk a timer belongs to, can run them. {service ? `Kept with “${service}” (names, lengths and who runs them).` : "For this session only: open or save a service to keep them with it."}</p>
    {timers.length > 0 && (
      <ul className="mb-3 flex flex-col gap-1.5">
        {timers.map((t) => {
          const on = isRunning(t.timer)
          return (
            <li key={t.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
              <span className={cn("w-14 text-right font-semibold tabular-nums", toneClass(timerTone(t.timer, now)))}>{formatMs(remainingMs(t.timer, now))}</span>
              <Button size="icon-xs" variant="outline" className="size-8" aria-label={`${on ? "Pause" : "Start"} ${t.label}`} onClick={() => useAuxTimers.getState().toggle(t.id)}>{on ? <PauseIcon /> : <PlayIcon />}</Button>
              <Button size="icon-xs" variant="ghost" className="size-8" aria-label={`Reset ${t.label}`} onClick={() => useAuxTimers.getState().reset(t.id)}><RotateCcwIcon /></Button>
              <OwnerSelect label={`Who runs ${t.label}`} value={t.owner} onChange={(o) => useAuxTimers.getState().setOwner(t.id, o)} />
              <label className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                <Switch checked={t.onStage} onCheckedChange={(v) => useAuxTimers.getState().setOnStage(t.id, v)} aria-label={`Show ${t.label} on the stage display`} />
                On stage
              </label>
              <Button size="icon-xs" variant="ghost" className="size-8" aria-label={`Remove ${t.label}`} onClick={() => useAuxTimers.getState().remove(t.id)}><XIcon /></Button>
            </li>
          )
        })}
      </ul>
    )}
    {timers.length < MAX_AUX_TIMERS ? (
      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); add() }}>
        <Input value={label} onChange={(e) => updateAuxTimer(serviceId, { label: e.target.value })} placeholder="Communion prep" maxLength={40} aria-label="New timer name" className="h-8 flex-1 text-xs" />
        <Input value={minutes} onChange={(e) => updateAuxTimer(serviceId, { minutes: e.target.value })} type="number" min={0.5} max={600} step={0.5} aria-label="Minutes" className="h-8 w-16 text-xs" />
        <span className="text-xs text-muted-foreground">min</span>
        <OwnerSelect label="Who runs the new timer" value={owner} onChange={(value) => updateAuxTimer(serviceId, { owner: value })} />
        <Button size="sm" type="submit" disabled={!label.trim() || !(Number(minutes) > 0)}><PlusIcon /> Add</Button>
      </form>
    ) : (
      <p className="text-xs text-muted-foreground">Up to {MAX_AUX_TIMERS} timers; remove one to add another.</p>
    )}
    <div className="mt-3 border-t border-border pt-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full"
        title="Design the countdown display"
        onClick={() => useShellStore.getState().openDesign("countdown")}
      >
        <PaletteIcon /> Design countdown display…
      </Button>
    </div>
    </>
  )
}
