import { clearCache } from "@chenglou/pretext"
import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineItem,
  type RichInlineLine,
} from "@chenglou/pretext/rich-inline"
import { imageContentBox } from "@/lib/theme-image-cache"
import type {
  BroadcastTheme,
  SurfaceFill,
  ThemeImageFill,
  VerseRenderData,
  RenderOptions,
  VerseTextStyle,
  ThemeLogo,
} from "@/types/broadcast"

// Pretext lazily creates one internal measurement context, preferring
// OffscreenCanvas. Force that creation with a DOM canvas instead — older
// WebKit versions don't expose document webfonts to OffscreenCanvas, and a
// DOM canvas behaves identically everywhere.
function primePretextMeasureContext(): void {
  if (typeof document === "undefined") return
  const g = globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }
  const original = g.OffscreenCanvas
  try {
    g.OffscreenCanvas = undefined
    prepareRichInline([{ text: "prime", font: "16px serif" }])
  } finally {
    g.OffscreenCanvas = original
  }
  // Widths measured before a webfont finished loading came from the fallback
  // font and are cached per font string — drop them whenever loading settles.
  // (Consumers redraw on this same event.)
  document.fonts?.addEventListener("loadingdone", () => clearCache())
}
primePretextMeasureContext()

const requestedFontSpecs = new Set<string>()
const fontListeners = new Set<() => void>()

/**
 * Subscribe to "a theme font just finished loading" so consumers can redraw.
 * Driven by the FontFaceSet.load() promise rather than the "loadingdone"
 * event: WebKit's canvas can still measure the fallback font when the event
 * fires, but is reliably up to date once the load promise resolves.
 */
export function onThemeFontsLoaded(listener: () => void): () => void {
  fontListeners.add(listener)
  return () => fontListeners.delete(listener)
}

/**
 * Canvas `ctx.font` never triggers a webfont download: a registered
 * `@font-face` stays unloaded — and canvas silently draws the fallback font —
 * until DOM text or an explicit `FontFaceSet.load()` requests it. If the font
 * later loads for an unrelated reason (e.g. a DOM element uses it), drawing
 * switches to the real font while cached measurements still hold fallback
 * widths, so text overflows its measured layout box. Request every font a
 * theme uses up front; when a face actually arrives, invalidate pretext's
 * cache (redraws ride the resulting "loadingdone" event).
 */
function ensureThemeFontsLoaded(theme: BroadcastTheme): void {
  if (typeof document === "undefined" || !document.fonts?.load) return
  const specs = [
    `${theme.verseText.fontWeight} 16px "${theme.verseText.fontFamily}"`,
    `${theme.reference.fontWeight} 16px "${theme.reference.fontFamily}"`,
    ...(theme.secondaryVerseText
      ? [`${theme.secondaryVerseText.fontWeight} 16px "${theme.secondaryVerseText.fontFamily}"`]
      : []),
  ]
  for (const spec of specs) {
    if (requestedFontSpecs.has(spec)) continue
    requestedFontSpecs.add(spec)
    void document.fonts
      .load(spec)
      .then((faces) => {
        if (faces.length > 0) {
          clearCache()
          for (const listener of fontListeners) listener()
        }
      })
      .catch(() => {
        requestedFontSpecs.delete(spec)
      })
  }
}

export interface VerseLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface VerseLayoutMetrics {
  scaledTheme: BroadcastTheme
  /** Region the theme background is drawn in (anchored, sized by layout.backgroundWidth/Height). */
  backgroundRect: VerseLayoutRect
  /** Rect the text box backdrop is drawn at. Always the anchored text area; never follows free-mode boxes. */
  textBoxRect: VerseLayoutRect
  textAreaRect: VerseLayoutRect
  textRect: VerseLayoutRect
  referenceRect: VerseLayoutRect | null
  verseRect: VerseLayoutRect | null
  /** Auto-fitted verse font size (scaled px). Absent when there is no verse. */
  fittedVerseFontSize?: number
  /** Free-mode element boxes in canvas px. Only set when layout.mode === "free". */
  referenceBoxRect?: VerseLayoutRect | null
  verseBoxRect?: VerseLayoutRect | null
  /** Rect the reference's own chip is drawn at — hugs the reference text. */
  referenceSurfaceRect?: VerseLayoutRect | null
  /** Rect the verse's own plate is drawn at — fills the verse's area. */
  verseSurfaceRect?: VerseLayoutRect | null
}

/** Grow a rect outwards by `padding` on every side, never past zero size. */
function inflateRect(rect: VerseLayoutRect, padding: number): VerseLayoutRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: Math.max(0, rect.width + padding * 2),
    height: Math.max(0, rect.height + padding * 2),
  }
}

/**
 * Where an element's own plate is drawn: its box when it has one (free mode),
 * otherwise hugging the text plus the surface's padding.
 */
function surfaceRectFor(
  surface: SurfaceFill | undefined,
  textRect: VerseLayoutRect | null,
  boxRect: VerseLayoutRect | null | undefined
): VerseLayoutRect | null {
  if (!surface?.enabled) return null
  if (boxRect) return boxRect
  if (!textRect) return null
  return inflateRect(textRect, surface.padding)
}

