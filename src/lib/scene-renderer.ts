import { imageCacheVersion } from "@/lib/theme-image-cache"
import { drawLowerThird, onThemeFontsLoaded, renderVerse } from "@/lib/verse-renderer"
import { clockText, EFFECT_KINDS } from "@/lib/scenes"
import { drawTicker } from "@/lib/ticker-draw"
import { entranceProgress } from "@/lib/lower-third-style"
import { drawBars, drawStatic, noSignalOf } from "@/lib/no-signal"
import { layerTurns, turnAbout } from "@/lib/scene-rotation"
import { applyCanvas2DClipPath, applyCanvas2DEffects, paintCanvas2DStyle, roundedCanvas2DRectPath } from "@/vendor/avnac/renderer/backends/canvas2d/shared"
import { textLineHeight } from "@/vendor/avnac/saraswati/utils/text"
import type { ImageDraw, LowerThird, SceneFrame, SceneGradient, SceneLayerFrame, SceneVector, Ticker } from "@/types"

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

/**
 * A fill for this box: the gradient, painted by the Avnac editor's own canvas code so the screens
 * match the design exactly, or the solid colour.
 */
export function scenePaint(ctx: CanvasRenderingContext2D, color: string, gradient: SceneGradient | undefined, r: { x: number; y: number; w: number; h: number }): string | CanvasGradient {
  if (!gradient) return color
  try {
    return paintCanvas2DStyle(ctx, { type: "gradient", css: "", stops: gradient.stops, angle: gradient.angle }, { x: r.x, y: r.y, width: r.w, height: r.h }) ?? color
  } catch {
    // A stop this engine cannot parse: the saved solid colour, never a frame that fails to draw.
    return color
  }
}

/**
 * A picture as the Avnac editor draws it (its image command, without rotation): in the picture's own
 * size scaled onto the box, inside its clips and rounded corners, the source crop stretched over it.
 */
