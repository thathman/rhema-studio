import type { SceneFrame, SceneLayerFrame } from "@/types"

/**
 * What a camera's box shows while the camera is not sending: SMPTE colour bars (drawn once per box
 * size and kept) or TV static (a few noise tiles made once, shown in turn). Both are cheap: the bars
 * are one picture copied each frame, the static a small tile scaled up, and the static moves only
 * NOISE_FPS times a second.
 */

/** How many times a second the static changes; the screens redraw at this rate only while static shows. */
export const NOISE_FPS = 12

type Rgb = readonly [number, number, number]
export interface Bar {
  x: number
  y: number
  w: number
  h: number
  rgb: Rgb
}

// SMPTE EG 1-1990 colour bars, 75% bars in 8-bit sRGB (black at 7.5%, the pluge at 3.5% / 7.5% / 11.5%).
const GREY: Rgb = [191, 191, 191]
const YELLOW: Rgb = [191, 191, 0]
const CYAN: Rgb = [0, 191, 191]
const GREEN: Rgb = [0, 191, 0]
const MAGENTA: Rgb = [191, 0, 191]
const RED: Rgb = [191, 0, 0]
const BLUE: Rgb = [0, 0, 191]
const BLACK: Rgb = [19, 19, 19]
const MINUS_I: Rgb = [0, 33, 76]
const WHITE: Rgb = [255, 255, 255]
const PLUS_Q: Rgb = [50, 0, 106]
const PLUGE_LOW: Rgb = [9, 9, 9]
const PLUGE_HIGH: Rgb = [29, 29, 29]

const TOP = [GREY, YELLOW, CYAN, GREEN, MAGENTA, RED, BLUE]
const STRIP = [BLUE, BLACK, MAGENTA, BLACK, CYAN, BLACK, GREY]

/**
 * The bars for a w×h box, in whole pixels so every edge is crisp: the seven bars (top 67%), the
 * thin reverse strip (8%), and the bottom row (−I, white, +Q and black across five sevenths, then
 * the pluge −4/0/+4% and black).
 */
export function barGeometry(width: number, height: number): Bar[] {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height))
  const col = (i: number) => Math.round((w * i) / 7)
  const y1 = Math.round(h * 0.67), y2 = Math.round(h * 0.75)
  const bars: Bar[] = []
  const add = (x0: number, x1: number, y0: number, yb: number, rgb: Rgb) => { if (x1 > x0 && yb > y0) bars.push({ x: x0, y: y0, w: x1 - x0, h: yb - y0, rgb }) }
  for (let i = 0; i < 7; i++) {
    add(col(i), col(i + 1), 0, y1, TOP[i])
    add(col(i), col(i + 1), y1, y2, STRIP[i])
  }
  // The bottom row: four wide blocks over the first five bars, each 5/4 of a bar wide.
  const wide = (i: number) => Math.round((w * 5 * i) / 28)
  ;[MINUS_I, WHITE, PLUS_Q, BLACK].forEach((rgb, i) => add(wide(i), wide(i + 1), y2, h, rgb))
  // The pluge, in thirds of the sixth bar; then black under the last bar.
  const p = (i: number) => Math.round(col(5) + ((col(6) - col(5)) * i) / 3)
  ;[PLUGE_LOW, BLACK, PLUGE_HIGH].forEach((rgb, i) => add(p(i), p(i + 1), y2, h, rgb))
  add(col(6), w, y2, h, BLACK)
  return bars
}

const css = ([r, g, b]: Rgb) => `rgb(${r},${g},${b})`
const makeCanvas = (w: number, h: number) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return c
}

/** Bars already drawn, per box size and ident; a few sizes only (a screen, its preview, a thumbnail). */
const barsCache = new Map<string, HTMLCanvasElement>()

/** A broadcast-style ident in the bars' lower left: the camera's name in white on black. */
function drawIdent(c: CanvasRenderingContext2D, w: number, h: number, name: string): void {
  const size = Math.max(8, Math.round(h * 0.042))
  c.font = `600 ${size}px "IBM Plex Sans", sans-serif`
  const text = name.length > 40 ? `${name.slice(0, 39)}…` : name
  const pad = Math.round(size * 0.6)
  const tw = Math.min(c.measureText(text).width, w * 0.6)
  const bh = Math.round(size * 1.7)
  const x = Math.round(w * 0.04), y = Math.round(h * 0.67) - bh - Math.round(h * 0.04)
  c.fillStyle = "rgb(19,19,19)"
  c.fillRect(x, y, Math.round(tw + pad * 2), bh)
  c.fillStyle = "#ffffff"
  c.textAlign = "left"
  c.textBaseline = "middle"
  c.fillText(text, x + pad, y + bh / 2, w * 0.6)
}