/** Shrink a rect inwards by `padding` on every side, never past zero size. */
function deflateRect(rect: VerseLayoutRect, padding: number): VerseLayoutRect {
  const width = Math.max(0, rect.width - padding * 2)
  const height = Math.max(0, rect.height - padding * 2)
  return {
    x: rect.x + Math.min(padding, rect.width / 2),
    y: rect.y + Math.min(padding, rect.height / 2),
    width,
    height,
  }
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let currentLine = ""

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const metrics = ctx.measureText(testLine)

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

export interface VerseInlineHandle {
  prepared: PreparedRichInline
  /** Per-item kind, indexed by RichInlineFragment.itemIndex. */
  kinds: ("word" | "verseNum")[]
  wordFont: string
  verseNumFont: string
}

/**
 * Compile verse segments into a pretext rich-inline flow: verse numbers are
 * their own atomic items so they wrap, measure, and draw with their own font
 * size. Numbers scale proportionally with the auto-fitted verse size; when
 * superscript is off they render at the full verse size (colour still applies).
 */
export function prepareVerseInline(
  theme: BroadcastTheme,
  verse: VerseRenderData,
  effectiveFontSize: number,
  style: VerseTextStyle = theme.verseText
): VerseInlineHandle | null {
  const vt = style
  const vn = theme.verseNumbers
  const transform = resolveTextTransform(vt.textTransform)
  const ratio = vt.fontSize > 0 ? effectiveFontSize / vt.fontSize : 1
  const verseNumFontSize = vn.superscript
    ? Math.max(1, vn.fontSize * ratio)
    : effectiveFontSize
  const wordFont = `${vt.fontWeight} ${effectiveFontSize}px "${vt.fontFamily}", serif`
  const verseNumFont = `${vt.fontWeight} ${verseNumFontSize}px "${vt.fontFamily}", serif`
  const letterSpacing = vt.letterSpacing > 0 ? vt.letterSpacing : undefined

  const items: RichInlineItem[] = []
  const kinds: ("word" | "verseNum")[] = []
  for (const segment of verse.segments) {
    if (vn.visible && segment.verseNumber !== undefined) {
      items.push({
        text: `${segment.verseNumber} `,
        font: verseNumFont,
        letterSpacing,
        break: "never",
      })
      kinds.push("verseNum")
    }
    const text = applyTextTransform(segment.text, transform).trim()
    if (text) {
      items.push({ text: `${text} `, font: wordFont, letterSpacing })
      kinds.push("word")
    }
  }
  if (!items.length) return null

  return {
    prepared: prepareRichInline(items),
    kinds,
    wordFont,
    verseNumFont,
  }
}

function layoutVerseLines(
  handle: VerseInlineHandle,
  maxWidth: number
): RichInlineLine[] {
  const lines: RichInlineLine[] = []
  walkRichInlineLineRanges(handle.prepared, Math.max(1, maxWidth), (range) => {
    lines.push(materializeRichInlineLineRange(handle.prepared, range))
  })
  return lines
}

function alignX(
  textAlign: "left" | "center" | "right",
  rectX: number,
  rectWidth: number
): number {
  switch (textAlign) {
    case "left":
      return rectX
    case "center":
      return rectX + rectWidth / 2
    case "right":
      return rectX + rectWidth
  }
}

function alignY(
  verticalAlign: "top" | "middle" | "bottom",
  rectY: number,
  rectHeight: number,
  contentHeight: number
): number {
  switch (verticalAlign) {
    case "middle":
      return rectY + (rectHeight - contentHeight) / 2
    case "bottom":
      return rectY + rectHeight - contentHeight
    case "top":
    default:
      return rectY
  }
}

function resolveHorizontalAlign(
  value:
    | BroadcastTheme["verseText"]["horizontalAlign"]
    | BroadcastTheme["reference"]["horizontalAlign"]
    | undefined,
  fallback: BroadcastTheme["layout"]["textAlign"],
  allowJustify: boolean
): "left" | "center" | "right" | "justify" {
  if (!value) return fallback
  if (value === "justify" && !allowJustify) return fallback
  return value
}

function resolveVerticalAlign(
  value:
    | BroadcastTheme["verseText"]["verticalAlign"]
    | BroadcastTheme["reference"]["verticalAlign"]
    | undefined
): "top" | "middle" | "bottom" {
  return value ?? "top"
}

function resolveTextTransform(
  value:
    | BroadcastTheme["verseText"]["textTransform"]
    | BroadcastTheme["reference"]["textTransform"]
    | undefined
): "none" | "uppercase" | "lowercase" | "capitalize" {
  return value ?? "none"
}

function resolveTextDecoration(
  value:
    | BroadcastTheme["verseText"]["textDecoration"]
    | BroadcastTheme["reference"]["textDecoration"]
    | undefined
): "none" | "underline" | "line-through" {
  return value ?? "none"
}

function applyTextTransform(
  text: string,
  transform: "none" | "uppercase" | "lowercase" | "capitalize"
): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase()
    case "lowercase":
      return text.toLowerCase()
    case "capitalize":
      return text.replace(/\b\w/g, (char) => char.toUpperCase())
    case "none":
    default:
      return text
  }
}

function drawTextDecorationLine(
  ctx: CanvasRenderingContext2D,
  decoration: "none" | "underline" | "line-through",
  color: string,
  align: "left" | "center" | "right" | "justify",
  x: number,
  y: number,
  width: number,
  fontSize: number,
  fallbackLeftX?: number
): void {
  if (decoration === "none" || width <= 0) return
  const startX =
    align === "left"
      ? x
      : align === "center"
        ? x - width / 2
        : align === "right"
          ? x - width
          : (fallbackLeftX ?? x)
  const lineY =
    decoration === "underline" ? y + fontSize * 0.92 : y + fontSize * 0.52
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, fontSize * 0.06)
  ctx.beginPath()
  ctx.moveTo(startX, lineY)
  ctx.lineTo(startX + width, lineY)
  ctx.stroke()
  ctx.restore()
}

