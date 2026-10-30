import { drawLowerThird, renderVerse } from "@/lib/verse-renderer"
import { clockText } from "@/lib/scenes"
import { drawTicker } from "@/lib/ticker-draw"
import { entranceProgress } from "@/lib/lower-third-style"
import { drawBars, drawStatic, noSignalOf } from "@/lib/no-signal"
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
  /** A video layer's player, once it has a picture (outputs only). */
  video?: (layerId: string) => HTMLVideoElement | null
  /** The page shows this playing camera or video itself, under the canvas: leave its box see-through. */
  cameraBelow?: (layerId: string) => boolean
  /** Layer cross-fades (outputs only); without it every layer cuts. */
  fader?: LayerFader
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

/** Literal text saved in an Avnac design, drawn by the same renderer on Preview and every output. */
function paintStaticText(ctx: CanvasRenderingContext2D, layer: SceneLayerFrame, r: { x: number; y: number; w: number; h: number }, frameHeight: number): void {
  const text = layer.text ?? ""
  if (!text) return
  const fontSize = Math.max(1, Math.min(400, layer.fontSize ?? 72) * frameHeight / 1080)
  const fontFamily = (layer.fontFamily ?? "Arial").replace(/[^\p{L}\p{N}, _-]/gu, "").trim().slice(0, 120) || "Arial"
  const fontWeight = ["400", "500", "600", "700", "800", "900"].includes(layer.fontWeight ?? "") ? layer.fontWeight : "600"
  const fontStyle = layer.fontStyle === "italic" ? "italic" : "normal"
  const align = layer.textAlign === "center" || layer.textAlign === "right" ? layer.textAlign : "left"
  const lineHeight = Math.max(0.5, Math.min(3, layer.lineHeight ?? 1.2))
  const color = /^#[0-9a-f]{6}$/i.test(layer.textColor ?? "") ? layer.textColor! : "#ffffff"
  const lines: string[] = []
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = "top"
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
  let y = r.y
  const step = fontSize * lineHeight
  for (const line of lines) {
    if (y + fontSize > r.y + r.h) break
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
 * Layer cross-fades: what each layer drew last, so a layer with a fade can go from it to new
 * content (a new verse, another picture) over its time. One per output page; kept outside the
 * frames, which carry only each layer's content key.
 */
export class LayerFader {
  private layers = new Map<string, { key: string; canvas: HTMLCanvasElement; from: HTMLCanvasElement | null; start: number; ms: number }>()
  private readonly make: () => HTMLCanvasElement
  readonly clock: () => number
  constructor(make: () => HTMLCanvasElement = () => document.createElement("canvas"), clock: () => number = () => performance.now()) {
    this.make = make
    this.clock = clock
  }

  /** A fade is running: keep drawing. */
  busy(now = this.clock()): boolean {
    return [...this.layers.values()].some((l) => l.from && now - l.start < l.ms)
  }

  /** Forget layers no longer drawn (another scene came up), so coming back is never a fade from old content. */
  keep(ids: ReadonlySet<string>): void {
    for (const id of this.layers.keys()) if (!ids.has(id)) this.layers.delete(id)
  }

  /**
   * The canvas to paint this layer's content into now, and the old content with how far it has
   * faded out (0–1, 1 = gone). A layer seen for the first time does not fade (its scene has just come up).
   */
  begin(id: string, key: string, ms: number, w: number, h: number): { canvas: HTMLCanvasElement; from: HTMLCanvasElement | null; p: number } {
    const now = this.clock()
    let l = this.layers.get(id)
    if (!l) this.layers.set(id, (l = { key, canvas: this.make(), from: null, start: 0, ms }))
    else if (l.key !== key) {
      const old = l.canvas
      l.canvas = l.from ?? this.make()
      l.from = old
      l.key = key
      l.start = now
      l.ms = ms
    }
    if (l.canvas.width !== w || l.canvas.height !== h) {
      l.canvas.width = w
      l.canvas.height = h
    }
    const p = l.from && l.ms > 0 ? Math.min(1, (now - l.start) / l.ms) : 1
    if (p >= 1) l.from = null
    return { canvas: l.canvas, from: l.from, p }
  }
}

/** Where a camera's or video's picture goes in a layer: cover the box, keeping its shape (like a picture). */
function drawCover(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: { x: number; y: number; w: number; h: number }, v: HTMLVideoElement): void {
  const s = source(l, v.videoWidth, v.videoHeight)
  const scale = Math.max(r.w / s.sw, r.h / s.sh)
  const cw = r.w / scale, ch = r.h / scale
  ctx.drawImage(v, s.sx + (s.sw - cw) / 2, s.sy + (s.sh - ch) / 2, cw, ch, r.x, r.y, r.w, r.h)
}

/** A camera's box while it is not sending. */
function paintNoSignal(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: { x: number; y: number; w: number; h: number }, opts: SceneDrawOptions): void {
  const mode = noSignalOf(l)
  if (mode === "bars") drawBars(ctx, r, l.ident)
  else if (mode === "static") drawStatic(ctx, r, opts.now ?? Date.now())
  else if (mode === "words" && l.fallback && !opts.preview) fitText(ctx, l.fallback, r, l.theme)
}

/** One layer's content in its box (`ctx`'s alpha is already the layer's opacity). */
function paintLayer(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: { x: number; y: number; w: number; h: number }, height: number, opts: SceneDrawOptions): void {
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
  } else if (l.kind === "camera" || l.kind === "video") {
    const v = (l.kind === "camera" ? opts.camera?.(l.id) : opts.video?.(l.id)) ?? null
    // A camera not playing (not connected yet, or dropped): colour bars, static, its words (#213)
    // or nothing, as the layer says. The preview shows the same, so the operator sees what the screens do.
    if (l.kind === "camera" && (!v || v.videoWidth === 0)) paintNoSignal(ctx, l, r, opts)
    else if (v && v.videoWidth > 0 && opts.cameraBelow?.(l.id)) {
      // Cut its box out of whatever is below, as much as the layer is opaque.
      ctx.globalCompositeOperation = "destination-out"
      ctx.fillRect(r.x, r.y, r.w, r.h)
    } else if (v && v.videoWidth > 0) drawCover(ctx, l, r, v)
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
  } else if (l.kind === "text") {
    paintStaticText(ctx, l, r, height)
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
}

/**
 * A layer with a fade: its content painted into a canvas of its own and placed over the old
 * content fading out. A camera or video the page shows under the canvas cannot fade there: it cuts.
 */
function paintFading(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: { x: number; y: number; w: number; h: number }, height: number, opts: SceneDrawOptions, fader: LayerFader): void {
  const w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h))
  const { canvas, from, p } = fader.begin(l.id, l.key ?? "", l.fadeMs ?? 0, w, h)
  const c = canvas.getContext("2d")
  if (!c) return paintLayer(ctx, l, r, height, opts)
  c.save()
  c.clearRect(0, 0, w, h)
  c.translate(-r.x, -r.y)
  paintLayer(c, { ...l, opacity: 1 }, r, height, opts)
  c.restore()
  if (from) {
    ctx.globalAlpha = l.opacity * (1 - p)
    ctx.drawImage(from, r.x, r.y, r.w, r.h)
  }
  ctx.globalAlpha = l.opacity * p
  ctx.drawImage(canvas, r.x, r.y, r.w, r.h)
}

