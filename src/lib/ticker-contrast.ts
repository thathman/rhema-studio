import { contrastRatio, type BrandKit } from "@/lib/brand-kit"
import type { TickerStyle } from "@/types"

/** WCAG AA for normal text: what the ticker's words must reach on their band (#187). */
export const TICKER_AA = 4.5

export interface ContrastLine {
  /** The worst ratio over every ground the words may sit on, to one decimal. */
  ratio: number
  ok: boolean
  /** A Brand Kit colour (or white or black) that would pass, when this one does not. */
  suggest?: string
}

export interface TickerContrast {
  words: ContrastLine
  /** The tag ("NEWS") on its own colour; absent when the band has no tag. */
  tag?: ContrastLine
  /** A picture or video lies under the band: it was checked over black and white, the darkest and lightest it could be. */
  overMedia: boolean
}

function rgb(color: string): [number, number, number] | null {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** `top` at `opacity` over `under`, as one hex colour. */
export function blend(top: string, under: string, opacity: number): string {
  const a = rgb(top) ?? [0, 0, 0]
  const b = rgb(under) ?? [0, 0, 0]
  const o = Math.min(1, Math.max(0, opacity))
  return `#${a.map((v, i) => Math.round(v * o + b[i] * (1 - o)).toString(16).padStart(2, "0")).join("")}`
}

const worst = (color: string, grounds: readonly string[]) => Math.min(...grounds.map((g) => contrastRatio(color, g)))

function line(color: string, grounds: readonly string[], kit: BrandKit | null): ContrastLine {
  const ratio = Math.floor(worst(color, grounds) * 10) / 10
  if (ratio >= TICKER_AA) return { ratio, ok: true }
  const choices = [...(kit ? [kit.colors.text, kit.colors.background, kit.colors.accent, kit.colors.primary] : []), "#ffffff", "#000000"]
  const suggest = choices.find((c) => rgb(c) && worst(c, grounds) >= TICKER_AA)
  return { ratio, ok: false, ...(suggest ? { suggest } : {}) }
}

/**
 * How well the ticker's words read on their band (#187 readability check): the band colour at its
 * opacity over what is under it (the look's own background, `under`; for a picture or video, the
 * darkest and the lightest it could be), and the tag's words on the tag colour.
 */
export function tickerContrast(style: Pick<TickerStyle, "color" | "background" | "label" | "labelColor" | "labelBackground">, under: readonly string[], kit: BrandKit | null = null): TickerContrast {
  const overMedia = style.background.kind !== "color" && !!style.background.mediaId
  const below = overMedia ? ["#000000", "#ffffff"] : under.length ? under : ["#000000"]
  const grounds = below.map((g) => blend(style.background.color, g, style.background.opacity))
  return {
    words: line(style.color, grounds, kit),
    ...(style.label.trim() ? { tag: line(style.labelColor, [style.labelBackground], kit) } : {}),
    overMedia,
  }
}