function anchorPosition(
  anchor: BroadcastTheme["layout"]["anchor"],
  areaWidth: number,
  areaHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  offsetX: number,
  offsetY: number
): { x: number; y: number } {
  let x: number
  let y: number

  switch (anchor) {
    case "top-left":
      x = 0
      y = 0
      break
    case "top-center":
      x = (canvasWidth - areaWidth) / 2
      y = 0
      break
    case "top-right":
      x = canvasWidth - areaWidth
      y = 0
      break
    case "center":
      x = (canvasWidth - areaWidth) / 2
      y = (canvasHeight - areaHeight) / 2
      break
    case "bottom-left":
      x = 0
      y = canvasHeight - areaHeight
      break
    case "bottom-center":
      x = (canvasWidth - areaWidth) / 2
      y = canvasHeight - areaHeight
      break
    case "bottom-right":
      x = canvasWidth - areaWidth
      y = canvasHeight - areaHeight
      break
  }

  return { x: x + offsetX, y: y + offsetY }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.arcTo(x + width, y, x + width, y + radius, radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius)
  ctx.lineTo(x + radius, y + height)
  ctx.arcTo(x, y + height, x, y + height - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  rect: VerseLayoutRect,
  imageCache?: Map<string, HTMLImageElement>
): void {
  const { width, height } = theme.resolution
  const bg = theme.background

  switch (bg.type) {
    case "solid":
      ctx.fillStyle = bg.color
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      break

    case "gradient": {
      if (!bg.gradient) break
      let grad: CanvasGradient

      if (bg.gradient.type === "linear") {
        const angle = (bg.gradient.angle * Math.PI) / 180
        const cx = rect.x + rect.width / 2
        const cy = rect.y + rect.height / 2
        const len =
          Math.sqrt(rect.width * rect.width + rect.height * rect.height) / 2
        grad = ctx.createLinearGradient(
          cx - Math.cos(angle) * len,
          cy - Math.sin(angle) * len,
          cx + Math.cos(angle) * len,
          cy + Math.sin(angle) * len
        )
      } else {
        grad = ctx.createRadialGradient(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          0,
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          Math.max(rect.width, rect.height) / 2
        )
      }

      for (const stop of bg.gradient.stops) {
        grad.addColorStop(stop.position / 100, stop.color)
      }

      ctx.fillStyle = grad
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      break
    }

    case "image":
      drawImageFill(ctx, bg.image, rect, 0, imageCache)
      break

    case "transparent":
      ctx.clearRect(0, 0, width, height)
      break
  }
}

/**
 * Paint an image so it fills `rect`, clipped to `radius`. Shared by the frame
 * background and every surface fill, so a picture behaves the same wherever it
 * is used. While the image is still loading a deterministic flat fill stands in.
 */
/**
 * The lower third: a dark band near the bottom with a bold first line and a
 * lighter second line, in the theme's font. Drawn last, over anything,
 * including a transparent (OBS-keyed) frame.
 */
export function drawLowerThird(ctx: CanvasRenderingContext2D, width: number, height: number, lt: { line1: string; line2: string }, fontFamily?: string): void {
  // Quoted: a family like "Source Serif 4 Variable" makes an unquoted font shorthand invalid, and the canvas ignores it.
  const family = fontFamily ? `"${fontFamily.replace(/"/g, "")}", system-ui, sans-serif` : "system-ui, sans-serif"
  const marginX = Math.round(width * 0.06)
  const bandH = Math.round(height * (lt.line2 ? 0.15 : 0.1))
  const y = Math.round(height * 0.92) - bandH
  const size1 = Math.round(bandH * (lt.line2 ? 0.36 : 0.5))
  const size2 = Math.round(bandH * 0.24)
  ctx.save()
  ctx.font = `700 ${size1}px ${family}`
  const w1 = ctx.measureText(lt.line1).width
  ctx.font = `400 ${size2}px ${family}`
  const w2 = ctx.measureText(lt.line2).width
  const padX = Math.round(bandH * 0.35)
  const bandW = Math.min(width - marginX * 2, Math.max(w1, w2) + padX * 2)
  ctx.fillStyle = "rgba(0,0,0,0.78)"
  roundRect(ctx, marginX, y, bandW, bandH, Math.round(bandH * 0.12))
  ctx.fill()
  ctx.fillStyle = "#ffffff"
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"
  const maxW = bandW - padX * 2
  if (lt.line2) {
    ctx.font = `700 ${size1}px ${family}`
    ctx.fillText(lt.line1, marginX + padX, y + bandH * 0.36, maxW)
    ctx.font = `400 ${size2}px ${family}`
    ctx.fillStyle = "rgba(255,255,255,0.85)"
    ctx.fillText(lt.line2, marginX + padX, y + bandH * 0.72, maxW)
  } else {
    ctx.font = `700 ${size1}px ${family}`
    ctx.fillText(lt.line1, marginX + padX, y + bandH / 2, maxW)
  }
  ctx.restore()
}

/** Draw a video frame into `rect` with the item's fit (cover crops, contain letterboxes, stretch fills). */
function drawVideoFrame(ctx: CanvasRenderingContext2D, el: HTMLVideoElement, rect: VerseLayoutRect, fit: "cover" | "contain" | "stretch"): void {
  const vw = el.videoWidth
  const vh = el.videoHeight
  if (fit === "stretch") {
    ctx.drawImage(el, rect.x, rect.y, rect.width, rect.height)
    return
  }
  const scale = fit === "cover" ? Math.max(rect.width / vw, rect.height / vh) : Math.min(rect.width / vw, rect.height / vh)
  const w = vw * scale
  const h = vh * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  if (fit === "contain") {
    ctx.fillStyle = "#000"
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  }
  ctx.drawImage(el, rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2, w, h)
  ctx.restore()
}

/** A plain label in the middle of the frame (a video seen from a canvas that cannot play it). */
function drawMediaLabel(ctx: CanvasRenderingContext2D, rect: VerseLayoutRect, text: string): void {
  ctx.save()
  ctx.fillStyle = "rgba(0,0,0,0.55)"
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.font = `600 ${Math.round(rect.height / 18)}px system-ui, sans-serif`
  ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width * 0.9)
  ctx.restore()
}

