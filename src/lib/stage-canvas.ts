import type { StagePayload, StageRoleLayout } from "@/types"
import { stageFinishText } from "@/lib/stage-finish-text"
import { stageFontVh } from "@/lib/stage"
import { drawCountdown, type CountdownDrawOptions } from "@/lib/countdown-canvas"

/** Words wrapped to `maxW` (the stage view's lines, as the browser would wrap them). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  let line = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxW) {
      out.push(line)
      line = word
    } else line = next
  }
  if (line) out.push(line)
  return out.length ? out : [""]
}

/**
 * The stage display drawn on a canvas, laid out like StageView (title and
 * timer, the operator's message, the live words, note and next), so a stage
 * output can go out over NDI to a viewer. A countdown display draws only its countdown; it says
 * whether it moves (a pulse or a blend), so the caller draws again soon.
 */
export function drawStage(ctx: CanvasRenderingContext2D, width: number, height: number, stage: StagePayload, opts?: Partial<CountdownDrawOptions>): { moving: boolean } {
  // A screen on its side shown on a landscape picture (a TV, NDI): turned a quarter turn, drawn tall.
  if (stage.portrait && width > height) {
    ctx.save()
    if (stage.portrait === "cw") {
      // The screen turned clockwise: its left edge is now the top, so the picture turns the other way.
      ctx.translate(0, height)
      ctx.rotate(-Math.PI / 2)
    } else {
      ctx.translate(width, 0)
      ctx.rotate(Math.PI / 2)
    }
    const r = drawStageUpright(ctx, height, width, stage, opts)
    ctx.restore()
    return r
  }
  return drawStageUpright(ctx, width, height, stage, opts)
}

/** How each role's layout weighs the parts (#196 R6): sizes as multiples of the full view's, and which parts it has. */
interface RoleLayout {
  timer: number
  words: number
  band: number
  showBand: boolean
  showAux: boolean
  showFinish: boolean
  showNote: boolean
}
export const ROLE_LAYOUTS: Record<"full" | StageRoleLayout, RoleLayout> = {
  full: { timer: 1, words: 1, band: 1, showBand: true, showAux: true, showFinish: true, showNote: true },
  // The pastor's confidence monitor: the words and a big timer; no band details or extra timers.
  pastor: { timer: 2, words: 1.1, band: 1, showBand: false, showAux: false, showFinish: true, showNote: true },
  // The band: key and tempo large, the lyrics; no finish line or extra timers.
  band: { timer: 1, words: 1, band: 2, showBand: true, showAux: false, showFinish: false, showNote: true },
  // The stage manager: every timer and time, the words smaller.
  manager: { timer: 1.4, words: 0.7, band: 1, showBand: true, showAux: true, showFinish: true, showNote: true },
}

/** Low-light colours (#196 R6): dim and warm on black, so eyes adjusted to a dark platform are not dazzled. */
const NIGHT = { background: "#000000", words: "#c8613f", soft: "#7a4636", ok: "#a0603a", warn: "#c88a3a", over: "#d0452e", note: "#a87a3a", boxBg: "#140800", boxInk: "#c87a3a" }
const DAY = { soft: "#9aa0a6", ok: "#9be37a", warn: "#ffc547", over: "#ff5a5a", note: "#ffd166", boxBg: "#2a2000", boxInk: "#ffd166" }

/** Whether this stage frame is drawn on the canvas (the countdown, a role's layout, a screen on its side, night, the clock) rather than as the plain stage page. */
export function stageOnCanvas(stage: StagePayload): boolean {
  return !!(stage.countdown || stage.layout || stage.portrait || stage.night || stage.clock)
}

/** The picture size for a stage frame on a screen of this shape: tall for a screen on its side that is itself tall (a monitor set to portrait). */
export function stageSurface(stage: StagePayload, viewW: number, viewH: number): { width: number; height: number } {
  return stage.portrait && viewH > viewW ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }
}