/**
 * Draw a scene: the background, then each layer in its box, bottom first. A feed layer is its look
 * drawn whole (a transparent look stays transparent) and then cropped and scaled into its box, so a
 * layer looks exactly like the same look on an output of its own. A feed with nothing live shows
 * nothing. With a fader, a layer that has a fade cross-fades to new content.
 */
export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, frame: SceneFrame, opts: SceneDrawOptions): void {
  ctx.clearRect(0, 0, width, height)
  if (frame.background !== "transparent") {
    ctx.fillStyle = frame.background
    ctx.fillRect(0, 0, width, height)
  }
  opts.fader?.keep(new Set(frame.layers.map((l) => l.id)))
  for (const l of frame.layers) {
    const r = rect(l, width, height)
    ctx.save()
    ctx.globalAlpha = l.opacity
    if (opts.fader && l.fadeMs && !opts.preview && !opts.cameraBelow?.(l.id)) paintFading(ctx, l, r, height, opts, opts.fader)
    else paintLayer(ctx, l, r, height, opts)
    if (opts.preview && l.label) {
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = "source-over"
      ctx.setLineDash([Math.max(6, width / 160), Math.max(4, width / 240)])
      ctx.lineWidth = Math.max(2, width / 480)
      ctx.strokeStyle = "rgba(255,255,255,0.55)"
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
      const size = Math.max(12, Math.round(height / 36))
      ctx.font = `600 ${size}px "IBM Plex Sans", sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      // Over a camera's bars or static the label sits on a dark band, to stay readable.
      if (l.kind === "camera" && noSignalOf(l) !== "words" && noSignalOf(l) !== "none") {
        const tw = Math.min(r.w - 16, ctx.measureText(l.label).width) + size
        ctx.fillStyle = "rgba(0,0,0,0.7)"
        ctx.fillRect(r.x + (r.w - tw) / 2, r.y + r.h / 2 - size * 0.8, tw, size * 1.6)
      }
      ctx.fillStyle = "rgba(255,255,255,0.85)"
      ctx.fillText(l.label, r.x + r.w / 2, r.y + r.h / 2, r.w - 16)
    }
    ctx.restore()
  }
}