function drawImageFill(
  ctx: CanvasRenderingContext2D,
  image: ThemeImageFill | null,
  rect: VerseLayoutRect,
  radius: number,
  imageCache?: Map<string, HTMLImageElement>
): void {
  if (!image) {
    ctx.fillStyle = "#000"
    fillRoundRect(ctx, rect, radius)
    return
  }
  const img = imageCache?.get(image.url)
  if (!img) {
    ctx.fillStyle = image.tint ?? "#000"
    fillRoundRect(ctx, rect, radius)
    return
  }

  ctx.save()
  // Rounded clip so an image respects the surface's corner radius, and so the
  // tint below can be painted inside it rather than over the rect's edges.
  roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.clip()

  if (image.blur > 0) {
    ctx.filter = `blur(${image.blur}px) brightness(${image.brightness / 100})`
  } else if (image.brightness !== 100) {
    ctx.filter = `brightness(${image.brightness / 100})`
  }

  let drawX = rect.x
  let drawY = rect.y
  let drawW = rect.width
  let drawH = rect.height

  // Fit the artwork, not the canvas it was exported on: a band drawn in the
  // corner of a transparent 1920x1080 export must still fill its container.
  const { sx, sy, sw, sh } = imageContentBox(img)
  const imgRatio = sw / sh
  const rectRatio = rect.width / rect.height

  switch (image.fit) {
    case "cover":
      if (imgRatio > rectRatio) {
        drawH = rect.height
        drawW = rect.height * imgRatio
        drawX = rect.x + (rect.width - drawW) / 2
      } else {
        drawW = rect.width
        drawH = rect.width / imgRatio
        drawY = rect.y + (rect.height - drawH) / 2
      }
      break
    case "contain":
      if (imgRatio > rectRatio) {
        drawW = rect.width
        drawH = rect.width / imgRatio
        drawY = rect.y + (rect.height - drawH) / 2
      } else {
        drawH = rect.height
        drawW = rect.height * imgRatio
        drawX = rect.x + (rect.width - drawW) / 2
      }
      break
    case "stretch":
      break
  }

  ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH)
  ctx.filter = "none"

  if (image.tint) {
    ctx.fillStyle = image.tint
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  }
  ctx.restore()
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  rect: VerseLayoutRect,
  radius: number
): void {
  roundRect(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.fill()
}

/**
 * Paint one surface — the container behind a block of text: a colour wash and
 * then, if set, an image filling the same rect.
 */
function drawSurface(
  ctx: CanvasRenderingContext2D,
  surface: SurfaceFill | undefined,
  rect: VerseLayoutRect,
  baseOpacity: number,
  imageCache?: Map<string, HTMLImageElement>
): void {
  if (!surface?.enabled) return
  ctx.save()
  ctx.globalAlpha = baseOpacity * surface.opacity
  ctx.fillStyle = surface.color
  fillRoundRect(ctx, rect, surface.borderRadius)
  if (surface.image) {
    drawImageFill(ctx, surface.image, rect, surface.borderRadius, imageCache)
  }
  ctx.restore()
}

function drawReference(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  text: string,
  textRectX: number,
  textRectWidth: number,
  y: number
): number {
  const ref = theme.reference
  const transformed = applyTextTransform(
    ref.uppercase ? text.toUpperCase() : text,
    resolveTextTransform(ref.textTransform)
  )
  const refAlign = resolveHorizontalAlign(
    ref.horizontalAlign,
    theme.layout.textAlign,
    false
  )
  const refDecoration = resolveTextDecoration(ref.textDecoration)

  ctx.save()
  ctx.font = `${ref.fontWeight} ${ref.fontSize}px "${ref.fontFamily}", sans-serif`
  ctx.fillStyle = ref.color
  ctx.textBaseline = "top"

  if (ref.letterSpacing > 0) {
    try {
      ctx.letterSpacing = `${ref.letterSpacing}px`
    } catch {
      /* unsupported in some WebViews */
    }
  }

  const canvasAlign = refAlign === "justify" ? "left" : refAlign
  ctx.textAlign = canvasAlign
  const x = alignX(canvasAlign, textRectX, textRectWidth)
  ctx.fillText(transformed, x, y)
  const drawnWidth = Math.min(
    textRectWidth,
    Math.max(1, ctx.measureText(transformed).width)
  )
  drawTextDecorationLine(
    ctx,
    refDecoration,
    ref.color,
    refAlign,
    x,
    y,
    drawnWidth,
    ref.fontSize,
    textRectX
  )
  ctx.restore()

  return ref.fontSize * 1.5
}

function drawVerseText(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectX: number,
  textRectWidth: number,
  startY: number,
  scaledFontSize?: number,
  style?: VerseTextStyle
): number {
  const vt = style ?? theme.verseText
  const vn = theme.verseNumbers
  const verseAlign = resolveHorizontalAlign(
    vt.horizontalAlign,
    theme.layout.textAlign,
    true
  )
  const verseDecoration = resolveTextDecoration(vt.textDecoration)
  const actualFontSize = scaledFontSize ?? vt.fontSize
  const lineHeightPx = actualFontSize * vt.lineHeight

  if (verse.lines) {
    const primaryStyle = theme.verseText
    const secondaryStyle = theme.secondaryVerseText ?? primaryStyle
    const baseFontSize = scaledFontSize ?? primaryStyle.fontSize
    const primaryScale = primaryStyle.fontSize > 0 ? baseFontSize / primaryStyle.fontSize : 1
    let currentY = startY
    const blocks: Array<[string[], VerseTextStyle]> = [[verse.lines, primaryStyle]]
    if (verse.secondaryLines?.length) blocks.push([verse.secondaryLines, secondaryStyle])
    for (const [b, [lines, lineStyle]] of blocks.entries()) {
      if (b > 0) currentY += languageGapPx(theme, baseFontSize, primaryScale)
      for (const text of lines) {
        currentY += drawVerseText(ctx, theme, { reference: verse.reference, segments: [{ text }] }, textRectX, textRectWidth, currentY, lineStyle.fontSize * primaryScale, lineStyle)
      }
    }
    return currentY - startY
  }

  if (verse.translationLines && verse.translationLines.length > 1) {
    const primaryStyle = theme.verseText
    const secondaryStyle = theme.secondaryVerseText ?? primaryStyle
    const baseFontSize = scaledFontSize ?? primaryStyle.fontSize
    const primaryScale = primaryStyle.fontSize > 0
      ? baseFontSize / primaryStyle.fontSize
      : 1
    let currentY = startY
    for (const [index, text] of verse.translationLines.entries()) {
      if (index > 0) currentY += languageGapPx(theme, baseFontSize, primaryScale)
      const lineStyle = index === 0 ? primaryStyle : secondaryStyle
      const lineFontSize = lineStyle.fontSize * primaryScale
      currentY += drawVerseText(
        ctx,
        theme,
        { reference: verse.reference, segments: [{ text }] },
        textRectX,
        textRectWidth,
        currentY,
        lineFontSize,
        lineStyle
      )
    }
    return currentY - startY
  }

  ctx.save()
  ctx.textBaseline = "top"
  ctx.textAlign = "left"

  if (vt.letterSpacing > 0) {
    try {
      ctx.letterSpacing = `${vt.letterSpacing}px`
    } catch {
      /* unsupported in some WebViews */
    }
  }

  const handle = prepareVerseInline(theme, verse, actualFontSize, vt)
  if (!handle) {
    ctx.restore()
    return 0
  }
  const lines = layoutVerseLines(handle, textRectWidth)

  const drawFragment = (
    text: string,
    kind: "word" | "verseNum",
    drawX: number,
    drawY: number
  ) => {
    ctx.font = kind === "verseNum" ? handle.verseNumFont : handle.wordFont
    ctx.fillStyle = kind === "verseNum" ? vn.color : vt.color

    if (vt.shadow) {
      ctx.save()
      ctx.shadowColor = vt.shadow.color
      ctx.shadowBlur = vt.shadow.blur
      ctx.shadowOffsetX = vt.shadow.x
      ctx.shadowOffsetY = vt.shadow.y
      ctx.fillText(text, drawX, drawY)
      ctx.restore()
    }

    if (vt.outline) {
      ctx.save()
      ctx.strokeStyle = vt.outline.color
      ctx.lineWidth = vt.outline.width
      ctx.strokeText(text, drawX, drawY)
      ctx.restore()
    }

    if (!vt.shadow) {
      ctx.fillText(text, drawX, drawY)
    }
  }

  let currentY = startY
  for (const [index, line] of lines.entries()) {
    const isJustifiedLine =
      verseAlign === "justify" &&
      index < lines.length - 1 &&
      line.fragments.length > 1

    let extraGap = 0
    let lineStartX = textRectX
    let lineWidth = line.width
    if (isJustifiedLine) {
      extraGap = (textRectWidth - line.width) / (line.fragments.length - 1)
      lineWidth = textRectWidth
    } else if (verseAlign === "center") {
      lineStartX = textRectX + (textRectWidth - line.width) / 2
    } else if (verseAlign === "right") {
      lineStartX = textRectX + textRectWidth - line.width
    }

    let cursorX = lineStartX
    for (const [i, fragment] of line.fragments.entries()) {
      cursorX += fragment.gapBefore + (i > 0 ? extraGap : 0)
      drawFragment(
        fragment.text,
        handle.kinds[fragment.itemIndex],
        cursorX,
        currentY
      )
      cursorX += fragment.occupiedWidth
    }
    drawTextDecorationLine(
      ctx,
      verseDecoration,
      vt.color,
      "left",
      lineStartX,
      currentY,
      Math.min(textRectWidth, Math.max(1, lineWidth)),
      actualFontSize,
      textRectX
    )
    currentY += lineHeightPx
  }

  ctx.restore()

  return currentY - startY
}

/**
 * Space between the first and second language: the theme's setting (shrunk
 * with the text when it is fitted smaller), else one line of the first language.
 */
export function languageGapPx(theme: BroadcastTheme, baseFontSize: number, primaryScale: number): number {
  const gap = theme.layout.languageGap
  return typeof gap === "number" && gap >= 0 ? gap * primaryScale : baseFontSize * theme.verseText.lineHeight
}

function buildScaledTheme(
  theme: BroadcastTheme,
  scale: number
): BroadcastTheme {
  const layout = {
    ...theme.layout,
    offsetX: theme.layout.offsetX * scale,
    offsetY: theme.layout.offsetY * scale,
    // Gaps are theme px too: a small preview shrinks them with everything else.
    ...(typeof theme.layout.referenceGap === "number" ? { referenceGap: theme.layout.referenceGap * scale } : {}),
    ...(typeof theme.layout.languageGap === "number" ? { languageGap: theme.layout.languageGap * scale } : {}),
    padding: {
      top: theme.layout.padding.top * scale,
      right: theme.layout.padding.right * scale,
      bottom: theme.layout.padding.bottom * scale,
      left: theme.layout.padding.left * scale,
    },
  }
  return {
    ...theme,
    layout,
    resolution: {
      width: theme.resolution.width * scale,
      height: theme.resolution.height * scale,
    },
    background: {
      ...theme.background,
      image: theme.background.image
        ? {
            ...theme.background.image,
            blur: theme.background.image.blur * scale,
          }
        : null,
    },
    verseText: scaleVerseText(theme.verseText, scale),
    secondaryVerseText: theme.secondaryVerseText
      ? scaleVerseText(theme.secondaryVerseText, scale)
      : undefined,
    verseNumbers: {
      ...theme.verseNumbers,
      fontSize: theme.verseNumbers.fontSize * scale,
    },
    reference: {
      ...theme.reference,
      fontSize: theme.reference.fontSize * scale,
      letterSpacing: theme.reference.letterSpacing * scale,
      surface: scaleSurface(theme.reference.surface, scale),
    },
    textBox: scaleSurface(theme.textBox, scale)!,
  }
}

function scaleVerseText(style: VerseTextStyle, scale: number): VerseTextStyle {
  return {
    ...style,
    fontSize: style.fontSize * scale,
    letterSpacing: style.letterSpacing * scale,
    shadow: style.shadow
      ? {
          ...style.shadow,
          blur: style.shadow.blur * scale,
          x: style.shadow.x * scale,
          y: style.shadow.y * scale,
        }
      : null,
    outline: style.outline
      ? {
          ...style.outline,
          width: style.outline.width * scale,
        }
      : null,
    surface: scaleSurface(style.surface, scale),
  }
}

/**
 * Scale a surface's px-valued fields. Image blur counts: it is an absolute px
 * radius, so an unscaled value over-blurs thumbnails relative to the output.
 */
function scaleSurface(
  surface: SurfaceFill | undefined,
  scale: number
): SurfaceFill | undefined {
  if (!surface) return undefined
  return {
    ...surface,
    borderRadius: surface.borderRadius * scale,
    padding: surface.padding * scale,
    image: surface.image
      ? { ...surface.image, blur: surface.image.blur * scale }
      : null,
  }
}

/**
 * Figure out how much vertical space is left for the verse text after accounting for the reference (and its gap).
 *
 * @param theme
 * @param textRect
 * @param referenceHeight
 * @returns
 */
function calculateMaxAvailableVerseHeight(
  theme: BroadcastTheme,
  textRect: VerseLayoutRect,
  referenceHeight: number
): number {
  const referenceGap = Math.max(
    0,
    // 0.5 x fontSize scales naturally with different themes
    theme.layout.referenceGap ?? theme.reference.fontSize * 0.5
  )

  switch (theme.reference.position) {
    case "above":
      return textRect.height - referenceHeight
    case "below":
      return textRect.height - referenceHeight - referenceGap
    case "inline":
    default:
      return textRect.height
  }
}

/**
 * Returns the largest verse font size that fits within the available height without overflowing, using binary search.
 *
 * @param ctx
 * @param theme
 * @param verse
 * @param textRectWidth
 * @param maxHeight
 * @returns
 */
function calculateScaledFontSize(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectWidth: number,
  maxHeight: number
): number {
  const originalFontSize = theme.verseText.fontSize
  const minFontSize = Math.max(8, originalFontSize * 0.3) // Don't go below 30% of original or 8px

  // Binary search for optimal font size
  let low = minFontSize
  let high = originalFontSize
  // Nothing fits: the smallest size, never the full one (text that cannot fit is clipped least).
  // (A small preview's theme can be below the floor: then its own size.)
  let bestFit = Math.min(minFontSize, originalFontSize)

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)

    // If I use this font size, how tall will the verse be?
    const metrics = measureVerseHeight(ctx, theme, verse, textRectWidth, mid)

    // Check if the rendered verse is still too big to fit
    if (metrics.height <= maxHeight) {
      // Increase the font size
      bestFit = mid
      low = mid + 1
    } else {
      // Doesn't fit, decrease the font size
      high = mid - 1
    }
  }

  return bestFit
}

