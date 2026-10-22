import type { TickerStyle } from "@/types/broadcast-output"

export const DEFAULT_TICKER_STYLE: TickerStyle = {
  position: "bottom",
  height: 7,
  speed: 140,
  fontFamily: null,
  size: 52,
  color: "#ffffff",
  weight: 600,
  background: { kind: "color", color: "#0b1a33", opacity: 0.92, mediaId: null },
  label: "NEWS",
  labelColor: "#0b1a33",
  labelBackground: "#d4a656",
  separator: "•",
  direction: "left",
}

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const str = (v: unknown, d: string) => (typeof v === "string" && v ? v : d)

/** A saved style with every field present and within bounds. */
export function normalizeTickerStyle(raw: Partial<TickerStyle> | null | undefined): TickerStyle {
  const d = DEFAULT_TICKER_STYLE
  const r = raw ?? {}
  const bg = (r.background ?? {}) as Partial<TickerStyle["background"]>
  return {
    position: r.position === "top" ? "top" : "bottom",
    height: num(r.height, d.height, 3, 25),
    speed: num(r.speed, d.speed, 20, 600),
    fontFamily: typeof r.fontFamily === "string" && r.fontFamily.trim() ? r.fontFamily.trim() : null,
    size: num(r.size, d.size, 20, 90),
    color: str(r.color, d.color),
    weight: num(r.weight, d.weight, 100, 900),
    background: {
      kind: bg.kind === "picture" || bg.kind === "video" ? bg.kind : "color",
      color: str(bg.color, d.background.color),
      opacity: num(bg.opacity, d.background.opacity, 0, 1),
      mediaId: typeof bg.mediaId === "string" ? bg.mediaId : null,
    },
    label: typeof r.label === "string" ? r.label.slice(0, 24) : d.label,
    labelColor: str(r.labelColor, d.labelColor),
    labelBackground: str(r.labelBackground, d.labelBackground),
    separator: typeof r.separator === "string" ? r.separator.slice(0, 8) : d.separator,
    direction: r.direction === "right" ? "right" : "left",
  }
}

/** The height a running ticker takes along the bottom of a `height` frame (0 at the top or when off), for the lower third to stay above. */
export function tickerReserve(ticker: { style: TickerStyle } | null | undefined, height: number): number {
  return ticker && ticker.style.position === "bottom" ? Math.round((height * ticker.style.height) / 100) : 0
}

/** The items as one line of words (blank items dropped). */
export function tickerText(items: string[], separator: string): string {
  const sep = separator.trim() ? `   ${separator.trim()}   ` : "     "
  return items.map((i) => i.trim()).filter(Boolean).join(sep)
}

/**
 * Where each copy of the words starts (left x) after `elapsedMs`, in a lane
 * from `laneX` to `laneX + laneW`. The first copy enters at the right edge;
 * copies follow one `gap` apart, so the crawl never runs dry.
 */
export function crawlPositions(laneX: number, laneW: number, textW: number, gap: number, speedPx: number, elapsedMs: number): number[] {
  const cycle = Math.max(1, textW + gap)
  const x0 = laneX + laneW - (Math.max(0, elapsedMs) / 1000) * speedPx
  const first = Math.max(0, Math.ceil((laneX - x0 - textW) / cycle))
  const out: number[] = []
  for (let k = first, x = x0 + first * cycle; x < laneX + laneW && out.length < 50; k++, x = x0 + k * cycle) out.push(x)
  return out
}

/** How long the crawl has run at `now`: a paused ticker holds where it stopped. */
export function crawlElapsed(ticker: { startedAt: number; pausedAt?: number }, now: number): number {
  return (ticker.pausedAt ?? now) - ticker.startedAt
}

/** Copies moving toward the right: the same crawl mirrored in the lane. */
export function mirrorPositions(positions: number[], laneX: number, laneW: number, textW: number): number[] {
  return positions.map((x) => 2 * laneX + laneW - x - textW)
}
