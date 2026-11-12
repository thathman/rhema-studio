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

/** A drag of (dx, dy) screen pixels, turned into a layer's own axes (for resizing a turned layer). */
export function unturnDelta(dx: number, dy: number, rotation: number | undefined): { dx: number; dy: number } {
  if (!rotation) return { dx, dy }
  const rad = (-rotation * Math.PI) / 180
  return { dx: dx * Math.cos(rad) - dy * Math.sin(rad), dy: dx * Math.sin(rad) + dy * Math.cos(rad) }
}
