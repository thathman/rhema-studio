// Scene Composer hit-testing for turned layers (#851 G7): the canvas draws a layer turned about
// its pivot, so the pointer is turned back into the layer's own space before it is tested.
import { layerPivot } from "@/lib/scene-renderer"
import { pointInTurnedBox, layerTurns } from "@/lib/scene-rotation"
import type { SceneBox, SceneLayerFrame } from "@/types"

/** A layer as the composer hit-tests it; `pivot` in % of the frame (absent: the box's centre). */
export interface HitLayer {
  id: string
  kind: string
  box: SceneBox
  rotation?: number
  pivot?: { x: number; y: number }
}

const centreOf = (b: SceneBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/**
 * The topmost layer under a point (in % of a `width`×`height` frame), or null. A layer is turned
 * in pixels, as the canvas draws it, so a turned layer is hit where it shows, not by its upright box.
 */
export function layerAt(layers: readonly HitLayer[], p: { x: number; y: number }, width: number, height: number): string | null {
  const px = (v: { x: number; y: number }) => ({ x: (v.x / 100) * width, y: (v.y / 100) * height })
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!
    const r = { x: (l.box.x / 100) * width, y: (l.box.y / 100) * height, w: (l.box.w / 100) * width, h: (l.box.h / 100) * height }
    const rotation = layerTurns(l.kind) ? l.rotation : undefined
    if (pointInTurnedBox(px(p), r, px(l.pivot ?? centreOf(l.box)), rotation)) return l.id
  }
  return null
}

/**
 * Where a layer turns, in % of the frame: the renderer's own pivot (a text layer turns about the
 * centre of its words). Without a measuring context, the box's centre.
 */
export function framePivot(ctx: CanvasRenderingContext2D | null, l: SceneLayerFrame, width: number, height: number): { x: number; y: number } {
  if (!ctx || !l.rotation || l.kind !== "text") return centreOf(l.box)
  const r = { x: (l.box.x / 100) * width, y: (l.box.y / 100) * height, w: (l.box.w / 100) * width, h: (l.box.h / 100) * height }
  const p = layerPivot(ctx, l, r, height)
  return { x: (p.x / width) * 100, y: (p.y / height) * 100 }
}

/**
 * A turned layer resized from its bottom-right handle to `size` (% of a `width`×`height` frame),
 * moved so its opposite (top-left) corner stays where it shows on screen. A turned layer turns
 * about a pivot inside its box, so growing the box alone would move the pivot and the layer would
 * drift while it is dragged. `pivotOf` is where a box of that size turns, in % of the frame (by
 * default its centre; a text layer turns about its words). If the box would leave the frame, the
 * resize stops where it still fits. An upright layer keeps its top-left and only changes size.
 */
export function resizeTurned(
  start: SceneBox,
  size: { w: number; h: number },
  rotation: number | undefined,
  width: number,
  height: number,
  pivotOf: (b: SceneBox) => { x: number; y: number } = centreOf,
): SceneBox {
  if (!rotation) return { ...start, w: Math.min(size.w, 100 - start.x), h: Math.min(size.h, 100 - start.y) }
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const turn = (v: { x: number; y: number }) => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos })
  // The pivot's offset from the box's top-left corner, in pixels.
  const offset = (b: SceneBox) => {
    const p = pivotOf(b)
    return { x: ((p.x - b.x) / 100) * width, y: ((p.y - b.y) / 100) * height }
  }
  // Where the top-left corner shows on screen: pivot + turn(corner - pivot).
  const o0 = offset(start), t0 = turn({ x: -o0.x, y: -o0.y })
  const corner = { x: (start.x / 100) * width + o0.x + t0.x, y: (start.y / 100) * height + o0.y + t0.y }
  const place = (w: number, h: number): SceneBox => {
    const o = offset({ x: start.x, y: start.y, w, h }), t = turn(o)
    return { x: ((corner.x - o.x + t.x) / width) * 100, y: ((corner.y - o.y + t.y) / height) * 100, w, h }
  }
  const fits = (b: SceneBox) => b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.w <= 100 + 1e-9 && b.y + b.h <= 100 + 1e-9
  const target = place(size.w, size.h)
  if (fits(target)) return target
  // Shrink the change until the box fits (the start box is in the frame).
  let lo = 0, hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (fits(place(start.w + (size.w - start.w) * mid, start.h + (size.h - start.h) * mid))) lo = mid
    else hi = mid
  }
  return place(start.w + (size.w - start.w) * lo, start.h + (size.h - start.h) * lo)
}

/** A drag of (dx, dy) screen pixels, turned into a layer's own axes (for resizing a turned layer). */
export function unturnDelta(dx: number, dy: number, rotation: number | undefined): { dx: number; dy: number } {
  if (!rotation) return { dx, dy }
  const rad = (-rotation * Math.PI) / 180
  return { dx: dx * Math.cos(rad) - dy * Math.sin(rad), dy: dx * Math.sin(rad) + dy * Math.cos(rad) }
}
