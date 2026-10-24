import { drawLowerThird, renderVerse } from "@/lib/verse-renderer"
import { clockText } from "@/lib/scenes"
import { drawTicker } from "@/lib/ticker-draw"
import { entranceProgress } from "@/lib/lower-third-style"
import type { LowerThird, SceneFrame, SceneLayerFrame, Ticker } from "@/types"

export interface SceneDrawOptions {
  /** A loaded picture for a URL, or null while it loads (the caller loads it and redraws). */
  image: (url: string) => HTMLImageElement | null
  /** A canvas kept per layer, where a feed layer's own frame is drawn before it is placed. */
  layerCanvas: (id: string) => HTMLCanvasElement
  /** Theme pictures (backgrounds, logos) already loaded. */
  imageCache?: Map<string, HTMLImageElement>
  /** The composer's preview: placeholders and labels; an output never draws them. */
  preview?: boolean
  /** Wall-clock ms, for clock layers (default: now). */
  now?: number
  /** A camera layer's video, when it is playing (outputs only). */
  camera?: (layerId: string) => HTMLVideoElement | null
  /** The page shows this playing camera itself, under the canvas: leave its box see-through. */
  cameraBelow?: (layerId: string) => boolean
  /** The page draws this ticker layer itself, on a strip over the canvas: leave it out here. */
  tickerAbove?: (layerId: string) => boolean
  /** The ticker's looping video backing, where one plays. */
  tickerVideo?: HTMLVideoElement | null
  /** The lower third's looping video backing, where one plays. */
  lowerThirdVideo?: HTMLVideoElement | null
}

/**
 * Something in the scene moves by itself: a ticker running in its box, or a lower third coming in.
 * `skip`: layers drawn somewhere else (a browser feed's ticker strips), which do not count.
 */
export function sceneMoving(frame: SceneFrame | undefined, now: number, skip?: (layerId: string) => boolean): boolean {
  return !!frame?.layers.some((l) => !skip?.(l.id) && ((l.kind === "ticker" && !!l.ticker && !l.ticker.pausedAt) || (l.kind === "lowerThird" && !!l.overlay && entranceProgress(l.overlay, now) < 1)))
}

/**
 * A ticker layer's band, painted into a w×h box as if the box were the whole frame (`frameHeight`
 * high): the band fills it and the words move at the speed they have over the whole frame.
 */
export function drawTickerLayer(c: CanvasRenderingContext2D, w: number, h: number, l: SceneLayerFrame, frameHeight: number, opts: { imageCache?: Map<string, HTMLImageElement>; video?: HTMLVideoElement | null; now: number }): void {
  const tk = l.ticker
  if (!tk) return
  drawTicker(c, w, h, { ...tk, style: { ...tk.style, position: "top", height: 100, speed: (tk.style.speed * frameHeight) / Math.max(1, h) } }, l.fontFamily, { imageCache: opts.imageCache, video: opts.video ?? null, now: opts.now })
}

/** The ticker a scene draws in a box of its own (for its video or picture backing), or null. */
export function sceneTicker(frame: SceneFrame | undefined): Ticker | null {
  return frame?.layers.find((l) => l.kind === "ticker" && l.ticker)?.ticker ?? null
}

/** The lower third a scene draws in a box of its own, or null. */
export function sceneOverlay(frame: SceneFrame | undefined): LowerThird | null {
  return frame?.layers.find((l) => l.kind === "lowerThird" && l.overlay)?.overlay ?? null
}

function rect(l: SceneLayerFrame, width: number, height: number) {
  return { x: (width * l.box.x) / 100, y: (height * l.box.y) / 100, w: (width * l.box.w) / 100, h: (height * l.box.h) / 100 }
}

/** The part of a source of size w×h left after the layer's crop. */
function source(l: SceneLayerFrame, w: number, h: number) {
  const c = l.crop ?? { l: 0, t: 0, r: 0, b: 0 }
  return { sx: (w * c.l) / 100, sy: (h * c.t) / 100, sw: (w * (100 - c.l - c.r)) / 100, sh: (h * (100 - c.t - c.b)) / 100 }
}

/** One line of text fitted to a box, in a look's text style (a clock, a camera's fallback words). */
function fitText(ctx: CanvasRenderingContext2D, text: string, r: { x: number; y: number; w: number; h: number }, theme: SceneLayerFrame["theme"], maxOfHeight = 0.3): void {
  const vt = theme?.verseText
  const family = vt?.fontFamily ? `"${vt.fontFamily}", sans-serif` : "sans-serif"
  ctx.font = `${vt?.fontWeight ?? 600} 100px ${family}`
  const size = Math.max(8, Math.min(r.h * maxOfHeight, (100 * r.w * 0.9) / Math.max(1, ctx.measureText(text).width)))
  ctx.font = `${vt?.fontWeight ?? 600} ${Math.floor(size)}px ${family}`
  ctx.fillStyle = vt?.color ?? "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2)
}

/**
 * Paint something that lays itself out in a frame (the ticker, a lower third) into a layer's box,
 * as if the box were the whole frame. A see-through layer goes through its own canvas, because
 * those drawings set their own transparency.
 */
function inBox(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: { x: number; y: number; w: number; h: number }, opts: SceneDrawOptions, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void): void {
  if (l.opacity >= 1) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
    ctx.translate(r.x, r.y)
    paint(ctx, r.w, r.h)
    ctx.restore()
    return
  }
  const lc = opts.layerCanvas(l.id)
  const w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h))
  if (lc.width !== w || lc.height !== h) {
    lc.width = w
    lc.height = h
  }
  const lctx = lc.getContext("2d")
  if (!lctx) return
  lctx.clearRect(0, 0, w, h)
  paint(lctx, w, h)
  ctx.drawImage(lc, r.x, r.y, w, h)
}

