import type { LowerThird, LowerThirdStyle } from "@/types/broadcast-output"
import type { VerseRenderData } from "@/types/broadcast"

/** The band as it always looked: dark, rounded, bottom left, sized to the words. */
export const DEFAULT_LOWER_THIRD_STYLE: LowerThirdStyle = {
  id: "default",
  name: "Classic band",
  align: "left",
  margin: 6,
  bottom: 8,
  width: 0,
  height: 15,
  fontFamily: null,
  line1: { size: 36, color: "#ffffff", weight: 700, uppercase: false },
  line2: { size: 24, color: "#ffffffd9", weight: 400 },
  background: { kind: "color", color: "#000000", opacity: 0.78, mediaId: null },
  radius: 12,
  accent: { enabled: false, color: "#d4a656", width: 8 },
  animation: "fade",
}

/** How long a lower third takes to come on screen. */
export const LOWER_THIRD_ENTRANCE_MS = 450

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const str = (v: unknown, d: string) => (typeof v === "string" && v ? v : d)

/** A saved style with every field present and within bounds (older or hand-edited files). */
export function normalizeLowerThirdStyle(raw: Partial<LowerThirdStyle> & { id?: string }): LowerThirdStyle {
  const d = DEFAULT_LOWER_THIRD_STYLE
  const l1 = (raw.line1 ?? {}) as Partial<LowerThirdStyle["line1"]>
  const l2 = (raw.line2 ?? {}) as Partial<LowerThirdStyle["line2"]>
  const bg = (raw.background ?? {}) as Partial<LowerThirdStyle["background"]>
  const ac = (raw.accent ?? {}) as Partial<LowerThirdStyle["accent"]>
  return {
    id: str(raw.id, crypto.randomUUID()),
    name: str(raw.name, "Lower third"),
    align: raw.align === "center" || raw.align === "right" ? raw.align : "left",
    margin: num(raw.margin, d.margin, 0, 40),
    bottom: num(raw.bottom, d.bottom, 0, 90),
    width: num(raw.width, d.width, 0, 100),
    height: num(raw.height, d.height, 4, 50),
    fontFamily: typeof raw.fontFamily === "string" && raw.fontFamily.trim() ? raw.fontFamily.trim() : null,
    line1: { size: num(l1.size, d.line1.size, 5, 90), color: str(l1.color, d.line1.color), weight: num(l1.weight, d.line1.weight, 100, 900), uppercase: l1.uppercase === true },
    line2: { size: num(l2.size, d.line2.size, 5, 90), color: str(l2.color, d.line2.color), weight: num(l2.weight, d.line2.weight, 100, 900) },
    background: {
      kind: bg.kind === "picture" || bg.kind === "video" || bg.kind === "none" ? bg.kind : "color",
      color: str(bg.color, d.background.color),
      opacity: num(bg.opacity, d.background.opacity, 0, 1),
      mediaId: typeof bg.mediaId === "string" ? bg.mediaId : null,
    },
    radius: num(raw.radius, d.radius, 0, 50),
    accent: { enabled: ac.enabled === true, color: str(ac.color, d.accent.color), width: num(ac.width, d.accent.width, 1, 60) },
    animation: raw.animation === "none" || raw.animation === "slide" ? raw.animation : "fade",
  }
}

export interface LowerThirdLayout {
  band: { x: number; y: number; w: number; h: number }
  /** The accent bar, when the style has one (on the side the band leans to; on top when centred). */
  accent: { x: number; y: number; w: number; h: number } | null
  line1: { x: number; y: number; size: number; maxW: number; align: CanvasTextAlign }
  line2: { x: number; y: number; size: number; maxW: number; align: CanvasTextAlign } | null
}

/**
 * Where everything goes in a `width`×`height` frame. `measure(text, size,
 * weight)` gives a line's width at a font size (only needed for a band sized
 * to its words). Pure, so it is tested without a canvas.
 */
export function layoutLowerThird(width: number, height: number, lt: Pick<LowerThird, "line1" | "line2">, style: LowerThirdStyle, measure: (text: string, size: number, weight: number) => number): LowerThirdLayout {
  const two = !!lt.line2 && !!lt.line1
  // One line: a shorter band, the same words size.
  const h = Math.round((height * style.height) / 100) * (two ? 1 : 0.68)
  const size1 = Math.round(h * (style.line1.size / 100) * (two ? 1 : 1.35))
  const size2 = Math.round(h * (style.line2.size / 100))
  const padX = Math.round(h * 0.35)
  const accentW = style.accent.enabled ? Math.max(1, Math.round((style.accent.width * height) / 1080)) : 0
  const marginX = Math.round((width * style.margin) / 100)
  const t1 = style.line1.uppercase ? lt.line1.toUpperCase() : lt.line1
  const words = Math.max(measure(t1, size1, style.line1.weight), two ? measure(lt.line2, size2, style.line2.weight) : 0)
  const maxBand = width - marginX * 2
  const w = Math.min(maxBand, style.width > 0 ? Math.round((width * style.width) / 100) : Math.ceil(words + padX * 2 + (style.align === "center" ? 0 : accentW)))
  const x = style.align === "left" ? marginX : style.align === "right" ? width - marginX - w : Math.round((width - w) / 2)
  const y = Math.round(height - (height * style.bottom) / 100 - h)
  const accent = accentW
    ? style.align === "center"
      ? { x, y, w, h: accentW }
      : { x: style.align === "left" ? x : x + w - accentW, y, w: accentW, h }
    : null
  const inset = style.align === "left" ? accentW : 0
  const align: CanvasTextAlign = style.align === "center" ? "center" : style.align === "right" ? "right" : "left"
  const tx = align === "center" ? x + w / 2 : align === "right" ? x + w - padX - (style.align === "right" ? accentW : 0) : x + padX + inset
  const maxW = w - padX * 2 - accentW
  if (!two) return { band: { x, y, w, h }, accent, line1: { x: tx, y: y + h / 2, size: size1, maxW, align }, line2: null }
  return {
    band: { x, y, w, h },
    accent,
    line1: { x: tx, y: y + h * 0.36, size: size1, maxW, align },
    line2: { x: tx, y: y + h * 0.72, size: size2, maxW, align },
  }
}

/**
 * The band as an output draws it now: a strip that follows what is live takes
 * its words from the screen (none when nothing fits: a picture, a blank screen).
 */
export function overlayFor(lt: LowerThird | null, verse: VerseRenderData | null): LowerThird | null {
  if (!lt?.follow) return lt
  if (!verse || verse.quick || verse.screen) return null
  if (lt.follow === "scripture") {
    if (verse.kind && verse.kind !== "verse") return null
    const text = verse.segments.map((x) => x.text).join(" ").trim()
    return text ? { ...lt, line1: text, line2: verse.reference } : null
  }
  if (verse.kind !== "lyric" || !verse.lines?.length) return null
  // The song's name, not "Verse 1" (the reference is "Title · Verse 1").
  return { ...lt, line1: verse.lines.join("\n"), line2: verse.reference.split(" · ")[0] ?? "" }
}

/** How far its entrance has gone (0…1) at `now`. */
export function entranceProgress(lt: Pick<LowerThird, "shownAt" | "style">, now: number): number {
  if (!lt.shownAt || (lt.style?.animation ?? "fade") === "none") return 1
  return Math.min(1, Math.max(0, (now - lt.shownAt) / LOWER_THIRD_ENTRANCE_MS))
}
