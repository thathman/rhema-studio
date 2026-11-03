import type { Scene, SceneGradient } from "../types/scene"

/**
 * Gradient paint in Rhema scenes (#448): the Avnac editor's linear gradients, kept typed (never
 * baked into a picture) from the design to every output. One rule for what can be drawn, used by
 * the design adapter (which refuses the rest with this reason) and by stored scenes and frames.
 */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
// Whole-number channels only: a form Canvas 2D parses on every engine (mixed % and numbers throw).
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+|1\.0+)\s*)?\)$/i

/** A stop colour as [r, g, b, a 0–1], or null when Rhema does not draw that form. */
function rgba(color: string): [number, number, number, number] | null {
  const c = color.trim()
  if (HEX.test(c)) {
    const h = c.length === 4 ? [...c.slice(1)].map((x) => x + x).join("") : c.slice(1)
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]
  }
  const m = RGB.exec(c)
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map(Number) as [number, number, number]
  return r > 255 || g > 255 || b > 255 ? null : [r, g, b, m[4] === undefined ? 1 : Number(m[4])]
}
export const MAX_GRADIENT_STOPS = 16

/** Why this gradient cannot be drawn by Rhema's outputs, or null when it can. */
export function gradientIssue(raw: unknown): string | null {
  const g = raw as Partial<SceneGradient> | null
  if (!g || typeof g !== "object") return "A gradient needs an angle and colour stops"
  if (typeof g.angle !== "number" || !Number.isFinite(g.angle)) return "A gradient needs a finite angle"
  if (!Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > MAX_GRADIENT_STOPS) return `A gradient needs between 2 and ${MAX_GRADIENT_STOPS} colour stops`
  for (const stop of g.stops) {
    if (!stop || typeof stop.color !== "string" || !rgba(stop.color)) return "Gradient colours must be hex (#rrggbb, #rrggbbaa) or rgb()/rgba() with whole-number channels"
    if (typeof stop.offset !== "number" || !Number.isFinite(stop.offset) || stop.offset < 0 || stop.offset > 1) return "Gradient stops must sit between 0 and 100%"
  }
  return null
}

/** A copy of a gradient Rhema can draw (angle kept within 0–360), or undefined. */
export function normalizeGradient(raw: unknown): SceneGradient | undefined {
  if (gradientIssue(raw)) return undefined
  const g = raw as SceneGradient
  return { angle: ((g.angle % 360) + 360) % 360, stops: g.stops.map((s) => ({ color: s.color.trim(), offset: s.offset })) }
}

/** The same gradient as CSS, for the editor's own paint value and for older readers. */
export function gradientCss(g: SceneGradient): string {
  return `linear-gradient(${g.angle}deg, ${g.stops.map((s) => `${s.color} ${Math.round(s.offset * 1000) / 10}%`).join(", ")})`
}


/**
 * The solid colour kept beside a gradient for readers that draw none (older builds, desks, the
 * approval review): its first stop as #rrggbb, or "transparent" for a background that starts clear.
 */
export function gradientFallback(g: SceneGradient, background = false): string {
  const [r, gr, b, a] = rgba(g.stops[0]!.color) ?? [0, 0, 0, 1]
  if (background && a === 0) return "transparent"
  return `#${[r, gr, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A saved scene's gradients after an edit (`prev` → `next`): a gradient left as it was while its
 * solid colour changed (a colour picker, Transparent, a desk) gives way to that colour. A new or
 * changed gradient, or one whose colour is untouched, stays.
 */
export function dropReplacedGradients(next: Scene, prev: Scene | undefined): Scene {
  if (!prev) return next
  const was = new Map(prev.layers.map((l) => [l.id, l]))
  const keepBg = !next.backgroundGradient || next.background === prev.background || !same(next.backgroundGradient, prev.backgroundGradient)
  const layers = next.layers.map((l) => {
    const old = was.get(l.id)
    if (!l.gradient || !old || l.color === old.color || !same(l.gradient, old.gradient)) return l
    const solid = { ...l }
    delete solid.gradient
    return solid
  })
  const { backgroundGradient, ...rest } = next
  return { ...rest, ...(keepBg && backgroundGradient ? { backgroundGradient } : {}), layers }
}

/**
 * A scene a desk sent back (desks neither see nor send gradients): the host's gradients again
 * wherever the desk left the solid colour as the host had it.
 */
export function keepHostGradients(next: Scene, host: Scene | undefined): Scene {
  if (!host) return next
  const had = new Map(host.layers.map((l) => [l.id, l]))
  return {
    ...next,
    ...(host.backgroundGradient && next.background === host.background ? { backgroundGradient: host.backgroundGradient } : {}),
    layers: next.layers.map((l) => {
      const old = had.get(l.id)
      return old?.gradient && old.kind === l.kind && old.color === l.color ? { ...l, gradient: old.gradient } : l
    }),
  }
}
