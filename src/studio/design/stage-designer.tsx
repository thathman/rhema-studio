import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { useBroadcastStore } from "@/stores"
import { drawStage } from "@/lib/stage-canvas"
import { applyStageStyle, DEFAULT_STAGE_STYLE } from "@/lib/stage-style"
import type { StagePayload, StageStyle } from "@/types"
import { Colour, Row } from "@/studio/design/lower-third-designer"

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

/** The stage display (DS-004): what the team on the platform sees. Changes apply at once, also on air. */
export function StageDesigner() {
  const style = useBroadcastStore((s) => s.stageStyle)
  const canvas = useRef<HTMLCanvasElement>(null)
  const patch = (p: Partial<StageStyle>) => useBroadcastStore.getState().saveStageStyle({ ...style, ...p })
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d")
    if (ctx) drawStage(ctx, 1280, 720, applyStageStyle(SAMPLE, style))
  }, [style])
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">What the team on the platform sees on the stage display (a screen or an NDI viewer): the live words, the timer, what is next and your messages. Changes apply at once. The congregation never sees it.</p>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
        <div className="flex min-w-0 flex-col gap-2 xl:sticky xl:top-0">
          <canvas ref={canvas} width={1280} height={720} className="aspect-video w-full rounded-lg border border-border" role="img" aria-label="Stage display preview: a verse live, the timer, a note and what is next" />
          <p className="text-[0.6875rem] text-muted-foreground">A sample service. Messages you send from Present appear boxed under the top line.</p>
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
          <div>
            <Button size="xs" variant="outline" onClick={() => useBroadcastStore.getState().saveStageStyle(DEFAULT_STAGE_STYLE)}>Back to the built-in look</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
