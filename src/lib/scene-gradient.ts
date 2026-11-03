import type { SceneGradient } from "../types/scene"

/**
 * Gradient paint in Rhema scenes (#448): the Avnac editor's linear gradients, kept typed (never
 * baked into a picture) from the design to every output. One rule for what can be drawn, used by
 * the design adapter (which refuses the rest with this reason) and by stored scenes and frames.
 */
const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*\d{1,3}(\.\d+)?%?\s*,\s*\d{1,3}(\.\d+)?%?\s*,\s*\d{1,3}(\.\d+)?%?\s*(,\s*(0|1|0?\.\d+|1\.0+)\s*)?\))$/i
export const MAX_GRADIENT_STOPS = 16

/** Why this gradient cannot be drawn by Rhema's outputs, or null when it can. */
export function gradientIssue(raw: unknown): string | null {
  const g = raw as Partial<SceneGradient> | null
  if (!g || typeof g !== "object") return "A gradient needs an angle and colour stops"
  if (typeof g.angle !== "number" || !Number.isFinite(g.angle)) return "A gradient needs a finite angle"
  if (!Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > MAX_GRADIENT_STOPS) return `A gradient needs between 2 and ${MAX_GRADIENT_STOPS} colour stops`
  for (const stop of g.stops) {
    if (!stop || typeof stop.color !== "string" || !COLOR.test(stop.color.trim())) return "Gradient colours must be hex (#rrggbb, #rrggbbaa) or rgb()/rgba()"
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