// The ctx parameter is kept for call-site symmetry with the draw path, but
// measurement now happens inside pretext's own canvas context.
export function measureVerseHeight(
  _ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectWidth: number,
  fontSizeOverride?: number,
  style: VerseTextStyle = theme.verseText
): { height: number; maxLineWidth: number } {
  const vt = style
  const verseAlign = resolveHorizontalAlign(
    vt.horizontalAlign,
    theme.layout.textAlign,
    true
  )
  const effectiveFontSize = fontSizeOverride ?? vt.fontSize
  const lineHeightPx = effectiveFontSize * vt.lineHeight

  if (verse.lines) {
    // Lyrics: every entry is its own line; the second language follows after
    // one blank line in the secondary style. Same scaling as dual verses.
    const primaryStyle = theme.verseText
    const secondaryStyle = theme.secondaryVerseText ?? primaryStyle
    const baseFontSize = fontSizeOverride ?? primaryStyle.fontSize
    const primaryScale = primaryStyle.fontSize > 0 ? baseFontSize / primaryStyle.fontSize : 1
    let height = 0
    let maxLineWidth = 1
    const blocks: Array<[string[], VerseTextStyle]> = [[verse.lines, primaryStyle]]
    if (verse.secondaryLines?.length) blocks.push([verse.secondaryLines, secondaryStyle])
    for (const [b, [lines, lineStyle]] of blocks.entries()) {
      if (b > 0) height += languageGapPx(theme, baseFontSize, primaryScale)
      for (const text of lines) {
        const m = measureVerseHeight(_ctx, theme, { reference: verse.reference, segments: [{ text }] }, textRectWidth, lineStyle.fontSize * primaryScale, lineStyle)
        height += m.height
        maxLineWidth = Math.max(maxLineWidth, m.maxLineWidth)
      }
    }
    return { height, maxLineWidth }
  }

  if (verse.translationLines && verse.translationLines.length > 1) {
    const primaryStyle = theme.verseText
    const secondaryStyle = theme.secondaryVerseText ?? primaryStyle
    const baseFontSize = fontSizeOverride ?? primaryStyle.fontSize
    const primaryScale = primaryStyle.fontSize > 0
      ? baseFontSize / primaryStyle.fontSize
      : 1
    let height = 0
    let maxLineWidth = 1
    for (const [index, text] of verse.translationLines.entries()) {
      if (index > 0) height += languageGapPx(theme, baseFontSize, primaryScale)
      const lineStyle = index === 0 ? primaryStyle : secondaryStyle
      const lineFontSize = lineStyle.fontSize * primaryScale
      const metrics = measureVerseHeight(
        _ctx,
        theme,
        { reference: verse.reference, segments: [{ text }] },
        textRectWidth,
        lineFontSize,
        lineStyle
      )
      height += metrics.height
      maxLineWidth = Math.max(maxLineWidth, metrics.maxLineWidth)
    }
    return { height, maxLineWidth }
  }

  const handle = prepareVerseInline(theme, verse, effectiveFontSize, vt)
  if (!handle) {
    return { height: lineHeightPx, maxLineWidth: 1 }
  }
  const stats = measureRichInlineStats(
    handle.prepared,
    Math.max(1, textRectWidth)
  )
  const maxLineWidth =
    verseAlign === "justify" && stats.lineCount > 1
      ? textRectWidth
      : stats.maxLineWidth
  return {
    height: Math.max(1, stats.lineCount) * lineHeightPx,
    maxLineWidth,
  }
}