function drawStageUpright(ctx: CanvasRenderingContext2D, width: number, height: number, stage: StagePayload, opts?: Partial<CountdownDrawOptions>): { moving: boolean } {
  if (stage.countdown) return drawCountdown(ctx, width, height, stage.countdown, stage.message, { now: opts?.now ?? Date.now(), fade: opts?.fade })
  const tall = height > width
  // Sizes follow the shorter side, so a tall screen reads like a landscape one turned.
  const vh = (tall ? width : height) / 100
  const vw = width / 100
  const padX = 4 * vw
  const font = (px: number, weight = 400) => `${weight} ${Math.round(px)}px system-ui, sans-serif`
  const style = stage.style
  const L = ROLE_LAYOUTS[stage.layout ?? "full"]
  const ink = stage.night ? { ...NIGHT } : { ...DAY, background: style?.background ?? "#000", words: style?.words ?? "#fff" }
  const timerTone = (tone: "ok" | "warn" | "over") => (tone === "over" ? ink.over : tone === "warn" ? ink.warn : ink.ok)
  const band = L.showBand ? stage.band : null
  const finish = L.showFinish ? stage.finish : null
  const aux = L.showAux ? stage.aux : undefined
  const note = L.showNote ? stage.note : null
  ctx.save()
  ctx.fillStyle = stage.night ? NIGHT.background : style?.background ?? "#000"
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = "alphabetic"

  // Top: what is live, the band's key, the timer. A big timer (or a tall screen) gets a line of its own.
  const timerPx = 5 * vh * L.timer
  const timerOwnLine = !!stage.timer && (L.timer > 1 || tall)
  let y = 3 * vh + 5 * vh
  ctx.font = font(3.2 * vh)
  ctx.fillStyle = ink.soft
  ctx.textAlign = "left"
  ctx.fillText(stage.current?.title ?? "Nothing live", padX, y, width * (tall ? 0.5 : 0.45))
  let right = width - padX
  // The time of day (and a second zone) at the right of the top line (#196 R2.6).
  if (stage.clock) {
    ctx.font = font(3.2 * vh, 600)
    ctx.fillStyle = ink.soft
    ctx.textAlign = "right"
    const clock = stage.clock.second ? `${stage.clock.time} · ${stage.clock.second.label} ${stage.clock.second.time}` : stage.clock.time
    ctx.fillText(clock, right, y)
    right -= ctx.measureText(clock).width + 2 * vw
  }
  if (stage.timer && !timerOwnLine) {
    ctx.font = font(timerPx, 700)
    ctx.fillStyle = timerTone(stage.timer.tone)
    ctx.textAlign = "right"
    const label = `${stage.timer.label}${stage.timer.tone === "over" ? " OVER" : ""}`
    ctx.fillText(label, right, y)
    right -= ctx.measureText(label).width + 2 * vw
  }
  if (finish && !tall) {
    ctx.font = font(3.2 * vh)
    ctx.fillStyle = finish.lateMin > 0 ? ink.warn : ink.soft
    ctx.textAlign = "right"
    ctx.fillText(stageFinishText(finish), right, y, width * 0.3)
  }
  if (band && L.band === 1 && !tall) {
    ctx.font = font(3.2 * vh, 700)
    ctx.fillStyle = ink.ok
    ctx.textAlign = "center"
    ctx.fillText(band, width / 2, y)
  }
  y += 2 * vh

  // The timer large, on its own line (the pastor's and stage manager's layouts, a tall screen), with the finish line beside it.
  if (stage.timer && timerOwnLine) {
    y += timerPx
    ctx.font = font(timerPx, 700)
    ctx.fillStyle = timerTone(stage.timer.tone)
    ctx.textAlign = "left"
    const label = `${stage.timer.label}${stage.timer.tone === "over" ? " OVER" : ""}`
    ctx.fillText(label, padX, y)
    if (finish) {
      ctx.font = font(3.2 * vh)
      ctx.fillStyle = finish.lateMin > 0 ? ink.warn : ink.soft
      ctx.textAlign = "right"
      ctx.fillText(stageFinishText(finish), width - padX, y, width * 0.45)
    }
    y += 2 * vh
  } else if (finish && tall) {
    y += 4 * vh
    ctx.font = font(3.2 * vh)
    ctx.fillStyle = finish.lateMin > 0 ? ink.warn : ink.soft
    ctx.textAlign = "left"
    ctx.fillText(stageFinishText(finish), padX, y, width - padX * 2)
    y += 2 * vh
  }
  // The band's key and tempo large (the band's layout, a tall screen).
  if (band && (L.band > 1 || tall)) {
    const px = 3.2 * vh * L.band
    y += px + vh
    ctx.font = font(px, 700)
    ctx.fillStyle = ink.ok
    ctx.textAlign = "left"
    ctx.fillText(band, padX, y, width - padX * 2)
    y += 2 * vh
  }

  // Auxiliary timers, one line under the top row.
  if (aux?.length) {
    y += 4 * vh
    ctx.textAlign = "left"
    let x = padX
    for (const t of aux) {
      ctx.font = font(3.2 * vh)
      ctx.fillStyle = t.tone === "over" ? ink.over : t.tone === "warn" ? ink.warn : ink.soft
      const label = `${t.label} `
      ctx.fillText(label, x, y)
      x += ctx.measureText(label).width
      ctx.font = font(3.2 * vh, 700)
      ctx.fillText(t.text, x, y)
      x += ctx.measureText(t.text).width + 3 * vw
    }
    y += 2 * vh
  }

  // The operator's message, boxed.
  if (stage.message) {
    ctx.font = font(5 * vh, 700)
    const lines = wrap(ctx, stage.message, width - padX * 2 - 4 * vw).slice(0, 2)
    const boxH = lines.length * 6 * vh + 3 * vh
    ctx.fillStyle = ink.boxBg
    ctx.strokeStyle = ink.boxInk
    ctx.lineWidth = 0.6 * vh
    ctx.beginPath()
    ctx.roundRect(padX, y, width - padX * 2, boxH, 1.5 * vh)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = ink.boxInk
    ctx.textAlign = "center"
    lines.forEach((l, i) => ctx.fillText(l, width / 2, y + 1.5 * vh + (i + 0.8) * 6 * vh))
    y += boxH + 2 * vh
  }

  // Bottom: the note and what is next.
  const bottom = height - 3 * vh
  ctx.font = font(3.6 * vh)
  ctx.textAlign = "left"
  ctx.fillStyle = ink.note
  // A tall screen has the note on a line of its own above what is next.
  if (note) ctx.fillText(`Note: ${note}`, padX, tall ? bottom - 5.6 * vh : bottom, tall ? width - padX * 2 : width * 0.55)
  ctx.textAlign = tall ? "left" : "right"
  ctx.fillStyle = ink.soft
  if (style?.showNext !== false) ctx.fillText(stage.next ? `NEXT: ${stage.next}` : "End of service", tall ? padX : width - padX, bottom, tall ? width - padX * 2 : width * 0.4)

  // The live words, centred in what is left (the first line stays visible if they overflow).
  const top = y
  const room = bottom - (tall && note ? 11.2 : 5.6) * vh - top
  ctx.textAlign = "left"
  if (!stage.current) {
    ctx.font = font(6 * vh)
    ctx.fillStyle = stage.night ? NIGHT.soft : "#555"
    ctx.fillText("—", padX, top + room / 2)
  } else {
    const px = stageFontVh(stage.current.lines) * (style?.wordsScale ?? 1) * L.words * vh
    ctx.font = font(px, 600)
    ctx.fillStyle = ink.words
    const lines = stage.current.lines.flatMap((l) => wrap(ctx, l, width - padX * 2))
    const lh = px * 1.25
    const blockH = lines.length * lh
    let ly = top + Math.max(0, (room - blockH) / 2) + px
    for (const l of lines) {
      if (ly > top + room + px * 0.3) break
      ctx.fillText(l, padX, ly)
      ly += lh
    }
  }
  ctx.restore()
  return { moving: false }
}