/** The bars for a box size (and ident), drawn once. */
export function barsPicture(w: number, h: number, ident?: string): HTMLCanvasElement | null {
  const key = `${w}x${h}|${ident ?? ""}`
  let c = barsCache.get(key)
  if (c) return c
  c = makeCanvas(w, h)
  const ctx = c.getContext("2d")
  if (!ctx) return null
  for (const b of barGeometry(w, h)) {
    ctx.fillStyle = css(b.rgb)
    ctx.fillRect(b.x, b.y, b.w, b.h)
  }
  if (ident) drawIdent(ctx, w, h, ident)
  if (barsCache.size >= 12) barsCache.clear()
  barsCache.set(key, c)
  return c
}

/** A box in whole pixels, so the bars' edges land on pixels. */
const snap = (r: { x: number; y: number; w: number; h: number }) => {
  const x = Math.round(r.x), y = Math.round(r.y)
  return { x, y, w: Math.max(1, Math.round(r.x + r.w) - x), h: Math.max(1, Math.round(r.y + r.h) - y) }
}

/** Colour bars filling the box. */
export function drawBars(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, ident?: string): void {
  const s = snap(r)
  const pic = barsPicture(s.w, s.h, ident)
  if (pic) ctx.drawImage(pic, s.x, s.y)
}

const TILE_W = 320, TILE_H = 180, TILES = 6
let tiles: HTMLCanvasElement[] | null = null

/** One tile of grey noise: a little darker than mid-grey on average, with faint horizontal bands. */
export function noiseTile(w: number, h: number, random: () => number = Math.random): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    // A row a little lighter or darker than its neighbours, as on an untuned set.
    const band = (random() - 0.5) * 24 + Math.sin(y * 0.21) * 6
    for (let x = 0; x < w; x++) {
      const v = random() * 200 + 15 + band
      const i = (y * w + x) * 4
      px[i] = px[i + 1] = px[i + 2] = v
      px[i + 3] = 255
    }
  }
  return px
}

function noiseTiles(): HTMLCanvasElement[] {
  if (tiles) return tiles
  tiles = []
  for (let t = 0; t < TILES; t++) {
    const c = makeCanvas(TILE_W, TILE_H)
    const ctx = c.getContext("2d")
    if (!ctx) continue
    const img = ctx.createImageData(TILE_W, TILE_H)
    img.data.set(noiseTile(TILE_W, TILE_H))
    ctx.putImageData(img, 0, 0)
    tiles.push(c)
  }
  return tiles
}

/** Which picture of the static shows at `now` (ms): it changes NOISE_FPS times a second. */
export const noiseFrame = (now: number) => Math.floor((now * NOISE_FPS) / 1000)

/**
 * TV static filling the box: one of the tiles, scaled up to the box, mirrored a different way each
 * time round (so the few tiles do not look like a loop; the faint bands stay level).
 */
export function drawStatic(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, now: number): void {
  const all = noiseTiles()
  if (all.length === 0) return
  const n = Math.abs(noiseFrame(now))
  const tile = all[n % all.length]
  const flip = Math.floor(n / all.length) % 4
  const fx = flip & 1 ? -1 : 1, fy = flip & 2 ? -1 : 1
  ctx.save()
  ctx.translate(r.x + (fx < 0 ? r.w : 0), r.y + (fy < 0 ? r.h : 0))
  ctx.scale(fx, fy)
  ctx.drawImage(tile, 0, 0, r.w, r.h)
  ctx.restore()
}

/** What a camera layer's box shows while it is not playing. */
export function noSignalOf(l: Pick<SceneLayerFrame, "noSignal">): NonNullable<SceneLayerFrame["noSignal"]> {
  return l.noSignal ?? "bars"
}

/**
 * Some camera in the scene shows static now (it is not playing): the screen has to keep redrawing,
 * NOISE_FPS times a second. `playing`: that layer's camera has a picture.
 */
export function sceneStatic(frame: SceneFrame | undefined, playing: (layerId: string) => boolean): boolean {
  return !!frame?.layers.some((l) => l.kind === "camera" && l.opacity > 0 && noSignalOf(l) === "static" && !playing(l.id))
}
