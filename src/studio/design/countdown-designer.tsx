import { useEffect, useRef, useState } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useBroadcastStore } from "@/stores"
import { useAuxTimers } from "@/stores/aux-timers-store"
import { drawCountdown } from "@/lib/countdown-canvas"
import { countdownText, CountdownFade, DEFAULT_COUNTDOWN_LOOK, MAX_STEPS, parseTimeLeft, stepThresholds, timeLeftText } from "@/lib/countdown-display"
import type { CountdownCounts, CountdownFrame, CountdownLook, CountdownStep } from "@/types"
import { Colour, Row } from "@/studio/design/lower-third-designer"

const COUNTS: ReadonlyArray<readonly [CountdownCounts, string]> = [
  ["timer", "The service timer (Present)"],
  ["item", "The item on now (its planned minutes)"],
  ["aux", "An extra timer (Production → Timekeeper)"],
  ["until", "Time until a time of day"],
  ["start", "Time until the service starts (run of show)"],
]

/** The preview's whole time: a 10-minute timer, or the minutes before a time of day. */
const sampleTotal = (look: CountdownLook) => (look.counts === "until" || look.counts === "start" ? look.leadMinutes : 10) * 60_000

function sampleLabel(look: CountdownLook): string {
  switch (look.counts) {
    case "timer": return "Service timer"
    case "item": return "Sermon"
    case "aux": return look.auxLabel || "Communion prep"
    case "until": return `Until ${look.until || "10:00"}`
    case "start": return "Service starts 10:00"
  }
}

/** A time left typed as "1:30" or seconds; kept as typed until it is a time, then saved. */
function TimeLeft({ seconds, onChange, label }: { seconds: number; onChange: (s: number) => void; label: string }) {
  // What is being typed; null shows the saved time.
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    const s = draft === null ? null : parseTimeLeft(draft)
    if (s !== null) onChange(Math.min(36_000, s))
    setDraft(null)
  }
  return <input aria-label={label} value={draft ?? timeLeftText(seconds)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit() }} placeholder="m:ss" className="h-7 w-16 rounded border border-border bg-background px-1.5 tabular-nums" />
}

/**
 * The countdown display (Design → Countdown): one big time for the stage, a confidence monitor or
 * a TV at the back, whose whole screen changes colour in steps as time runs out. Changes apply at
 * once, on air too. The preview's slider walks the time from the start into overtime, so each step
 * can be seen before Sunday.
 */
