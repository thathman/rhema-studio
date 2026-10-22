import type { BroadcastTheme } from "@/types"

/**
 * The theme's look in a volunteer's terms (approved design, "Edit the look"): a font family,
 * a text size, alignment, a safe margin, an output shape, the main colours. Read from a theme
 * and applied back to it; the detailed Text, Background and Layout tabs stay for the rest.
 */
export const LOOK_FONTS = [
  { id: "serif", label: "Literary serif", family: "Source Serif 4 Variable" },
  { id: "sans", label: "Contemporary sans", family: "IBM Plex Sans" },
  { id: "inter", label: "Clean sans", family: "Inter Variable" },
  { id: "rounded", label: "Gentle rounded", family: "Geist Variable" },
] as const

/** Text size as a share of the screen's height. */
export const LOOK_SIZES = [
  { id: "compact", label: "Compact", share: 0.052 },
  { id: "comfortable", label: "Comfortable", share: 0.065 },
  { id: "large", label: "Large", share: 0.08 },
] as const

/** One-click palettes (approved design, "Visual direction"): background, words and accent together. */
export const LOOK_DIRECTIONS = [
  { name: "Midnight & gold", background: "#152835", words: "#f7f4ec", accent: "#d9b25f" },
  { name: "Forest & linen", background: "#234b46", words: "#f3efe4", accent: "#e6d6b0" },
  { name: "Warm editorial", background: "#f3f2e9", words: "#29313f", accent: "#76643f" },
  { name: "Modern cobalt", background: "#122952", words: "#f2f5fb", accent: "#9dbcff" },
] as const

export const LOOK_RATIOS = [
  { id: "16:9", label: "16:9 widescreen", width: 1920, height: 1080 },
  { id: "4:3", label: "4:3 older projector", width: 1440, height: 1080 },
  { id: "9:16", label: "9:16 vertical stream", width: 1080, height: 1920 },
] as const

export type LookFont = (typeof LOOK_FONTS)[number]["id"] | "custom"
export type LookSize = (typeof LOOK_SIZES)[number]["id"]
export type LookRatio = (typeof LOOK_RATIOS)[number]["id"] | "custom"

export interface Look {
  font: LookFont
  size: LookSize
  align: "left" | "center" | "right"
  /** Safe margin around the text, % of the screen's width (3 to 18). */
  margin: number
  ratio: LookRatio
  /** Space between the two languages of a bilingual slide, theme px. */
  languageGap: number
  background: string | null
  words: string
  accent: string
}

export function lookOf(t: BroadcastTheme): Look {
  const font = LOOK_FONTS.find((f) => f.family === t.verseText.fontFamily)?.id ?? "custom"
  const share = t.verseText.fontSize / t.resolution.height
  const size = LOOK_SIZES.reduce((best, s) => (Math.abs(s.share - share) < Math.abs(best.share - share) ? s : best)).id
  const ratio = LOOK_RATIOS.find((r) => r.width === t.resolution.width && r.height === t.resolution.height)?.id ?? "custom"
  return {
    font,
    size,
    align: t.layout.textAlign,
    margin: Math.round((t.layout.padding.left / t.resolution.width) * 100),
    ratio,
    languageGap: t.layout.languageGap ?? Math.round(t.verseText.fontSize * t.verseText.lineHeight),
    background: t.background.type === "solid" ? t.background.color : null,
    words: t.verseText.color,
    accent: t.reference.color,
  }
}

export type LookChange =
  | { font: Exclude<LookFont, "custom"> }
  | { size: LookSize }
  | { align: Look["align"] }
  | { margin: number }
  | { ratio: Exclude<LookRatio, "custom"> }
  | { languageGap: number }
  | { background: string }
  | { words: string }
  | { accent: string }

/** The theme with one part of its look changed; everything else as it was. */
export function applyLook(t: BroadcastTheme, change: LookChange): BroadcastTheme {
  const both = (patch: Partial<BroadcastTheme["verseText"]>): Pick<BroadcastTheme, "verseText" | "secondaryVerseText"> => ({
    verseText: { ...t.verseText, ...patch },
    ...(t.secondaryVerseText ? { secondaryVerseText: { ...t.secondaryVerseText, ...patch } } : {}),
  })
  if ("font" in change) {
    const family = LOOK_FONTS.find((f) => f.id === change.font)!.family
    return { ...t, ...both({ fontFamily: family }), reference: { ...t.reference, fontFamily: family } }
  }
  if ("size" in change) {
    const share = LOOK_SIZES.find((s) => s.id === change.size)!.share
    const fontSize = Math.round(t.resolution.height * share)
    const ratio = fontSize / t.verseText.fontSize
    return {
      ...t,
      verseText: { ...t.verseText, fontSize },
      ...(t.secondaryVerseText ? { secondaryVerseText: { ...t.secondaryVerseText, fontSize: Math.round(t.secondaryVerseText.fontSize * ratio) } } : {}),
      reference: { ...t.reference, fontSize: Math.round(t.reference.fontSize * ratio) },
    }
  }
  if ("align" in change) {
    return { ...t, layout: { ...t.layout, textAlign: change.align }, ...both({ horizontalAlign: change.align }), reference: { ...t.reference, horizontalAlign: change.align } }
  }
  if ("margin" in change) {
    const pct = Math.min(18, Math.max(3, change.margin))
    const x = Math.round((t.resolution.width * pct) / 100)
    const y = Math.round((t.resolution.height * pct) / 100)
    return { ...t, layout: { ...t.layout, padding: { top: y, right: x, bottom: y, left: x } } }
  }
  if ("ratio" in change) {
    const r = LOOK_RATIOS.find((x) => x.id === change.ratio)!
    return { ...t, resolution: { width: r.width, height: r.height } }
  }
  if ("languageGap" in change) return { ...t, layout: { ...t.layout, languageGap: Math.min(240, Math.max(0, Math.round(change.languageGap))) } }
  if ("background" in change) return { ...t, background: { ...t.background, type: "solid", color: change.background } }
  if ("words" in change) return { ...t, ...both({ color: change.words }) }
  return { ...t, reference: { ...t.reference, color: change.accent } }
}

/** A visual direction: its background, words and accent, each through applyLook. */
export function applyDirection(t: BroadcastTheme, d: Pick<Look, "words" | "accent"> & { background: string }): BroadcastTheme {
  return applyLook(applyLook(applyLook(t, { background: d.background }), { words: d.words }), { accent: d.accent })
}
