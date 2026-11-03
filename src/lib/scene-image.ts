import type { ImageDraw, Scene, SceneClip } from "../types/scene"

/**
 * Pictures cropped, rounded and clipped in the Avnac editor (#448 Slice B), kept as the editor
 * keeps them and drawn the same way on every output. One rule for what can be drawn, used by the
 * design adapter (which refuses the rest with this reason) and by stored scenes.
 */
export const MAX_IMAGE_CLIPS = 4
const SIZE = 20_000
const PIXELS = 100_000

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi

function clipIssue(c: unknown): string | null {
  const clip = c as Partial<SceneClip> | null
  if (!clip || (clip.type !== "rect" && clip.type !== "ellipse")) return "Pictures can be clipped to rectangles and ellipses only"
  if (!finite(clip.x, -SIZE, SIZE) || !finite(clip.y, -SIZE, SIZE) || !finite(clip.width, 0.001, SIZE) || !finite(clip.height, 0.001, SIZE)) return "A picture's clip needs a finite position and a size"
  if (clip.type === "rect" && (!finite(clip.radiusX, 0, SIZE) || !finite(clip.radiusY, 0, SIZE))) return "A picture's rectangular clip needs finite corner sizes"
  return null
}

/** Why Rhema's outputs cannot draw this picture as the editor does, or null when they can. */
export function imageDrawIssue(raw: unknown): string | null {
  const d = raw as Partial<ImageDraw> | null
  if (!d || typeof d !== "object") return "A cropped picture needs its size and crop"
  if (!finite(d.width, 0.001, SIZE) || !finite(d.height, 0.001, SIZE)) return "A cropped picture needs a finite size"
  if (!finite(d.cropX, 0, PIXELS) || !finite(d.cropY, 0, PIXELS)) return "A picture's crop cannot start before its edge"
  if ((d.cropWidth !== undefined && !finite(d.cropWidth, 1, PIXELS)) || (d.cropHeight !== undefined && !finite(d.cropHeight, 1, PIXELS))) return "A picture's crop needs a size of at least one pixel"
  if (d.radius !== undefined && !finite(d.radius, 0, SIZE)) return "A picture's rounded corners need a finite size"
  if (d.clips !== undefined) {
    if (!Array.isArray(d.clips) || d.clips.length > MAX_IMAGE_CLIPS) return `A picture can have at most ${MAX_IMAGE_CLIPS} clips`
    for (const clip of d.clips) {
      const why = clipIssue(clip)
      if (why) return why
    }
  }
  return null
}

/** A copy of a picture's editor drawing Rhema can draw, or undefined. */
export function normalizeImageDraw(raw: unknown): ImageDraw | undefined {
  if (imageDrawIssue(raw)) return undefined
  const d = raw as ImageDraw
  const clips = (d.clips ?? []).map((c): SceneClip => (c.type === "ellipse"
    ? { type: "ellipse", x: c.x, y: c.y, width: c.width, height: c.height }
    : { type: "rect", x: c.x, y: c.y, width: c.width, height: c.height, radiusX: c.radiusX, radiusY: c.radiusY }))
  return {
    width: d.width, height: d.height, cropX: d.cropX, cropY: d.cropY,
    ...(d.cropWidth !== undefined ? { cropWidth: d.cropWidth } : {}),
    ...(d.cropHeight !== undefined ? { cropHeight: d.cropHeight } : {}),
    ...(d.radius ? { radius: d.radius } : {}),
    ...(clips.length ? { clips } : {}),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * A saved scene's pictures after an edit (`prev` → `next`): the editor's drawing of a picture stays
 * only while that picture and its Rhema crop are the ones it was made for. Another picture (a new
 * library pick) or a Rhema crop set over it, with the drawing left as it was, drops the drawing, so
 * the picture covers its box with that crop as Rhema's own pictures do.
 */
export function dropStaleImageDraws(next: Scene, prev: Scene | undefined): Scene {
  if (!prev) return next
  const was = new Map(prev.layers.map((l) => [l.id, l]))
  let changed = false
  const layers = next.layers.map((l) => {
    const old = was.get(l.id)
    if (!l.imageDraw || !old || !same(l.imageDraw, old.imageDraw)) return l
    if (l.imageUrl === old.imageUrl && l.mediaId === old.mediaId && same(l.crop, old.crop)) return l
    changed = true
    const plain = { ...l }
    delete plain.imageDraw
    return plain
  })
  return changed ? { ...next, layers } : next
}