function drawEditorPicture(ctx: CanvasRenderingContext2D, img: HTMLImageElement, d: ImageDraw, r: { x: number; y: number; w: number; h: number }): void {
  ctx.save()
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
  ctx.scale(r.w / d.width, r.h / d.height)
  for (const clip of d.clips ?? []) applyCanvas2DClipPath(ctx, clip)
  const x = -d.width / 2, y = -d.height / 2
  const radius = Math.max(0, Math.min(d.radius ?? 0, d.width / 2, d.height / 2))
  if (radius > 0) {
    ctx.beginPath()
    roundedCanvas2DRectPath(ctx, x, y, d.width, d.height, radius)
    ctx.clip()
  }
  const cropX = Math.max(0, Math.round(d.cropX))
  const cropY = Math.max(0, Math.round(d.cropY))
  const maxW = Math.max(1, img.naturalWidth - cropX)
  const maxH = Math.max(1, img.naturalHeight - cropY)
  const sw = d.cropWidth !== undefined ? Math.max(1, Math.min(maxW, Math.round(d.cropWidth))) : maxW
  const sh = d.cropHeight !== undefined ? Math.max(1, Math.min(maxH, Math.round(d.cropHeight))) : maxH
  ctx.drawImage(img, cropX, cropY, sw, sh, x, y, d.width, d.height)
  ctx.restore()
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

type Rect = { x: number; y: number; w: number; h: number }

/** How a text layer widens past its box, or undefined (text saved before `textWiden`: never). */
function widening(l: SceneLayerFrame): "right" | "both" | "left" | undefined {
  return l.textWiden === "right" || l.textWiden === "both" || l.textWiden === "left" ? l.textWiden : undefined
}

/** The frame's horizontal extent in canvas pixels (a letterboxed frame starts right of 0). */
export type FrameSpan = { x: number; w: number }

/**
 * How static text lays out in its box: font, wrapped lines, line step, and the block's left edge
 * and width. Sets `ctx.font`. The lines are those that fit in the box (each a whole em tall), as
 * `paintStaticText` draws them. The words wrap at the box's width.
 *
 * Text saved by the design editor since #876's follow-up (`textWiden` set) lays out as the editor
 * does: a word wider than the box widens the block to its measured width, growing away from the
 * node's origin edge, but never past the frame's edges. Text saved before keeps the old look: the
 * block is the box and an over-wide word is squeezed into it, so an approved scene never changes.
 */
function staticTextLayout(ctx: CanvasRenderingContext2D, layer: SceneLayerFrame, r: Rect, frameHeight: number, span: FrameSpan) {
  const text = layer.text ?? ""
  const fontSize = Math.max(1, Math.min(400, layer.fontSize ?? 72) * frameHeight / 1080)
  const fontFamily = (layer.fontFamily ?? "Arial").replace(/[^\p{L}\p{N}, _-]/gu, "").trim().slice(0, 120) || "Arial"
  const fontWeight = ["400", "500", "600", "700", "800", "900"].includes(layer.fontWeight ?? "") ? layer.fontWeight : "600"
  const fontStyle = layer.fontStyle === "italic" ? "italic" : "normal"
  const align: CanvasTextAlign = layer.textAlign === "center" || layer.textAlign === "right" ? layer.textAlign : "left"
  // One line-height rule with the design editor (0.5–3).
  const step = fontSize * textLineHeight(layer.lineHeight)
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
  let left = r.x, width = r.w
  const grow = widening(layer)
  if (grow) {
    const measured = Math.max(r.w, ...lines.map((line) => ctx.measureText(line).width))
    const room = { left: Math.max(0, r.x - span.x), right: Math.max(0, span.x + span.w - r.x - r.w) }
    const most = grow === "right" ? r.w + room.right : grow === "left" ? r.w + room.left : r.w + 2 * Math.min(room.left, room.right)
    width = Math.min(measured, most)
    left = r.x - (width - r.w) * (grow === "right" ? 0 : grow === "left" ? 1 : 0.5)
  }
  // Only whole lines that fit in the box are drawn.
  const fit = Math.max(0, Math.floor((r.h - fontSize) / step) + 1)
  return { fontSize, align, step, left, width, lines: lines.slice(0, fit) }
}

/**
 * The point a turned layer turns about, in canvas pixels (#851 G7). The design editor turns text
 * about the centre of its words (a tight block: each line a line step, the last an em tall), not
 * about a taller box kept for clipping; every other layer about its box's centre.
 */
export function layerPivot(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: Rect, frameHeight: number, span: FrameSpan): { x: number; y: number } {
  const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  if (l.kind !== "text" || !l.text) return centre
  ctx.save()
  const { fontSize, step, left, width, lines } = staticTextLayout(ctx, l, r, frameHeight, span)
  ctx.restore()
  if (!lines.length) return centre
  return { x: left + width / 2, y: r.y + ((lines.length - 1) * step + fontSize) / 2 }
}

/** Literal text saved in an Avnac design, drawn by the same renderer on Preview and every output. */
function paintStaticText(ctx: CanvasRenderingContext2D, layer: SceneLayerFrame, r: Rect, frameHeight: number, span: FrameSpan): void {
  if (!layer.text) return
  const color = /^#[0-9a-f]{6}$/i.test(layer.textColor ?? "") ? layer.textColor! : "#ffffff"
  ctx.save()
  // Text saved before `textWiden` is drawn by exactly the calls it always was: clipped to its box
  // first. Widened text is clipped to its block, which the layout measures.
  const widens = !!widening(layer)
  // A shadow and a blur fall outside the words (#448): the clip leaves room for them, as the
  // editor (which does not clip text) shows them.
  const k = frameHeight / 1080
  const room = (layer.shadow ? Math.max(Math.abs(layer.shadow.x), Math.abs(layer.shadow.y)) + layer.shadow.blur : 0) * k + (layer.blur ? layer.blur * 0.4 * 3 : 0) * k
    + (layer.textOutline ? layer.textOutline.width / 2 + 1 : 0) * k
  if (!widens) {
    ctx.beginPath()
    ctx.rect(r.x - room, r.y - room, r.w + 2 * room, r.h + 2 * room)
    ctx.clip()
  }
  const { fontSize, align, step, left: x0, width: w, lines } = staticTextLayout(ctx, layer, r, frameHeight, span)
  if (widens) {
    ctx.beginPath()
    ctx.rect(x0 - room, r.y - room, w + 2 * room, r.h + 2 * room)
    ctx.clip()
  }
  // As the editor paints words (#448): a gradient over the text box, an outline behind each line.
  // The gradient spans the words as laid out (the editor's layout box): their width, and their
  // lines' height with the last one em tall.
  const paint = layer.textGradient ? scenePaint(ctx, color, layer.textGradient, { x: x0, y: r.y, w, h: Math.max(fontSize, (lines.length - 1) * step + fontSize) }) : color
  ctx.fillStyle = paint
  ctx.textAlign = align
  ctx.textBaseline = "top"
  const outline = layer.textOutline
  let y = r.y
  for (const line of lines) {
    if (line) {
      const x = align === "center" ? x0 + w / 2 : align === "right" ? x0 + w : x0
      if (outline) {
        ctx.strokeStyle = outline.color
        ctx.lineWidth = (outline.width * frameHeight) / 1080
        ctx.strokeText(line, x, y, w)
      }
      ctx.fillText(line, x, y, w)
      if (layer.underline) {
        const width = Math.min(w, ctx.measureText(line).width)
        const left = align === "center" ? x0 + (w - width) / 2 : align === "right" ? x0 + w - width : x0
        const underlineY = y + fontSize * 1.04
        ctx.beginPath()
        ctx.moveTo(left, underlineY)
        ctx.lineTo(left + width, underlineY)
        ctx.strokeStyle = paint
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

/**
 * What each feed layer's canvas last rendered (#448): the same frame's verse in the same look, with
 * no picture or font loaded since, draws the same, so a redraw (every video frame, when the scene
 * also plays a camera) copies it instead of laying the verse out again.
 */
const feedRendered = new WeakMap<HTMLCanvasElement, { verse: unknown; theme: unknown; images: number; fonts: number; w: number; h: number }>()
let fontsLoaded = 0
onThemeFontsLoaded(() => { fontsLoaded++ })

/** Whether a feed layer's canvas already holds this frame's verse as it would be rendered now. */
export function feedLayerFresh(canvas: HTMLCanvasElement, l: Pick<SceneLayerFrame, "verse" | "theme">, images: number, w: number, h: number): boolean {
  const last = feedRendered.get(canvas)
  return !!last && last.verse === l.verse && last.theme === l.theme && last.images === images && last.fonts === fontsLoaded && last.w === w && last.h === h
}

/**
 * A colour layer's polygon or line (#448), as the Design editor draws it: a polygon's points around
 * the box's centre, filled and then outlined; a line through the editor's own line drawing (round
 * caps, arrowheads sized by its width). Sizes are artboard px, scaled with the frame.
 */
function paintVector(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, v: SceneVector, r: { x: number; y: number; w: number; h: number }, height: number): void {
  const k = height / 1080
  const sx = r.w / v.width, sy = r.h / v.height
  if (v.type === "polygon") {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2
    ctx.beginPath()
    v.points.forEach((p, i) => (i === 0 ? ctx.moveTo(cx + p.x * sx, cy + p.y * sy) : ctx.lineTo(cx + p.x * sx, cy + p.y * sy)))
    ctx.closePath()
    ctx.fillStyle = scenePaint(ctx, l.color ?? "#000", l.gradient, r)
    ctx.fill()
    if (l.outline) {
      ctx.strokeStyle = l.outline.color
      ctx.lineWidth = l.outline.width * k
      ctx.stroke()
    }
    return
  }
  // The editor's line drawing (canvas2d/shapes.ts renderCanvas2DLineCommand), here without its
  // effects step: drawScene already set this layer's shadow and blur, once, scaled with the frame.
  const color = l.outline?.color ?? l.color ?? "#ffffff"
  const width = (l.outline?.width ?? 4) * k
  const x1 = r.x + v.x1 * sx, y1 = r.y + v.y1 * sy, x2 = r.x + v.x2 * sx, y2 = r.y + v.y2 * sy
  const bulge = v.curveBulge * Math.min(sx, sy)
  let cpX = (x1 + x2) / 2, cpY = (y1 + y2) / 2
  const curved = bulge !== 0
  if (curved) {
    const len = Math.hypot(x2 - x1, y2 - y1)
    if (len > 0) {
      cpX = x1 + v.curveT * (x2 - x1) + bulge * (-(y2 - y1) / len)
      cpY = y1 + v.curveT * (y2 - y1) + bulge * ((x2 - x1) / len)
    }
  }
  const head = Math.max(5, Math.min(72, Math.max(1, width) * 2.25))
  const inset = head * 0.65
  const angle = Math.atan2(y2 - y1, x2 - x1)
  let dx1 = x1, dy1 = y1, dx2 = x2, dy2 = y2
  if (v.arrowEnd) { const a = curved ? Math.atan2(y2 - cpY, x2 - cpX) : angle; dx2 = x2 - inset * Math.cos(a); dy2 = y2 - inset * Math.sin(a) }
  if (v.arrowStart) { const a = curved ? Math.atan2(y1 - cpY, x1 - cpX) : angle + Math.PI; dx1 = x1 - inset * Math.cos(a); dy1 = y1 - inset * Math.sin(a) }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(dx1, dy1)
  if (curved) ctx.quadraticCurveTo(cpX, cpY, dx2, dy2)
  else ctx.lineTo(dx2, dy2)
  ctx.stroke()
  const arrowhead = (tipX: number, tipY: number, fromX: number, fromY: number) => {
    const a = Math.atan2(tipY - fromY, tipX - fromX)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(tipX - head * Math.cos(a - Math.PI / 7), tipY - head * Math.sin(a - Math.PI / 7))
    ctx.lineTo(tipX - head * Math.cos(a + Math.PI / 7), tipY - head * Math.sin(a + Math.PI / 7))
    ctx.closePath()
    ctx.fill()
  }
  if (v.arrowEnd) arrowhead(x2, y2, curved ? cpX : x1, curved ? cpY : y1)
  if (v.arrowStart) arrowhead(x1, y1, curved ? cpX : x2, curved ? cpY : y2)
}

/** One layer's content in its box (`ctx`'s alpha is already the layer's opacity). */
function paintLayer(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: { x: number; y: number; w: number; h: number }, height: number, opts: SceneDrawOptions, span: FrameSpan): void {
  if (l.kind === "color" && l.vector) {
    paintVector(ctx, l, l.vector, r, height)
  } else if (l.kind === "color" && !l.corner && !l.outline) {
    ctx.fillStyle = scenePaint(ctx, l.color ?? "#000", l.gradient, r)
    ctx.fillRect(r.x, r.y, r.w, r.h)
  } else if (l.kind === "color" || l.kind === "ellipse") {
    // As the editor draws a shape (#448): the path, filled, then its outline centred on the edge;
    // corners and outline are artboard px, scaled with the frame like text.
    const k = height / 1080
    ctx.beginPath()
    if (l.kind === "ellipse") ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
    else roundedCanvas2DRectPath(ctx, r.x, r.y, r.w, r.h, (l.corner ?? 0) * k)
    ctx.fillStyle = scenePaint(ctx, l.color ?? (l.kind === "ellipse" ? "#3157a4" : "#000"), l.gradient, r)
    ctx.fill()
    if (l.outline) {
      ctx.strokeStyle = l.outline.color
      ctx.lineWidth = l.outline.width * k
      ctx.stroke()
    }
  } else if (l.kind === "picture" && l.imageUrl) {
    const img = opts.image(l.imageUrl)
    if (img && img.naturalWidth > 0 && l.imageDraw) drawEditorPicture(ctx, img, l.imageDraw, r)
    else if (img && img.naturalWidth > 0) {
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
    paintStaticText(ctx, l, r, height, span)
  } else if (l.kind === "feed" && l.theme && l.verse) {
    const lc = opts.layerCanvas(l.id)
    const { width: tw, height: th } = l.theme.resolution
    if (lc.width !== tw || lc.height !== th) {
      lc.width = tw
      lc.height = th
    }
    // A version, not the size: a cache that lets pictures go can stay the same size as one arrives.
    const images = imageCacheVersion(opts.imageCache)
    const lctx = feedLayerFresh(lc, l, images, tw, th) ? null : lc.getContext("2d")
    if (lctx) {
      lctx.clearRect(0, 0, tw, th)
      renderVerse(lctx, l.theme, l.verse, { scale: 1, imageCache: opts.imageCache })
      feedRendered.set(lc, { verse: l.verse, theme: l.theme, images, fonts: fontsLoaded, w: tw, h: th })
    }
    const s = source(l, tw, th)
    ctx.drawImage(lc, s.sx, s.sy, s.sw, s.sh, r.x, r.y, r.w, r.h)
  }
}

/** Where each fade canvas was painted from (its region of the frame), so old content goes back there. */
const fadeRegions = new WeakMap<HTMLCanvasElement, Rect>()

/**
 * The part of the frame a layer paints into, in the layer's own (unturned) space: its box, a shape
 * with its outline, or for text that widens past its box (`textWiden`), the widened block (same height).
 */
function paintRegion(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: Rect, height: number, span: FrameSpan): Rect {
  // A polygon or line (#448): its own extent with the box, and room for a pointed outline's mitre
  // or an arrowhead.
  if (l.kind === "color" && l.vector) {
    const v = l.vector, sx = r.w / v.width, sy = r.h / v.height
    const xs = v.type === "polygon" ? v.points.map((p) => r.x + r.w / 2 + p.x * sx) : [r.x + v.x1 * sx, r.x + v.x2 * sx]
    const ys = v.type === "polygon" ? v.points.map((p) => r.y + r.h / 2 + p.y * sy) : [r.y + v.y1 * sy, r.y + v.y2 * sy]
    const pad = Math.ceil(((l.outline?.width ?? 0) * 2 + (v.type === "line" ? 72 : 0)) * height / 1080) + 2
    const x0 = Math.floor(Math.min(r.x, ...xs)) - pad, y0 = Math.floor(Math.min(r.y, ...ys)) - pad
    const x1 = Math.ceil(Math.max(r.x + r.w, ...xs)) + pad, y1 = Math.ceil(Math.max(r.y + r.h, ...ys)) + pad
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
  // A shape's outline is centred on its edge: half of it lies outside the box (#448).
  if (l.outline && (l.kind === "color" || l.kind === "ellipse")) {
    const half = Math.ceil((l.outline.width * height) / 1080 / 2) + 1
    return { x: Math.floor(r.x) - half, y: Math.floor(r.y) - half, w: Math.ceil(r.w) + 2 * half + 1, h: Math.ceil(r.h) + 2 * half + 1 }
  }
  if (l.kind !== "text" || !l.text || !widening(l)) return r
  ctx.save()
  const { left, width } = staticTextLayout(ctx, l, r, height, span)
  ctx.restore()
  // Whole pixels across, so the fade canvas is placed 1:1 and the words are not resampled.
  const x0 = Math.floor(left), x1 = Math.ceil(left + width)
  return { x: x0, y: r.y, w: x1 - x0, h: r.h }
}

/**
 * A layer with a fade: its content painted into a canvas of its own and placed over the old
 * content fading out. A camera or video the page shows under the canvas cannot fade there: it cuts.
 * The canvas covers everything the layer paints (a widened text block too), in the layer's own
 * space, so a turned layer is turned by the caller as a whole.
 */
function paintFading(ctx: CanvasRenderingContext2D, l: SceneLayerFrame, r: { x: number; y: number; w: number; h: number }, height: number, opts: SceneDrawOptions, fader: LayerFader, span: FrameSpan): void {
  const region = paintRegion(ctx, l, r, height, span)
  const w = Math.max(1, Math.round(region.w)), h = Math.max(1, Math.round(region.h))
  const { canvas, from, p } = fader.begin(l.id, l.key ?? "", l.fadeMs ?? 0, w, h)
  const c = canvas.getContext("2d")
  if (!c) return paintLayer(ctx, l, r, height, opts, span)
  c.save()
  c.clearRect(0, 0, w, h)
  c.translate(-region.x, -region.y)
  // Effects go on when this picture is drawn below (drawScene), not into it as well.
  paintLayer(c, { ...l, opacity: 1, shadow: undefined, blur: undefined }, r, height, opts, span)
  c.restore()
  fadeRegions.set(canvas, region)
  if (from) {
    const was = fadeRegions.get(from) ?? r
    ctx.globalAlpha = l.opacity * (1 - p)
    ctx.drawImage(from, was.x, was.y, was.w, was.h)
  }
  ctx.globalAlpha = l.opacity * p
  ctx.drawImage(canvas, region.x, region.y, region.w, region.h)
}

/**
 * Draw a scene: the background, then each layer in its box, bottom first. A feed layer is its look
 * drawn whole (a transparent look stays transparent) and then cropped and scaled into its box, so a
 * layer looks exactly like the same look on an output of its own. A feed with nothing live shows
 * nothing. With a fader, a layer that has a fade cross-fades to new content.
 */
/**
 * Where a scene's layers go on a canvas (#448): all of it, or for a scene laid out for another
 * shape (a design on a 4:3 or portrait output) the largest centred area of that shape.
 */
export function sceneArea(width: number, height: number, aspect: number | undefined): { x: number; y: number; w: number; h: number } {
  if (!aspect || !(aspect > 0) || !(width > 0) || !(height > 0) || Math.abs(width / height - aspect) < 0.01) return { x: 0, y: 0, w: width, h: height }
  const w = Math.min(width, height * aspect)
  const h = w / aspect
  return { x: (width - w) / 2, y: (height - h) / 2, w, h }
}

export function drawScene(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, frame: SceneFrame, opts: SceneDrawOptions): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  // Layers are laid out in the scene's own area; the background fills the bars around it.
  const area = sceneArea(canvasWidth, canvasHeight, frame.aspect)
  if (frame.backgroundGradient || frame.background !== "transparent") {
    ctx.fillStyle = scenePaint(ctx, frame.background, frame.backgroundGradient, area)
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)
  }
  const width = area.w
  const height = area.h
  const span = { x: area.x, w: width }
  opts.fader?.keep(new Set(frame.layers.map((l) => l.id)))
  for (const l of frame.layers) {
    const box = rect(l, width, height)
    const r = { ...box, x: box.x + area.x, y: box.y + area.y }
    ctx.save()
    // A turned layer (#851 G7) turns about the point the design editor turns it about.
    if (layerTurns(l.kind) && l.rotation) turnAbout(ctx, layerPivot(ctx, l, r, height, span), l.rotation)
    ctx.globalAlpha = l.opacity
    // Its shadow and blur (#448), as the editor sets them before drawing a node: sizes are artboard
    // px, scaled with the frame (a canvas shadow ignores the transform). A fading layer gets them
    // when its finished picture is drawn here: the same outside it, though a part's shadow on
    // another part of the same layer (an outline on its own fill) is not drawn while it fades.
    const fx = (l.shadow || l.blur) && EFFECT_KINDS.has(l.kind)
    if (fx) {
      const k = height / 1080
      applyCanvas2DEffects(ctx, {
        shadow: l.shadow ? { colorHex: l.shadow.color, opacityPct: l.shadow.opacity * 100, blur: l.shadow.blur * k, offsetX: l.shadow.x * k, offsetY: l.shadow.y * k } : null,
        blur: 0,
      })
      // The editor's blur: its 0–100 amount × 0.4 px, here scaled with the frame (a 4K screen blurs
      // twice as many pixels; clamping before scaling would blur it less than the editor shows).
      if (l.blur) ctx.filter = `blur(${(Math.min(100, l.blur) * 0.4 * k).toFixed(2)}px)`
    }
    if (opts.fader && l.fadeMs && !opts.preview && !opts.cameraBelow?.(l.id)) paintFading(ctx, l, r, height, opts, opts.fader, span)
    else paintLayer(ctx, l, r, height, opts, span)
    if (fx) applyCanvas2DEffects(ctx, { shadow: null, blur: 0 })
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
