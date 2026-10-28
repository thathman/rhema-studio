import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useBroadcastStore } from "@/stores"
import { drawStage } from "@/lib/stage-canvas"
import { applyStageStyle, DEFAULT_STAGE_STYLE } from "@/lib/stage-style"
import type { StagePayload, StageStyle } from "@/types"
import { Colour, Row } from "@/studio/design/lower-third-designer"
import { CountdownSelect } from "@/studio/production/countdown-select"
import { stageClock } from "@/lib/stage-clock"
import { validTimeZone } from "@/lib/church-time"
import { useSettingsStore } from "@/stores/settings-store"
import { normalizeStageStyle } from "@/lib/stage-style"
import { DesignDraftActions } from "@/studio/design/design-draft-actions"
import { useDesignDraft } from "@/studio/design/use-design-draft"

/** What the preview shows: a verse live, the timer running, a note and the next item. */
const SAMPLE: StagePayload = {
  current: { title: "John 3:16 (KJV)", lines: ["For God so loved the world, that he gave his only begotten Son,", "that whosoever believeth in him should not perish, but have everlasting life."] },
  next: "Offering",
  note: "Pastor reads from the pulpit",
  timer: { label: "12:40", tone: "ok" },
  message: null,
  band: "Key G · 72 bpm",
  finish: { time: "11:42", lateMin: 5 },
  aux: [{ label: "Communion prep", text: "3:12", tone: "ok" }, { label: "Interpreter", text: "0:45", tone: "warn" }],
}

const PARTS: ReadonlyArray<readonly [keyof StageStyle, string]> = [
  ["showTimer", "The timer"],
  ["showNext", "What is next"],
  ["showNote", "The item's note"],
  ["showBand", "Song key and tempo"],
  ["showFinish", "When the service ends"],
]

/** Zones offered for the second clock (any IANA zone can be typed). */
const ZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []
  } catch {
    return []
  }
})()

/** A time zone typed or picked; kept as typed until it is one this computer knows (or empty), then saved. */
function ZoneInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (zone: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const type = (v: string) => {
    setDraft(v)
    if (!v.trim() || validTimeZone(v.trim())) onChange(v.trim())
  }
  const unknown = draft !== null && draft.trim() !== "" && !validTimeZone(draft.trim())
  return (
    <>
      <input aria-label="Second time zone" aria-invalid={unknown || undefined} list="stage-time-zones" value={draft ?? value} disabled={disabled} onChange={(e) => type(e.target.value)} onBlur={() => setDraft(null)} placeholder="Europe/London" className="h-7 w-40 rounded border border-border bg-background px-1.5" />
      {unknown && <span className="text-destructive">Not a time zone this computer knows</span>}
    </>
  )
}

