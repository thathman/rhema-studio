import type { CountdownFrame } from "@/types"
import { countdownNow, CountdownFade, mixColour, pulsed } from "@/lib/countdown-display"
import { clockText } from "@/lib/stage-clock"

/** Words wrapped to `maxW`, at most `most` lines (the last one cut with "…"). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, most: number): string[] {
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
  if (out.length > most) {
    out.length = most
    out[most - 1] = `${out[most - 1]}…`
  }
  return out
}

/** The time of day on the church's clock ("" zone: this screen's), 12- or 24-hour when the stage design says. */
function clockOfDay(now: number, zone: string, hours?: 12 | 24): string {
  if (hours) return clockText(now, zone, hours)
  try {
    return new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) })
  } catch {
    return new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  }
}

/**
 * The big time drawn in even cells, so the digits do not shift as they change (canvas text has no
 * tabular figures). Centred on `cx`, its baseline at `y`.
 */
function cells(ctx: CanvasRenderingContext2D, text: string): number[] {
  const digit = Math.max(...[..."0123456789"].map((d) => ctx.measureText(d).width))
  return [...text].map((c) => (/\d/.test(c) ? digit : ctx.measureText(c).width))
}

function drawTime(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number) {
  const widths = cells(ctx, text)
  let x = cx - widths.reduce((a, b) => a + b, 0) / 2
  ctx.textAlign = "center"
  ;[...text].forEach((c, i) => {
    ctx.fillText(c, x + widths[i] / 2, y)
    x += widths[i]
  })
}

export interface CountdownDrawOptions {
  /** The host's clock now (ms). */
  now: number
  /** This screen's blend between steps; without one the colours change at once. */
  fade?: CountdownFade
}

/**
 * The countdown display on a canvas (output windows, NDI, browser feeds, the designer's preview):
 * the whole screen in the step's colour, one big time, the step's message and the stage message
 * under it, what it counts and the time of day small along the top, the item and the next one
 * along the bottom. Returns whether it moves (a pulse or a blend), so the caller draws again soon;
 * otherwise once a second is enough.
 */
export function drawCountdown(ctx: CanvasRenderingContext2D, width: number, height: number, frame: CountdownFrame, message: string | null, opts: CountdownDrawOptions): { moving: boolean } {
  const vh = height / 100
  const padX = Math.max(4 * (width / 100), 4 * vh)
  const font = (px: number, weight = 400) => `${weight} ${Math.round(px)}px system-ui, -apple-system, "Segoe UI", sans-serif`
  const look = frame.look
  const now = countdownNow(frame, opts.now)
  const blended = opts.fade ? opts.fade.colours({ background: now.background, text: now.text }, opts.now) : { background: now.background, text: now.text, moving: false }
  const background = now.pulse ? pulsed(blended.background, opts.now) : blended.background
  const ink = blended.text
  const soft = mixColour(ink, background, 0.3)

  ctx.save()
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = "alphabetic"

  // Along the top: what it counts (paused when held part-way), and the time of day.
  const top = 7 * vh
  ctx.font = font(4 * vh, 600)
  ctx.fillStyle = soft
  ctx.textAlign = "left"
  const held = !frame.idle && frame.endsAt === null && frame.leftMs !== frame.totalMs
  ctx.fillText(`${frame.label}${held ? " · paused" : ""}`, padX, top, width * 0.6)
  if (look.showClock) {
    ctx.textAlign = "right"
    ctx.fillText(clockOfDay(opts.now, frame.zone, frame.hours), width - padX, top)
    // A second time zone under it, smaller (#196 R2.6).
    if (frame.zone2) {
      ctx.font = font(3 * vh, 500)
      ctx.fillText(`${frame.zone2.label} ${clockText(opts.now, frame.zone2.zone, frame.hours ?? 24)}`, width - padX, top + 4 * vh)
    }
  }

  // The messages under the time: the step's, then the stage message.
  const lines: { text: string; px: number; weight: number }[] = []
  ctx.font = font(8 * vh, 700)
  if (frame.idle) lines.push(...wrap(ctx, frame.idle, width - padX * 2, 2).map((t) => ({ text: t, px: 5 * vh, weight: 500 })))
  else if (now.message) lines.push(...wrap(ctx, now.message, width - padX * 2, 1).map((t) => ({ text: t, px: 8 * vh, weight: 700 })))
  const stageMessage = look.showMessage ? message?.trim() : ""
  if (stageMessage) {
    ctx.font = font(6 * vh, 600)
    lines.push(...wrap(ctx, stageMessage, width - padX * 2, 2).map((t) => ({ text: t, px: 6 * vh, weight: 600 })))
  }
  const messagesH = lines.reduce((h, l) => h + l.px * 1.2, 0)

  // The big time, as large as fits between the top line and the messages.
  const bottomRoom = look.showItem || look.showNext ? 9 * vh : 4 * vh
  const gap = messagesH ? 5 * vh : 0
  const room = height - top - 4 * vh - bottomRoom - messagesH - gap
  let px = Math.min(room * 0.92, 46 * vh)
  ctx.font = font(px, 700)
  const probe = cells(ctx, now.time).reduce((a, b) => a + b, 0)
  if (probe > width - padX * 2) px *= (width - padX * 2) / probe
  ctx.font = font(px, 700)
  ctx.fillStyle = ink
  const blockH = px * 0.78 + gap + messagesH
  const blockTop = top + 4 * vh + Math.max(0, (room + gap + messagesH - blockH) / 2)
  const baseline = blockTop + px * 0.78
  drawTime(ctx, now.time, width / 2, baseline)

  let y = baseline + gap
  for (const l of lines) {
    y += l.px
    ctx.font = font(l.px, l.weight)
    ctx.textAlign = "center"
    ctx.fillText(l.text, width / 2, y, width - padX * 2)
    y += l.px * 0.2
  }

  // Along the bottom: the item on now and the next one.
  const bottom = height - 4 * vh
  ctx.font = font(3.6 * vh, 500)
  ctx.fillStyle = soft
  if (look.showItem && frame.item) {
    ctx.textAlign = "left"
    ctx.fillText(frame.item, padX, bottom, look.showNext ? width * 0.45 : width - padX * 2)
  }
  if (look.showNext && frame.next) {
    ctx.textAlign = "right"
    ctx.fillText(`Next: ${frame.next}`, width - padX, bottom, look.showItem ? width * 0.45 : width - padX * 2)
  }
  ctx.restore()
  return { moving: now.pulse || blended.moving }
}