/**
 * Draw a scene: the background, then each layer in its box, bottom first. A feed layer is its look
 * drawn whole (a transparent look stays transparent) and then cropped and scaled into its box, so a
 * layer looks exactly like the same look on an output of its own. A feed with nothing live shows
 * nothing.
 */
export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, frame: SceneFrame, opts: SceneDrawOptions): void {
  ctx.clearRect(0, 0, width, height)
  if (frame.background !== "transparent") {
    ctx.fillStyle = frame.background
    ctx.fillRect(0, 0, width, height)
  }
  for (const l of frame.layers) {
    const r = rect(l, width, height)
    ctx.save()
    ctx.globalAlpha = l.opacity
    if (l.kind === "color") {
      ctx.fillStyle = l.color ?? "#000"
      ctx.fillRect(r.x, r.y, r.w, r.h)
    } else if (l.kind === "picture" && l.imageUrl) {
      const img = opts.image(l.imageUrl)
      if (img && img.naturalWidth > 0) {
        const s = source(l, img.naturalWidth, img.naturalHeight)
        // Cover the box, keeping the picture's shape.
        const scale = Math.max(r.w / s.sw, r.h / s.sh)
        const cw = r.w / scale, ch = r.h / scale
        ctx.drawImage(img, s.sx + (s.sw - cw) / 2, s.sy + (s.sh - ch) / 2, cw, ch, r.x, r.y, r.w, r.h)
      }
    } else if (l.kind === "camera") {
      const v = opts.camera?.(l.id) ?? null
      // Not playing (not connected yet, or dropped): its fallback words, if it has them (#213).
      if ((!v || v.videoWidth === 0) && l.fallback && !opts.preview) fitText(ctx, l.fallback, r, l.theme)
      else if (v && v.videoWidth > 0 && opts.cameraBelow?.(l.id)) {
        // Cut its box out of whatever is below, as much as the layer is opaque.
        ctx.globalCompositeOperation = "destination-out"
        ctx.fillRect(r.x, r.y, r.w, r.h)
      } else if (v && v.videoWidth > 0) {
        const s = source(l, v.videoWidth, v.videoHeight)
        // Cover the box, keeping the camera's shape (like a picture).
        const scale = Math.max(r.w / s.sw, r.h / s.sh)
        const cw = r.w / scale, ch = r.h / scale
        ctx.drawImage(v, s.sx + (s.sw - cw) / 2, s.sy + (s.sh - ch) / 2, cw, ch, r.x, r.y, r.w, r.h)
      }
    } else if (l.kind === "logo" && l.imageUrl) {
      const img = opts.image(l.imageUrl)
      if (img && img.naturalWidth > 0) {
        const s = source(l, img.naturalWidth, img.naturalHeight)
        // Fitted inside the box, whole and centred, keeping its shape.
        const scale = Math.min(r.w / s.sw, r.h / s.sh)
        const w = s.sw * scale, h = s.sh * scale
        ctx.drawImage(img, s.sx, s.sy, s.sw, s.sh, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h)
      }
    } else if (l.kind === "ticker" && l.ticker && !opts.tickerAbove?.(l.id)) {
      const now = opts.now ?? Date.now()
      inBox(ctx, l, r, opts, (c, w, h) => drawTickerLayer(c, w, h, l, height, { imageCache: opts.imageCache, video: opts.tickerVideo, now }))
    } else if (l.kind === "lowerThird" && l.overlay) {
      // Laid out in its box as it would be on a frame of that size.
      const lt = l.overlay
      const now = opts.now ?? Date.now()
      inBox(ctx, l, r, opts, (c, w, h) => drawLowerThird(c, w, h, lt, l.fontFamily, { imageCache: opts.imageCache, video: opts.lowerThirdVideo ?? null, progress: entranceProgress(lt, now) }))
    } else if (l.kind === "clock" && l.theme && l.clock) {
      // The time fills its box in the look's text style; whatever is behind shows around it.
      fitText(ctx, clockText(l.clock, opts.now ?? Date.now()), r, l.theme, 0.8)
    } else if (l.kind === "feed" && l.theme && l.verse) {
      const lc = opts.layerCanvas(l.id)
      const { width: tw, height: th } = l.theme.resolution
      if (lc.width !== tw || lc.height !== th) {
        lc.width = tw
        lc.height = th
      }
      const lctx = lc.getContext("2d")
      if (lctx) {
        lctx.clearRect(0, 0, tw, th)
        renderVerse(lctx, l.theme, l.verse, { scale: 1, imageCache: opts.imageCache })
        const s = source(l, tw, th)
        ctx.drawImage(lc, s.sx, s.sy, s.sw, s.sh, r.x, r.y, r.w, r.h)
      }
    }
    if (opts.preview && l.label) {
      ctx.globalAlpha = 1
      ctx.setLineDash([Math.max(6, width / 160), Math.max(4, width / 240)])
      ctx.lineWidth = Math.max(2, width / 480)
      ctx.strokeStyle = "rgba(255,255,255,0.55)"
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
      if (l.label) {
        ctx.fillStyle = "rgba(255,255,255,0.85)"
        ctx.font = `600 ${Math.max(12, Math.round(height / 36))}px "IBM Plex Sans", sans-serif`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(l.label, r.x + r.w / 2, r.y + r.h / 2, r.w - 16)
      }
    }
    ctx.restore()
  }
}
