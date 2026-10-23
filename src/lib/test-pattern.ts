import { CLASSIC_DARK } from "@/lib/builtin-themes"
import type { FeedHealth } from "@/lib/browser-feeds"
import type { BroadcastOutputType, BroadcastTheme } from "@/types"

/**
 * The screen test (#298 scenario F): a test pattern drawn at the output's own size, with its
 * name, its resolution and a plain "not on air" label, so whoever stands at the projector, the
 * stage screen or the TV can see that this is the right screen and that it fills it.
 */
export const TEST_LABEL = "TEST – not on air"

export interface PatternSpec {
  width: number
  height: number
  /** The output's name, as in Outputs. */
  name: string
}

const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"]

/** Bars, a grid, corner marks and a centre circle (so stretching or cropping shows), and the words. */
export function drawTestPattern(ctx: CanvasRenderingContext2D, { width: w, height: h, name }: PatternSpec): void {
  ctx.fillStyle = "#202020"
  ctx.fillRect(0, 0, w, h)
  const barH = Math.round(h * 0.18)
  BARS.forEach((c, i) => {
    ctx.fillStyle = c
    ctx.fillRect(Math.round((i * w) / BARS.length), 0, Math.ceil(w / BARS.length), barH)
    ctx.fillRect(Math.round((i * w) / BARS.length), h - barH, Math.ceil(w / BARS.length), barH)
  })
  // A grid every tenth of the height: squares stay square on a screen with the right shape.
  const step = Math.max(8, Math.round(h / 10))
  ctx.strokeStyle = "rgba(255,255,255,0.18)"
  ctx.lineWidth = Math.max(1, Math.round(h / 540))
  ctx.beginPath()
  for (let x = step; x < w; x += step) {
    ctx.moveTo(x + 0.5, barH)
    ctx.lineTo(x + 0.5, h - barH)
  }
  for (let y = barH + step; y < h - barH; y += step) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(w, y + 0.5)
  }
  ctx.stroke()
  // The edges: a white border and corner marks, so a cropped edge is easy to spot.
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = Math.max(2, Math.round(h / 270))
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth)
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2)
  ctx.stroke()
  // The words, on a dark band so they read over the grid.
  const big = Math.round(h * 0.075)
  ctx.fillStyle = "rgba(0,0,0,0.75)"
  ctx.fillRect(0, h / 2 - big * 1.9, w, big * 3.8)
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.font = `700 ${big}px system-ui, sans-serif`
  ctx.fillText(TEST_LABEL, w / 2, h / 2 - big * 0.85, w * 0.92)
  ctx.font = `500 ${Math.round(big * 0.6)}px system-ui, sans-serif`
  ctx.fillText(`${name} · ${w}×${h}`, w / 2, h / 2 + big * 0.75, w * 0.92)
}

/** The pattern as a picture (PNG data URL); null where there is no canvas to draw on. */
export function testPatternUrl(spec: PatternSpec): string | null {
  const canvas = document.createElement("canvas")
  canvas.width = spec.width
  canvas.height = spec.height
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext("2d")
  } catch {
    return null
  }
  if (!ctx) return null
  drawTestPattern(ctx, spec)
  return canvas.toDataURL("image/png")
}

/**
 * The frame an output gets during the test: the pattern as the whole background, nothing else
 * (no words, lower third or ticker). Sent the way any frame is, so screens, NDI and browser feed
 * pages all draw it with what they already have.
 */
export function testPatternFrame(url: string, spec: PatternSpec): Record<string, unknown> {
  const theme: BroadcastTheme = {
    ...CLASSIC_DARK,
    id: "screen-test",
    name: "Screen test",
    resolution: { width: spec.width, height: spec.height },
    background: { type: "image", color: "#000000", gradient: null, image: { url, fit: "stretch", blur: 0, brightness: 100, tint: null } },
    logo: null,
  }
  return { theme, verse: null, overlay: null, ticker: null, sound: false }
}

export interface TestRiskInput {
  type: BroadcastOutputType
  name: string
  /** Something is on air now (a verse, a song, a picture), or a service is running. */
  live: boolean
  /** NDI receivers taking this output now; null when unknown. */
  ndiReceivers?: number | null
  /** Browser feed pages showing this output now. */
  feedWatching?: number
}

/**
 * Why showing the test now would be seen by people: each reason asks to be confirmed a second
 * time. Empty when the test can go ahead on the first confirmation.
 */
export function testRisks(i: TestRiskInput): string[] {
  const out: string[] = []
  if (i.live) out.push(`Something is on air now: anyone watching ${i.name} sees the test pattern instead until you end the test.`)
  if (i.type === "ndi" && (i.ndiReceivers ?? 0) > 0) {
    const n = i.ndiReceivers ?? 0
    out.push(`${n === 1 ? "1 NDI receiver is" : `${n} NDI receivers are`} taking this output (OBS or another computer): a stream or recording would show the test pattern.`)
  }
  if (i.type === "browser" && (i.feedWatching ?? 0) > 0) {
    const n = i.feedWatching ?? 0
    out.push(`${n === 1 ? "1 page is" : `${n} pages are`} showing this feed now (a TV, a lobby screen or OBS).`)
  }
  return out
}

/** A browser feed's render receipt in plain words: did a page really draw it? */
export function feedAckLabel(h: FeedHealth | null): string {
  if (!h) return "Checking the feed…"
  if (h.watching === 0) return "Feed on, no page open"
  const pages = h.watching === 1 ? "1 page" : `${h.watching} pages`
  return h.current ? `Shown on ${pages}` : `Connected, not shown (${pages} open)`
}
