import type { Ticker } from "@/types/broadcast-output"
import { crawlElapsed, crawlPositions, mirrorPositions, pageIndex, tickerText } from "@/lib/ticker"

export interface TickerDrawOptions {
  imageCache?: Map<string, HTMLImageElement>
  /** The style's looping video, where the canvas has one playing. */
  video?: HTMLVideoElement | null
  /** The time to draw (ms); the crawl's position follows from it. */
  now: number
}

/** Paint `src` over the rect, cropping to fill it. */
function cover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / sw, h / sh)
  ctx.drawImage(src, x + (w - sw * scale) / 2, y + (h - sh * scale) / 2, sw * scale, sh * scale)
}

/**
 * The news ticker: a band along the top or bottom with an optional tag and the
 * items crawling right to left. Drawn over everything, like the lower third.
 */
export function drawTicker(ctx: CanvasRenderingContext2D, width: number, height: number, ticker: Ticker, fontFamily: string | undefined, opts: TickerDrawOptions): void {
  const st = ticker.style
  const text = tickerText(ticker.items, st.separator)
  if (!text) return
  const h = Math.round((height * st.height) / 100)
  const y = st.position === "top" ? 0 : height - h
  const fam = st.fontFamily ?? fontFamily
  const family = fam ? `"${fam.replace(/"/g, "")}", system-ui, sans-serif` : "system-ui, sans-serif"
  const size = Math.round((h * st.size) / 100)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, y, width, h)
  ctx.clip()
  const img = ticker.backing?.kind === "picture" ? opts.imageCache?.get(ticker.backing.url) : undefined
  const video = ticker.backing?.kind === "video" && opts.video && opts.video.readyState >= 2 ? opts.video : null
  if (video) cover(ctx, video, video.videoWidth, video.videoHeight, 0, y, width, h)
  else if (img) cover(ctx, img, img.naturalWidth, img.naturalHeight, 0, y, width, h)
  // The colour is the band, or a shade over its picture or video.
  ctx.globalAlpha = st.background.opacity
  ctx.fillStyle = st.background.color
  ctx.fillRect(0, y, width, h)
  ctx.globalAlpha = 1

  // The tag, fixed at the start.
  let laneX = 0
  ctx.textBaseline = "middle"
  if (st.label.trim()) {
    ctx.font = `800 ${Math.round(size * 0.9)}px ${family}`
    const lw = Math.ceil(ctx.measureText(st.label.trim()).width + h * 0.8)
    ctx.fillStyle = st.labelBackground
    ctx.fillRect(0, y, lw, h)
    ctx.fillStyle = st.labelColor
    ctx.textAlign = "center"
    ctx.fillText(st.label.trim(), lw / 2, y + h / 2)
    laneX = lw
  }

  ctx.beginPath()
  ctx.rect(laneX, y, width - laneX, h)
  ctx.clip()
  ctx.font = `${st.weight} ${size}px ${family}`
  ctx.fillStyle = st.color
  ctx.textAlign = "left"
  if (st.motion === "pages") {
    // One announcement at a time, still: no movement for people who find motion hard.
    const shown = ticker.items.map((i) => i.trim()).filter(Boolean)
    const k = pageIndex(ticker.items, st.pageSeconds, crawlElapsed(ticker, opts.now))
    if (k >= 0) ctx.fillText(shown[k], laneX + h * 0.6, y + h / 2, width - laneX - h * 1.2)
    ctx.restore()
    return
  }
  const textW = ctx.measureText(text).width
  const speed = (st.speed * height) / 1080
  const laneW = width - laneX
  const xs = crawlPositions(laneX, laneW, textW, h * 3, speed, crawlElapsed(ticker, opts.now))
  for (const x of st.direction === "right" ? mirrorPositions(xs, laneX, laneW, textW) : xs) ctx.fillText(text, x, y + h / 2)
  ctx.restore()
}