function pctBoxToPx(
  box: { x: number; y: number; width: number; height: number },
  canvasW: number,
  canvasH: number
): VerseLayoutRect {
  return {
    x: (box.x / 100) * canvasW,
    y: (box.y / 100) * canvasH,
    width: Math.max(1, (box.width / 100) * canvasW),
    height: Math.max(1, (box.height / 100) * canvasH),
  }
}

function rectForAlignedText(
  align: BroadcastTheme["layout"]["textAlign"],
  drawX: number,
  drawY: number,
  width: number,
  height: number,
  textRect: VerseLayoutRect
): VerseLayoutRect {
  let x = drawX
  if (align === "center") x = drawX - width / 2
  if (align === "right") x = drawX - width
  const clampedX = Math.max(
    textRect.x,
    Math.min(x, textRect.x + textRect.width - width)
  )
  const clampedY = Math.max(textRect.y, drawY)
  return {
    x: clampedX,
    y: clampedY,
    width: Math.min(width, textRect.width),
    height: Math.min(height, textRect.height),
  }
}

export function computeVerseLayoutMetrics(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics {
  ensureThemeFontsLoaded(theme)
  const scale = options?.scale ?? 1
  const scaledTheme = buildScaledTheme(theme, scale)
  const canvasW = scaledTheme.resolution.width
  const canvasH = scaledTheme.resolution.height
  const layout = scaledTheme.layout

  const bgW = (layout.backgroundWidth / 100) * canvasW
  const bgH = (layout.backgroundHeight / 100) * canvasH
  const textAreaW = (layout.textAreaWidth / 100) * bgW
  const textAreaH = (layout.textAreaHeight / 100) * bgH
  const globalOffsetX = (options?.offsetX ?? 0) + layout.offsetX
  const globalOffsetY = (options?.offsetY ?? 0) + layout.offsetY
  const bgPos = anchorPosition(
    layout.anchor,
    bgW,
    bgH,
    canvasW,
    canvasH,
    globalOffsetX,
    globalOffsetY
  )
  const backgroundRect: VerseLayoutRect = {
    x: bgPos.x,
    y: bgPos.y,
    width: bgW,
    height: bgH,
  }
  // Text area is anchored within the background region (offsets are already
  // applied to the region itself). At 100% × 100% this matches anchoring to
  // the canvas directly.
  const innerPos = anchorPosition(
    layout.anchor,
    textAreaW,
    textAreaH,
    bgW,
    bgH,
    0,
    0
  )
  const pos = { x: bgPos.x + innerPos.x, y: bgPos.y + innerPos.y }

  const pad = layout.padding
  // The container's own padding insets the text too, so content wraps inside
  // the surface rather than running to its edges.
  const surfacePad = scaledTheme.textBox.enabled
    ? scaledTheme.textBox.padding
    : 0
  const textRectX = pos.x + pad.left + surfacePad
  const textRectY = pos.y + pad.top + surfacePad
  const textRectW = textAreaW - pad.left - pad.right - surfacePad * 2
  // A song's footer line (title, copyright) has its own strip at the bottom: the words fit above it.
  const textRectH = textAreaH - pad.top - pad.bottom - surfacePad * 2 - (verse?.footer ? footerSpace(scaledTheme) : 0)
  const textAreaRect: VerseLayoutRect = {
    x: pos.x,
    y: pos.y,
    width: textAreaW,
    height: textAreaH,
  }
  const textRect: VerseLayoutRect = {
    x: textRectX,
    y: textRectY,
    width: textRectW,
    height: textRectH,
  }

  const freeMode =
    layout.mode === "free" &&
    layout.referenceBox !== undefined &&
    layout.verseBox !== undefined
  const referenceBoxRect: VerseLayoutRect | null = freeMode
    ? pctBoxToPx(layout.referenceBox!, canvasW, canvasH)
    : null
  const verseBoxRect: VerseLayoutRect | null = freeMode
    ? pctBoxToPx(layout.verseBox!, canvasW, canvasH)
    : null

  if (!verse) {
    return {
      scaledTheme,
      backgroundRect,
      textBoxRect: textAreaRect,
      textAreaRect: verseBoxRect ?? textAreaRect,
      textRect: verseBoxRect ?? textRect,
      referenceRect: null,
      verseRect: null,
      referenceBoxRect,
      verseBoxRect,
      referenceSurfaceRect: null,
      verseSurfaceRect: null,
    }
  }

  const referenceHeight = scaledTheme.reference.fontSize * 1.5
  const verseAlign = resolveHorizontalAlign(
    scaledTheme.verseText.horizontalAlign,
    scaledTheme.layout.textAlign,
    true
  )
  const referenceAlign = resolveHorizontalAlign(
    scaledTheme.reference.horizontalAlign,
    scaledTheme.layout.textAlign,
    false
  )

  const refText = applyTextTransform(
    scaledTheme.reference.uppercase
      ? verse.reference.toUpperCase()
      : verse.reference,
    resolveTextTransform(scaledTheme.reference.textTransform)
  )
  const measureReferenceWidth = (maxWidth: number) => {
    ctx.save()
    ctx.font = `${scaledTheme.reference.fontWeight} ${scaledTheme.reference.fontSize}px "${scaledTheme.reference.fontFamily}", sans-serif`
    const width = Math.max(
      1,
      Math.min(maxWidth, ctx.measureText(refText).width)
    )
    ctx.restore()
    return width
  }

  // A plate on an element insets that element's text, so content sits inside
  // the fill instead of running to its edges.
  const referenceContentRect =
    referenceBoxRect && scaledTheme.reference.surface?.enabled
      ? deflateRect(referenceBoxRect, scaledTheme.reference.surface.padding)
      : referenceBoxRect
  const verseContentRect =
    verseBoxRect && scaledTheme.verseText.surface?.enabled
      ? deflateRect(verseBoxRect, scaledTheme.verseText.surface.padding)
      : verseBoxRect

  if (freeMode && referenceBoxRect && verseBoxRect) {
    const fittedVerseFontSize = calculateScaledFontSize(
      ctx,
      scaledTheme,
      verse,
      verseContentRect!.width,
      verseContentRect!.height
    )
    const verseMetrics = measureVerseHeight(
      ctx,
      scaledTheme,
      verse,
      verseContentRect!.width,
      fittedVerseFontSize
    )
    const verseY = alignY(
      resolveVerticalAlign(scaledTheme.verseText.verticalAlign),
      verseContentRect!.y,
      verseContentRect!.height,
      verseMetrics.height
    )
    const verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      alignX(
        verseAlign === "justify" ? "left" : verseAlign,
        verseContentRect!.x,
        verseContentRect!.width
      ),
      verseY,
      verseMetrics.maxLineWidth,
      verseMetrics.height,
      verseContentRect!
    )

    const referenceWidth = measureReferenceWidth(referenceContentRect!.width)
    const refY = alignY(
      resolveVerticalAlign(scaledTheme.reference.verticalAlign),
      referenceContentRect!.y,
      referenceContentRect!.height,
      referenceHeight
    )
    const referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      alignX(
        referenceAlign === "justify" ? "left" : referenceAlign,
        referenceContentRect!.x,
        referenceContentRect!.width
      ),
      refY,
      referenceWidth,
      referenceHeight,
      referenceContentRect!
    )

    return {
      scaledTheme,
      backgroundRect,
      textBoxRect: textAreaRect,
      textAreaRect: verseContentRect!,
      textRect: verseContentRect!,
      referenceRect,
      verseRect,
      fittedVerseFontSize,
      referenceBoxRect,
      verseBoxRect,
      // In free mode each element owns a box, so its plate fills that box.
      referenceSurfaceRect: surfaceRectFor(
        scaledTheme.reference.surface,
        referenceRect,
        referenceBoxRect
      ),
      verseSurfaceRect: surfaceRectFor(
        scaledTheme.verseText.surface,
        verseRect,
        verseBoxRect
      ),
    }
  }

  const blockVerticalAlign = resolveVerticalAlign(
    scaledTheme.reference.position === "above"
      ? (scaledTheme.reference.verticalAlign ??
          scaledTheme.verseText.verticalAlign)
      : (scaledTheme.verseText.verticalAlign ??
          scaledTheme.reference.verticalAlign)
  )
  const referenceGap = Math.max(
    0,
    scaledTheme.layout.referenceGap ?? scaledTheme.reference.fontSize * 0.5
  )
  const fittedVerseFontSize = calculateScaledFontSize(
    ctx,
    scaledTheme,
    verse,
    textRectW,
    calculateMaxAvailableVerseHeight(scaledTheme, textRect, referenceHeight)
  )
  const verseMetrics = measureVerseHeight(
    ctx,
    scaledTheme,
    verse,
    textRectW,
    fittedVerseFontSize
  )
  const verseHeight = verseMetrics.height
  const verseDrawX = alignX(
    verseAlign === "justify" ? "left" : verseAlign,
    textRectX,
    textRectW
  )
  const referenceDrawX = alignX(
    referenceAlign === "justify" ? "left" : referenceAlign,
    textRectX,
    textRectW
  )
  const referenceWidth = measureReferenceWidth(textRectW)

  const blockHeight =
    scaledTheme.reference.position === "above"
      ? referenceHeight + verseHeight
      : scaledTheme.reference.position === "below"
        ? verseHeight + referenceGap + referenceHeight
        : verseHeight + referenceHeight
  const blockStartY = alignY(
    blockVerticalAlign,
    textRectY,
    textRectH,
    blockHeight
  )

  let referenceRect: VerseLayoutRect
  let verseRect: VerseLayoutRect
  if (scaledTheme.reference.position === "above") {
    const refY = blockStartY
    const verseY = blockStartY + referenceHeight
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
  } else if (scaledTheme.reference.position === "below") {
    const verseY = blockStartY
    const refY = blockStartY + verseHeight + referenceGap
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
  } else {
    const verseY = blockStartY
    const refY = blockStartY + verseHeight
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
  }

  return {
    scaledTheme,
    backgroundRect,
    textBoxRect: textAreaRect,
    textAreaRect,
    textRect,
    referenceRect,
    verseRect,
    fittedVerseFontSize,
    referenceBoxRect: null,
    verseBoxRect: null,
    // Stacked mode has no per-element boxes, so each plate hugs its own text.
    referenceSurfaceRect: surfaceRectFor(
      scaledTheme.reference.surface,
      referenceRect,
      null
    ),
    verseSurfaceRect: surfaceRectFor(
      scaledTheme.verseText.surface,
      verseRect,
      null
    ),
  }
}

