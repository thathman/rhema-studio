// Test fixture, never imported by the app: how outputs drew static text on `main` before text
// widening (`textWiden`). Copied verbatim from src/lib/scene-renderer.ts at main 80146920, so a test
// can prove that text saved before `textWiden` is still drawn by exactly the same canvas calls.
import type { SceneLayerFrame } from "@/types"

type Rect = { x: number; y: number; w: number; h: number }

function staticTextLayout(ctx: CanvasRenderingContext2D, layer: SceneLayerFrame, r: Rect, frameHeight: number) {
  const text = layer.text ?? ""
  const fontSize = Math.max(1, Math.min(400, layer.fontSize ?? 72) * frameHeight / 1080)
  const fontFamily = (layer.fontFamily ?? "Arial").replace(/[^\p{L}\p{N}, _-]/gu, "").trim().slice(0, 120) || "Arial"
  const fontWeight = ["400", "500", "600", "700", "800", "900"].includes(layer.fontWeight ?? "") ? layer.fontWeight : "600"
  const fontStyle = layer.fontStyle === "italic" ? "italic" : "normal"
  const align: CanvasTextAlign = layer.textAlign === "center" || layer.textAlign === "right" ? layer.textAlign : "left"
  const step = fontSize * Math.max(0.5, Math.min(3, layer.lineHeight ?? 1.2))
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
  const lines: string[] = []
  for (const paragraph of text.split(/\r\n?|\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push("")
      continue
    }
    let line = ""
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && ctx.measureText(candidate).width > r.w) {
        lines.push(line)
        line = word
      } else line = candidate
    }
    lines.push(line)
  }
  // Only whole lines that fit in the box are drawn.
  const fit = Math.max(0, Math.floor((r.h - fontSize) / step) + 1)
  return { fontSize, align, step, lines: lines.slice(0, fit) }
}

export function mainLayerPivot(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: Rect, frameHeight: number): { x: number; y: number } {
  const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  if (l.kind !== "text" || !l.text) return centre
  ctx.save()
  const { fontSize, step, lines } = staticTextLayout(ctx, l, r, frameHeight)
  ctx.restore()
  if (!lines.length) return centre
  return { x: centre.x, y: r.y + ((lines.length - 1) * step + fontSize) / 2 }
}

export function mainPaintStaticText(ctx: CanvasRenderingContext2D, layer: SceneLayerFrame, r: Rect, frameHeight: number): void {
  if (!layer.text) return
  const color = /^#[0-9a-f]{6}$/i.test(layer.textColor ?? "") ? layer.textColor! : "#ffffff"
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  const { fontSize, align, step, lines } = staticTextLayout(ctx, layer, r, frameHeight)
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = "top"
  let y = r.y
  for (const line of lines) {
    if (line) {
      const x = align === "center" ? r.x + r.w / 2 : align === "right" ? r.x + r.w : r.x
      ctx.fillText(line, x, y, r.w)
      if (layer.underline) {
        const width = Math.min(r.w, ctx.measureText(line).width)
        const left = align === "center" ? r.x + (r.w - width) / 2 : align === "right" ? r.x + r.w - width : r.x
        const underlineY = y + fontSize * 1.04
        ctx.beginPath()
        ctx.moveTo(left, underlineY)
        ctx.lineTo(left + width, underlineY)
        ctx.strokeStyle = color
        ctx.lineWidth = Math.max(1, fontSize / 24)
        ctx.stroke()
      }
    }
    y += step
  }
  ctx.restore()
}
