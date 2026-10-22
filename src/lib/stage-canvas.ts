import type { StagePayload } from "@/types"
import { stageFontVh } from "@/lib/stage"

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
 * output can go out over NDI to a viewer.
 */
export function drawStage(ctx: CanvasRenderingContext2D, width: number, height: number, stage: StagePayload): void {
  const vh = height / 100
  const vw = width / 100
  const padX = 4 * vw
  const font = (px: number, weight = 400) => `${weight} ${Math.round(px)}px system-ui, sans-serif`
  ctx.save()
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = "alphabetic"

  // Top: what is live, the band's key, the timer.
  let y = 3 * vh + 5 * vh
  ctx.font = font(3.2 * vh)
  ctx.fillStyle = "#9aa0a6"
  ctx.textAlign = "left"
  ctx.fillText(stage.current?.title ?? "Nothing live", padX, y, width * 0.45)
  if (stage.timer) {
    ctx.font = font(5 * vh, 700)
    ctx.fillStyle = stage.timer.tone === "over" ? "#ff5a5a" : stage.timer.tone === "warn" ? "#ffc547" : "#9be37a"
    ctx.textAlign = "right"
    ctx.fillText(`${stage.timer.label}${stage.timer.tone === "over" ? " OVER" : ""}`, width - padX, y)
  }
  if (stage.band) {
    ctx.font = font(3.2 * vh, 700)
    ctx.fillStyle = "#9be37a"
    ctx.textAlign = "center"
    ctx.fillText(stage.band, width / 2, y)
  }
  y += 2 * vh

  // The operator's message, boxed.
  if (stage.message) {
    ctx.font = font(5 * vh, 700)
    const lines = wrap(ctx, stage.message, width - padX * 2 - 4 * vw).slice(0, 2)
    const boxH = lines.length * 6 * vh + 3 * vh
    ctx.fillStyle = "#2a2000"
    ctx.strokeStyle = "#ffd166"
    ctx.lineWidth = 0.6 * vh
    ctx.beginPath()
    ctx.roundRect(padX, y, width - padX * 2, boxH, 1.5 * vh)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#ffd166"
    ctx.textAlign = "center"
    lines.forEach((l, i) => ctx.fillText(l, width / 2, y + 1.5 * vh + (i + 0.8) * 6 * vh))
    y += boxH + 2 * vh
  }

  // Bottom: the note and what is next.
  const bottom = height - 3 * vh
  ctx.font = font(3.6 * vh)
  ctx.textAlign = "left"
  ctx.fillStyle = "#ffd166"
  if (stage.note) ctx.fillText(`Note: ${stage.note}`, padX, bottom, width * 0.55)
  ctx.textAlign = "right"
  ctx.fillStyle = "#9aa0a6"
  ctx.fillText(stage.next ? `NEXT: ${stage.next}` : "End of service", width - padX, bottom, width * 0.4)

  // The live words, centred in what is left (the first line stays visible if they overflow).
  const top = y
  const room = bottom - 5.6 * vh - top
  ctx.textAlign = "left"
  if (!stage.current) {
    ctx.font = font(6 * vh)
    ctx.fillStyle = "#555"
    ctx.fillText("—", padX, top + room / 2)
  } else {
    const px = stageFontVh(stage.current.lines) * vh
    ctx.font = font(px, 600)
    ctx.fillStyle = "#fff"
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
}