export function renderVerse(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics | null {
  try {
    return renderVerseImpl(ctx, theme, verse, options)
  } catch (e) {
    console.error("[verse-renderer] render error:", e)
    return null
  }
}

function renderVerseImpl(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics {
  const metrics = computeVerseLayoutMetrics(ctx, theme, verse, options)
  const scaledTheme = metrics.scaledTheme

  ctx.save()

  // Apply global opacity
  if (options?.opacity !== undefined) {
    ctx.globalAlpha = options.opacity
  }

  // Draw background
  drawBackground(ctx, scaledTheme, metrics.backgroundRect, options?.imageCache)

  // Whole-frame quick screens without text. Black on a transparent (keyed)
  // theme means nothing at all, so the stream does not get a black box.
  if (verse?.screen === "black") {
    const { width, height } = scaledTheme.resolution
    if (scaledTheme.background.type === "transparent") ctx.clearRect(0, 0, width, height)
    else {
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, width, height)
    }
    ctx.restore()
    return metrics
  }
  if (verse?.screen === "logo") {
    drawCentredLogo(ctx, scaledTheme, options?.imageCache, options?.opacity ?? 1)
    ctx.restore()
    return metrics
  }

  // A video covers the frame: its current frame where this canvas has the
  // playing element (output windows), else "▶ name" (the main window's monitors).
  // As a slide's background (words with it) the words are drawn over it, like a picture.
  if (verse?.video) {
    const frame = { x: 0, y: 0, width: scaledTheme.resolution.width, height: scaledTheme.resolution.height }
    const el = options?.video
    const hasText = Boolean(verse.reference) || Boolean(verse.lines?.length) || verse.segments.some((s) => s.text.trim())
    const playing = !!el && options?.videoState !== "failed" && el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0
    if (playing && el) drawVideoFrame(ctx, el, frame, verse.video.fit)
    // Still loading on an output: the theme background only, never a label on the live screen; never a label under words.
    else if (options?.videoState !== "loading" && !hasText) drawMediaLabel(ctx, frame, `▶ ${verse.video.name}`)
    if (!hasText) {
      ctx.restore()
      return metrics
    }
    const scrim = backgroundScrimAlpha(scaledTheme)
    if (playing && scrim > 0) {
      ctx.save()
      ctx.fillStyle = `rgba(0,0,0,${scrim})`
      ctx.fillRect(frame.x, frame.y, frame.width, frame.height)
      ctx.restore()
    }
  }

  // A picture item covers the frame; with no text at all, nothing else is drawn.
  if (verse?.image) {
    const frame = { x: 0, y: 0, width: scaledTheme.resolution.width, height: scaledTheme.resolution.height }
    drawImageFill(ctx, verse.image, frame, 0, options?.imageCache)
    const hasText = Boolean(verse.reference) || Boolean(verse.lines?.length) || verse.segments.some((s) => s.text.trim())
    if (!hasText) {
      ctx.restore()
      return metrics
    }
    // Words over a photo: darken it unless the theme already puts a solid plate under the text.
    const scrim = backgroundScrimAlpha(scaledTheme)
    if (scrim > 0) {
      ctx.save()
      ctx.fillStyle = `rgba(0,0,0,${scrim})`
      ctx.fillRect(frame.x, frame.y, frame.width, frame.height)
      ctx.restore()
    }
  }

  drawLogo(ctx, scaledTheme, options?.imageCache, options?.opacity ?? 1)

  // The container behind the reference + verse block, then each element's own
  // plate on top of it.
  const baseOpacity = options?.opacity ?? 1
  drawSurface(
    ctx,
    scaledTheme.textBox,
    metrics.textBoxRect,
    baseOpacity,
    options?.imageCache
  )
  if (metrics.referenceSurfaceRect) {
    drawSurface(
      ctx,
      scaledTheme.reference.surface,
      metrics.referenceSurfaceRect,
      baseOpacity,
      options?.imageCache
    )
  }
  if (metrics.verseSurfaceRect) {
    drawSurface(
      ctx,
      scaledTheme.verseText.surface,
      metrics.verseSurfaceRect,
      baseOpacity,
      options?.imageCache
    )
  }

  // If no verse data, just draw the background and text box
  if (!verse) {
    ctx.restore()
    return metrics
  }

  const referenceRect = metrics.referenceRect
  const verseRect = metrics.verseRect
  const verseArea = metrics.verseBoxRect ?? metrics.textRect
  const referenceArea = metrics.referenceBoxRect ?? metrics.textRect
  if (verseRect) {
    drawVerseText(
      ctx,
      scaledTheme,
      verse,
      verseArea.x,
      verseArea.width,
      verseRect.y,
      metrics.fittedVerseFontSize
    )
  }
  if (referenceRect) {
    drawReference(
      ctx,
      scaledTheme,
      verse.reference,
      referenceArea.x,
      referenceArea.width,
      referenceRect.y
    )
  }
  // In the strip kept under the text box for it (free layout: at the bottom of the verse box).
  if (verse.footer) drawFooter(ctx, scaledTheme, verse.footer, metrics.textRect, metrics.verseBoxRect ? 0 : footerSpace(scaledTheme))

  ctx.restore()
  return metrics
}

/**
 * How much to darken a background picture so light text stays readable:
 * nothing when the theme's text box is an opaque plate, a little when it is
 * translucent, a lot when the words sit straight on the picture. Dark text
 * themes get no scrim (it would only hurt).
 */
export function backgroundScrimAlpha(theme: BroadcastTheme): number {
  if (!isLightColor(theme.verseText.color)) return 0
  const box = theme.textBox
  if (box?.enabled && !box.image) {
    if (box.opacity >= 0.6) return 0
    return Math.max(0, 0.45 - box.opacity * 0.5)
  }
  return 0.45
}

function isLightColor(color: string): boolean {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return true
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5
}

/** Where the logo goes: `size`% of the frame height, 2% margin, aspect from the loaded image (square until it loads). */
export function logoRect(
  logo: Pick<ThemeLogo, "corner" | "size">,
  resolution: { width: number; height: number },
  aspect = 1
): VerseLayoutRect {
  const h = (Math.min(25, Math.max(4, logo.size)) / 100) * resolution.height
  const w = h * Math.max(0.2, aspect)
  const m = 0.02 * resolution.height
  const x = logo.corner.endsWith("left") ? m : resolution.width - m - w
  const y = logo.corner.startsWith("top") ? m : resolution.height - m - h
  return { x, y, width: w, height: h }
}

function drawLogo(ctx: CanvasRenderingContext2D, theme: BroadcastTheme, imageCache: Map<string, HTMLImageElement> | undefined, baseOpacity: number): void {
  const logo = theme.logo
  if (!logo?.url) return
  if (theme.background.type === "transparent" && !logo.showOnTransparent) return
  const img = imageCache?.get(logo.url)
  if (!img) return
  const rect = logoRect(logo, theme.resolution, img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1)
  ctx.save()
  ctx.globalAlpha = baseOpacity * Math.min(1, Math.max(0, logo.opacity))
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}

/** The theme's logo, large and centred (the Logo quick screen); the background alone when the theme has none. */
function drawCentredLogo(ctx: CanvasRenderingContext2D, theme: BroadcastTheme, imageCache: Map<string, HTMLImageElement> | undefined, baseOpacity: number): void {
  const logo = theme.logo
  if (!logo?.url) return
  if (theme.background.type === "transparent" && !logo.showOnTransparent) return
  const img = imageCache?.get(logo.url)
  if (!img) return
  const { width, height } = theme.resolution
  const aspect = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1
  let h = height * 0.4
  let w = h * aspect
  if (w > width * 0.7) {
    w = width * 0.7
    h = w / aspect
  }
  ctx.save()
  ctx.globalAlpha = baseOpacity
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h)
  ctx.restore()
}

/** Copyright line: reference style at 40% size, bottom of the text area. */
const footerSize = (theme: BroadcastTheme) => Math.max(10, theme.reference.fontSize * 0.4)
/** Height kept under the words for a footer line. */
const footerSpace = (theme: BroadcastTheme) => footerSize(theme) * 1.6

function drawFooter(ctx: CanvasRenderingContext2D, theme: BroadcastTheme, text: string, rect: VerseLayoutRect, below: number): void {
  const ref = theme.reference
  const size = footerSize(theme)
  ctx.save()
  ctx.font = `${ref.fontWeight} ${size}px "${ref.fontFamily}", sans-serif`
  ctx.fillStyle = ref.color
  ctx.globalAlpha *= 0.8
  ctx.textBaseline = "bottom"
  ctx.textAlign = "center"
  let line = text
  while (line.length > 8 && ctx.measureText(line).width > rect.width) line = `${line.slice(0, -4).trimEnd()}…`
  ctx.fillText(line, rect.x + rect.width / 2, rect.y + rect.height + below)
  ctx.restore()
}