/** The stage display (DS-004): what the team on the platform sees. Edits stay in a draft until applied. */
export function StageDesigner() {
  const publishedStyle = useBroadcastStore((s) => s.stageStyle)
  const outputs = useBroadcastStore((s) => s.outputs)
  const draft = useDesignDraft("stage", "default", publishedStyle, normalizeStageStyle)
  const style = draft.value
  const zone = useSettingsStore((s) => s.setup.timeZone)
  const canvas = useRef<HTMLCanvasElement>(null)
  const patch = (p: Partial<StageStyle>) => draft.update(normalizeStageStyle({ ...style, ...p }))
  const liveOutputs = outputs.filter((output) => output.role === "stage").map((output) => output.name)
  const apply = () => useBroadcastStore.getState().saveStageStyle(normalizeStageStyle(style))
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d")
    // A countdown chosen shows first on the timers' line, as on the real stage.
    const sample = style.countdown ? { ...SAMPLE, aux: [{ label: style.countdown === "next" ? "Next: Sermon in" : "End of the main service in", text: "4:12", tone: "ok" as const }, ...(SAMPLE.aux ?? [])] } : SAMPLE
    const clock = stageClock(Date.now(), style, validTimeZone(zone))
    if (ctx) drawStage(ctx, 1280, 720, applyStageStyle(clock ? { ...sample, clock } : sample, style))
  }, [style, zone])
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">What the team on the platform sees on the stage display (a screen or an NDI viewer): the live words, the timer, what is next and your messages. Preview and save a draft here; applying is deliberate.</p>
      <DesignDraftActions
        dirty={draft.dirty}
        saved={draft.saved}
        scope="all Stage outputs using this shared stage design"
        outputs={liveOutputs}
        onSave={draft.save}
        onDiscard={draft.discard}
        onApply={apply}
        onApplied={draft.markApplied}
      />
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
        <div className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-0">
          <canvas ref={canvas} width={1280} height={720} className="aspect-video w-full rounded-lg border border-border" role="img" aria-label="Stage display preview: a verse live, the timer, a note and what is next" />
          <p className="text-xs text-muted-foreground">A sample service. Messages you send from Present appear boxed under the top line.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Row label="Background"><Colour label="Background colour" value={style.background} onChange={(background) => patch({ background })} /></Row>
          <Row label="Words"><Colour label="Words colour" value={style.words} onChange={(words) => patch({ words })} /></Row>
          <Row label="Words size">
            <span className="flex items-center gap-1.5">
              <input type="range" aria-label="Words size" min={70} max={160} step={5} value={Math.round(style.wordsScale * 100)} onChange={(e) => patch({ wordsScale: Number(e.target.value) / 100 })} className="w-28 accent-primary" />
              <span className="w-10 tabular-nums">{Math.round(style.wordsScale * 100)}%</span>
            </span>
          </Row>
          <fieldset className="flex flex-col gap-1.5 text-xs">
            <legend className="mb-1 text-muted-foreground">Show</legend>
            {PARTS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={style[key] as boolean} onChange={(e) => patch({ [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </fieldset>
          <Row label="Countdown">
            <CountdownSelect label="Stage countdown" off="None" value={style.countdown} onChange={(countdown) => patch({ countdown })} className="h-7 text-xs" />
          </Row>
          <p className="-mt-2 text-xs text-muted-foreground">Time until the next item or a milestone, from the run of show; it shows how far over once it is due.</p>
          <fieldset className="flex flex-col gap-1.5 text-xs">
            <legend className="mb-1 text-muted-foreground">Time of day</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={!!style.showClock} onChange={(e) => patch({ showClock: e.target.checked || undefined })} />
              Show the time of day
            </label>
            <span className="flex flex-wrap items-center gap-2">
              <select aria-label="12- or 24-hour clock" value={style.clockHours ?? 24} disabled={!style.showClock} onChange={(e) => patch({ clockHours: Number(e.target.value) === 12 ? 12 : undefined })} className="h-7 rounded-md border border-input bg-card px-1.5">
                <option value={24}>24-hour (14:05)</option>
                <option value={12}>12-hour (2:05 PM)</option>
              </select>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Second time zone</span>
              <ZoneInput value={style.secondZone ?? ""} disabled={!style.showClock} onChange={(secondZone) => patch({ secondZone: secondZone || undefined })} />
              <input aria-label="What the second time zone is called" value={style.secondZoneLabel ?? ""} disabled={!style.showClock || !style.secondZone} maxLength={24} onChange={(e) => patch({ secondZoneLabel: e.target.value || undefined })} placeholder="London" className="h-7 w-28 rounded border border-border bg-background px-1.5" />
              <datalist id="stage-time-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
            </span>
            <span className="text-muted-foreground">On the church's clock (Setup → time zone). The countdown display uses the same choices. A zone this computer does not know is not kept.</span>
          </fieldset>
          <fieldset className="flex flex-col gap-1.5 text-xs">
            <legend className="mb-1 text-muted-foreground">Time warnings (a message on the stage while the timer runs)</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={style.warnAtMinutes > 0} onChange={(e) => patch({ warnAtMinutes: e.target.checked ? 5 : 0 })} />
              At
              <input type="number" aria-label="Minutes left for the warning" min={1} max={30} disabled={style.warnAtMinutes === 0} value={style.warnAtMinutes || 5} onChange={(e) => patch({ warnAtMinutes: Math.min(30, Math.max(1, Math.round(Number(e.target.value) || 1))) })} className="h-6 w-12 rounded border border-border bg-background px-1 tabular-nums" />
              minutes left
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={style.warnWhenOver} onChange={(e) => patch({ warnWhenOver: e.target.checked })} />
              When the time is up
            </label>
            <span className="text-muted-foreground">Only the stage sees it; a message you sent is never covered, and nothing else changes.</span>
          </fieldset>
          <div>
            <Button size="xs" variant="outline" onClick={() => draft.update(normalizeStageStyle(DEFAULT_STAGE_STYLE))}>Reset draft to the built-in look</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