export function CountdownDesigner() {
  const look = useBroadcastStore((s) => s.countdownLook)
  const message = useBroadcastStore((s) => s.stageMessage)
  const auxTimers = useAuxTimers((s) => s.timers)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fade = useRef(new CountdownFade())
  const [at, setAt] = useState(100)
  const [sampleMessage, setSampleMessage] = useState(false)
  const save = (next: CountdownLook) => useBroadcastStore.getState().saveCountdownLook(next)
  const patch = (p: Partial<CountdownLook>) => save({ ...look, ...p })
  const patchStep = (i: number, p: Partial<CountdownStep>) => patch({ steps: look.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) })

  const total = sampleTotal(look)
  const leftMs = Math.round((total * at) / 100)
  const stageMessage = sampleMessage ? "Mic 2 is off" : message || null

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d")
    if (!ctx) return
    let raf = 0
    // Drawn as running (so a pulse shows), held at the slider's place; redrawn only while it moves.
    const paint = () => {
      const now = Date.now()
      const frame: CountdownFrame = { look, label: sampleLabel(look), totalMs: total, endsAt: now + leftMs, leftMs, item: "Sermon", next: "Offering", zone: "" }
      if (drawCountdown(ctx, 1280, 720, frame, stageMessage, { now, fade: fade.current }).moving) raf = requestAnimationFrame(paint)
    }
    paint()
    return () => cancelAnimationFrame(raf)
  }, [look, total, leftMs, stageMessage])

  // Quick places on the slider, in the order they come: the start, each step as it comes on, overtime.
  const thresholds = stepThresholds(look.steps, total)
  const jumps = [
    { label: "Start", at: 100 },
    ...look.steps.map((s, i) => ({ label: s.when === "percent" ? `${s.at}%` : s.at === 0 ? "Time's up" : `${timeLeftText(s.at)} left`, at: Math.max(0, Math.min(100, Math.floor((thresholds[i] / total) * 100))) })).sort((a, b) => b.at - a.at),
    { label: "Over", at: -10 },
  ]
  // The slider reads left to right as time passes: the start at the left, 0:00 at 80 % of the
  // track, overtime after it. Its value is the share of the time gone (100 − the share left).
  const OVER = 25
  const zeroAt = 100 / (100 + OVER)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">One big countdown for the stage, a confidence monitor or a TV at the back of the hall. The whole screen changes colour as time runs out, with your messages under the time; over time it counts on in the last step's colours. Changes apply at once, on air too.</p>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
        <div className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-0">
          <canvas ref={canvas} width={1280} height={720} className="aspect-video w-full rounded-lg border border-border" role="img" aria-label={`Countdown display preview at ${countdownText(total, leftMs)}`} />
          <div className="flex items-start gap-3 text-xs">
            <span className="shrink-0 pt-0.5 text-muted-foreground">{look.counts === "until" || look.counts === "start" ? `The last ${look.leadMinutes} minutes` : "A 10-minute timer"} at</span>
            <span className="relative min-w-0 flex-1 pb-4">
              <input
                type="range"
                aria-label="Preview the time left"
                aria-valuetext={at >= 0 ? `${countdownText(total, leftMs)} left` : `${countdownText(total, leftMs)} over`}
                min={0}
                max={100 + OVER}
                step={1}
                value={100 - at}
                onChange={(e) => setAt(100 - Number(e.target.value))}
                className="block w-full accent-primary"
              />
              {/* Where the time is up; overtime is the stretch after it. The thumb is about 16 px wide. */}
              <span aria-hidden className="absolute top-5 flex -translate-x-1/2 flex-col items-center text-[0.6875rem] leading-none text-muted-foreground" style={{ left: `calc(${zeroAt * 100}% + ${(0.5 - zeroAt) * 16}px)` }}>
                <span className="mb-0.5 h-1.5 w-px bg-muted-foreground" />
                0:00
              </span>
              <span aria-hidden className="absolute top-5 right-0 pt-2 text-[0.6875rem] leading-none text-muted-foreground">over</span>
            </span>
            <span className="w-24 shrink-0 pt-0.5 text-right tabular-nums">{countdownText(total, leftMs)} {at >= 0 ? `· ${at}% left` : "· over"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Preview at">
            {jumps.map((j, i) => <Button key={i} size="xs" variant={at === j.at ? "secondary" : "outline"} onClick={() => setAt(j.at)}>{j.label}</Button>)}
            <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" className="size-4" checked={sampleMessage} onChange={(e) => setSampleMessage(e.target.checked)} />
              A sample stage message
            </label>
          </div>
          <p className="text-xs text-muted-foreground">To show it, set a stage output to Countdown (Production → Screens → the output → Who sees it: Stage), or add the ready-made feed “Rhema Countdown” for a TV, OBS or NDI. A confidence monitor is the same: an output that shows this.</p>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Row label="It counts">
            <select aria-label="What the countdown counts" value={look.counts} onChange={(e) => patch({ counts: e.target.value as CountdownCounts })} className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-1.5">
              {COUNTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
          {look.counts === "aux" && (
            <Row label="Timer's name">
              <input aria-label="The extra timer's name" list="countdown-aux-timers" value={look.auxLabel} onChange={(e) => patch({ auxLabel: e.target.value })} placeholder="The first one" className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5" />
              <datalist id="countdown-aux-timers">{auxTimers.map((t) => <option key={t.id} value={t.label} />)}</datalist>
            </Row>
          )}
          {look.counts === "until" && (
            <Row label="Time of day">
              <input type="time" aria-label="The time of day to count down to" value={look.until} onChange={(e) => patch({ until: e.target.value })} className="h-7 rounded border border-border bg-background px-1.5" />
            </Row>
          )}
          {(look.counts === "until" || look.counts === "start") && (
            <Row label="Percentages of">
              <input type="number" aria-label="Minutes the percentages are of" min={1} max={240} value={look.leadMinutes} onChange={(e) => patch({ leadMinutes: Math.min(240, Math.max(1, Math.round(Number(e.target.value) || 1))) })} className="h-7 w-16 rounded border border-border bg-background px-1.5 tabular-nums" />
              <span className="text-muted-foreground">minutes before it</span>
            </Row>
          )}
          {look.counts === "item" && <p className="-mt-1 text-xs text-muted-foreground">From when the item went on air, for its planned minutes (Prepare). An item with its own warning time turns to the first step then.</p>}

          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-xs">
            <span className="text-muted-foreground">Before any step</span>
            <span className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5">background <Colour label="Background before any step" value={look.background} onChange={(background) => patch({ background })} /></label>
              <label className="flex items-center gap-1.5">text <Colour label="Text colour before any step" value={look.text} onChange={(text) => patch({ text })} /></label>
            </span>
          </div>

          <fieldset className="flex flex-col gap-2 text-xs">
            <legend className="mb-1 text-muted-foreground">Colour steps (each holds until a later one comes on; the order here does not matter)</legend>
            {look.steps.map((s, i) => (
              <div key={i} role="group" aria-label={`Step ${i + 1}`} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">At</span>
                  {s.when === "percent" ? (
                    <span className="flex items-center gap-1">
                      <input type="number" aria-label={`Step ${i + 1}: percentage of the time left`} min={0} max={100} value={s.at} onChange={(e) => patchStep(i, { at: Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))) })} className="h-7 w-14 rounded border border-border bg-background px-1.5 tabular-nums" />
                      %
                    </span>
                  ) : (
                    <TimeLeft label={`Step ${i + 1}: time left`} seconds={s.at} onChange={(at) => patchStep(i, { at })} />
                  )}
                  <select aria-label={`Step ${i + 1}: counted as`} value={s.when} onChange={(e) => patchStep(i, e.target.value === "time" ? { when: "time", at: 60 } : { when: "percent", at: 10 })} className="h-7 rounded-md border border-input bg-card px-1.5">
                    <option value="percent">of the time left</option>
                    <option value="time">left (m:ss)</option>
                  </select>
                  <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label={`Remove step ${i + 1}`} onClick={() => patch({ steps: look.steps.filter((_, k) => k !== i) })}><Trash2Icon /></Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Colour label={`Step ${i + 1}: background`} value={s.background} onChange={(background) => patchStep(i, { background })} />
                  <Colour label={`Step ${i + 1}: text colour`} value={s.text} onChange={(text) => patchStep(i, { text })} />
                  <input aria-label={`Step ${i + 1}: message`} value={s.message} maxLength={80} onChange={(e) => patchStep(i, { message: e.target.value })} placeholder="No message" className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5" />
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="size-4" checked={s.pulse} onChange={(e) => patchStep(i, { pulse: e.target.checked })} />
                  Gentle pulse <span className="text-muted-foreground">(a slow glow once a second, while the time runs)</span>
                </label>
              </div>
            ))}
            <div>
              <Button size="xs" variant="outline" disabled={look.steps.length >= MAX_STEPS} onClick={() => patch({ steps: [...look.steps, { when: "percent", at: 5, background: "#c81e1e", text: "#ffffff", message: "", pulse: false }] })}><PlusIcon /> Add a step</Button>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5 text-xs">
            <legend className="mb-1 text-muted-foreground">Also show</legend>
            {([["showMessage", "The stage message from Present or Timekeeper, under the time"], ["showItem", "The item on now, small"], ["showNext", "What is next, small"], ["showClock", "The time of day, in a corner"]] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={look[key]} onChange={(e) => patch({ [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </fieldset>
          <div>
            <Button size="xs" variant="outline" onClick={() => save(DEFAULT_COUNTDOWN_LOOK)}>Back to the built-in look</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
