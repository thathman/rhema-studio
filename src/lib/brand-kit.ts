import type { BroadcastTheme, LowerThirdStyle, ThemeLogo } from "@/types"
import { CLASSIC_DARK } from "@/lib/builtin-themes"

/** Fonts bundled with the app (see package.json @fontsource), so they are always available offline. */
export const BRAND_FONTS = ["Geist Variable", "Inter Variable", "Source Serif 4 Variable", "Geist Mono"] as const

export interface BrandKit {
  version: 1
  churchName: string
  logoUrl: string | null
  colors: { primary: string; accent: string; text: string; background: string }
  fonts: { heading: string; body: string }
  logo: { corner: ThemeLogo["corner"]; size: number }
  /** Ministry looks (Youth, Children's, Evening): the same kit with other colours, each getting its own Announcements theme. */
  variants?: BrandVariant[]
}

export interface BrandVariant {
  id: string
  name: string
  colors: Partial<BrandKit["colors"]>
}

export const defaultBrandKit = (): BrandKit => ({
  version: 1,
  churchName: "",
  logoUrl: null,
  colors: { primary: "#1a1a3e", accent: "#d4a574", text: "#ffffff", background: "#0a0a1a" },
  fonts: { heading: "Geist Variable", body: "Source Serif 4 Variable" },
  logo: { corner: "top-right", size: 8 },
})

export const MANAGED_THEME_IDS = { scripture: "brand-scripture", lyrics: "brand-lyrics", announcements: "brand-announcements" } as const

function hex(color: string): [number, number, number] | null {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function luminance(color: string): number {
  const rgb = hex(color)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** `wanted` if it reads on `background` (≥ 4.5:1), else `fallback`. */
export function readable(wanted: string, background: string, fallback: string): string {
  return contrastRatio(wanted, background) >= 4.5 ? wanted : fallback
}

/**
 * The Brand Kit holds the church's own colours or fonts, not the ones Rhema starts with. (A kit
 * applied with the starting colours counts too: the caller checks for brand-managed themes.)
 */
export function hasChurchColours(kit: BrandKit): boolean {
  const d = defaultBrandKit()
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  return (["primary", "accent", "text", "background"] as const).some((k) => !same(kit.colors[k], d.colors[k])) ||
    kit.fonts.heading !== d.fonts.heading || kit.fonts.body !== d.fonts.body
}

/** What a keyed look's words sit on when it has no band of its own: the camera picture, taken as dark. */
export const CAMERA_GROUND = "#1f1f1f"

/** The colours a theme's words sit on: its text box when solid enough, else its background (each gradient stop). */
export function themeGrounds(theme: Pick<BroadcastTheme, "background" | "textBox">): string[] {
  if (theme.textBox.enabled && theme.textBox.opacity >= 0.6) return [theme.textBox.color]
  const bg = theme.background
  if (bg.type === "transparent") return [CAMERA_GROUND]
  if (bg.type === "gradient" && bg.gradient?.stops.length) return bg.gradient.stops.map((s) => s.color)
  return [bg.color]
}

/** `color` reads (≥ 4.5:1) on every one of `grounds`. */
export function readsOn(color: string, grounds: readonly string[]): boolean {
  return hex(color) !== null && grounds.every((g) => contrastRatio(color, g) >= 4.5)
}

/** A copy in the church's colours, and which of the look's own colours were kept because the church's would not read. */
export interface BrandedCopy<T> {
  value: T
  keptText: boolean
  keptAccent: boolean
}

/**
 * A theme in the church's colours and fonts (#299): the words in the kit's text colour and body
 * font, the reference, second language and verse numbers in its accent and the reference in its
 * heading font. The look's background and layout stay. A colour that would not read on the look's
 * background is not used: the look keeps its own (keptText / keptAccent). Pure: give it a copy.
 */
export function brandTheme(theme: BroadcastTheme, kit: BrandKit): BrandedCopy<BroadcastTheme> {
  const grounds = themeGrounds(theme)
  const keptText = !readsOn(kit.colors.text, grounds)
  const keptAccent = !readsOn(kit.colors.accent, grounds)
  const accent = (own: string) => (keptAccent ? own : kit.colors.accent)
  const second = theme.secondaryVerseText
  return {
    value: {
      ...theme,
      verseText: { ...theme.verseText, fontFamily: kit.fonts.body, color: keptText ? theme.verseText.color : kit.colors.text },
      ...(second ? { secondaryVerseText: { ...second, fontFamily: kit.fonts.body, color: accent(second.color) } } : {}),
      reference: { ...theme.reference, fontFamily: kit.fonts.heading, color: accent(theme.reference.color) },
      verseNumbers: { ...theme.verseNumbers, color: accent(theme.verseNumbers.color) },
    },
    keptText,
    keptAccent,
  }
}

/** A name band in the church's colours and heading font; the accent bar always takes the accent (it carries no words). */
export function brandLowerThirdStyle(style: LowerThirdStyle, kit: BrandKit): BrandedCopy<LowerThirdStyle> {
  const grounds = style.background.kind === "color" && style.background.opacity >= 0.6 ? [style.background.color] : [CAMERA_GROUND]
  const keptText = !readsOn(kit.colors.text, grounds)
  const keptAccent = !readsOn(kit.colors.accent, grounds)
  return {
    value: {
      ...style,
      fontFamily: kit.fonts.heading,
      line1: { ...style.line1, color: keptText ? style.line1.color : kit.colors.text },
      line2: { ...style.line2, color: keptAccent ? style.line2.color : kit.colors.accent },
      accent: { ...style.accent, color: hex(kit.colors.accent) ? kit.colors.accent : style.accent.color },
    },
    keptText,
    keptAccent,
  }
}

/**
 * The three themes the kit manages, generated from Classic Dark. Pure:
 * existing managed themes keep their ids; themes the church edited by hand
 * (not `brandManaged`) are never touched; everything else in `themes` is
 * returned as is.
 */
export function applyBrandKit(kit: BrandKit, themes: BroadcastTheme[], inUse: ReadonlySet<string> = new Set()): BroadcastTheme[] {
  const now = Date.now()
  const bg = kit.colors.background
  const body = readable(kit.colors.text, bg, luminance(bg) > 0.5 ? "#111111" : "#ffffff")
  const accent = readable(kit.colors.accent, bg, body)
  const base = (id: string, name: string, extra: Partial<BroadcastTheme>): BroadcastTheme => {
    const existing = themes.find((t) => t.id === id)
    return {
      ...CLASSIC_DARK,
      ...existing,
      id,
      name,
      builtin: false,
      pinned: existing?.pinned ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      brandManaged: true,
      background: { ...CLASSIC_DARK.background, type: "gradient", color: bg, gradient: { type: "linear", angle: 180, stops: [{ color: kit.colors.primary, position: 0 }, { color: bg, position: 100 }] }, image: null },
      verseText: { ...CLASSIC_DARK.verseText, fontFamily: kit.fonts.body, color: body },
      secondaryVerseText: { ...(CLASSIC_DARK.secondaryVerseText ?? CLASSIC_DARK.verseText), fontFamily: kit.fonts.body, color: accent },
      reference: { ...CLASSIC_DARK.reference, fontFamily: kit.fonts.heading, color: accent },
      logo: kit.logoUrl ? { url: kit.logoUrl, corner: kit.logo.corner, size: kit.logo.size, opacity: 1, showOnTransparent: false } : null,
      ...extra,
    }
  }
  const generated: BroadcastTheme[] = [
    base(MANAGED_THEME_IDS.scripture, `${kit.churchName || "Church"} · Scripture`, {}),
    base(MANAGED_THEME_IDS.lyrics, `${kit.churchName || "Church"} · Lyrics`, { verseNumbers: { ...CLASSIC_DARK.verseNumbers, visible: false } }),
    base(MANAGED_THEME_IDS.announcements, `${kit.churchName || "Church"} · Announcements`, {
      reference: { ...CLASSIC_DARK.reference, fontFamily: kit.fonts.heading, color: accent, fontSize: CLASSIC_DARK.reference.fontSize * 1.6, uppercase: false },
      verseNumbers: { ...CLASSIC_DARK.verseNumbers, visible: false },
    }),
  ]
  for (const v of kit.variants ?? []) {
    const vk: BrandKit = { ...kit, colors: { ...kit.colors, ...v.colors } }
    const vbg = vk.colors.background
    const vbody = readable(vk.colors.text, vbg, luminance(vbg) > 0.5 ? "#111111" : "#ffffff")
    const vaccent = readable(vk.colors.accent, vbg, vbody)
    generated.push({
      ...base(`brand-variant-${v.id}`, `${kit.churchName || "Church"} · ${v.name} · Announcements`, {
        reference: { ...CLASSIC_DARK.reference, fontFamily: kit.fonts.heading, color: vaccent, fontSize: CLASSIC_DARK.reference.fontSize * 1.6, uppercase: false },
        verseNumbers: { ...CLASSIC_DARK.verseNumbers, visible: false },
      }),
      background: { ...CLASSIC_DARK.background, type: "gradient", color: vbg, gradient: { type: "linear", angle: 180, stops: [{ color: vk.colors.primary, position: 0 }, { color: vbg, position: 100 }] }, image: null },
      verseText: { ...CLASSIC_DARK.verseText, fontFamily: kit.fonts.body, color: vbody },
      secondaryVerseText: { ...(CLASSIC_DARK.secondaryVerseText ?? CLASSIC_DARK.verseText), fontFamily: kit.fonts.body, color: vaccent },
    })
  }
  const managedIds = new Set<string>([...Object.values(MANAGED_THEME_IDS), ...generated.map((g) => g.id)])
  // Variant themes whose variant was removed go away (unless detached by a hand edit).
  // One an output still uses is kept, detached, so that output does not fall back to Classic Dark.
  const orphans = themes.filter((t) => t.id.startsWith("brand-variant-") && t.brandManaged !== false && !generated.some((g) => g.id === t.id))
  const stale = orphans.filter((t) => !inUse.has(t.id)).map((t) => t.id)
  const detach = new Set(orphans.filter((t) => inUse.has(t.id)).map((t) => t.id))
  // A managed theme the church turned into a hand-edited one is left alone.
  const keep = themes
    .filter((t) => (!managedIds.has(t.id) || t.brandManaged === false) && !stale.includes(t.id))
    .map((t) => (detach.has(t.id) ? { ...t, brandManaged: false } : t))
  const replaced = generated.filter((g) => !themes.some((t) => t.id === g.id && t.brandManaged === false))
  return [...keep, ...replaced]
}

/** Font families the themes ask for that the system cannot provide (checked with the Font Loading API when present). */
export function missingThemeFonts(themes: Pick<BroadcastTheme, "name" | "verseText" | "reference" | "logo">[], isAvailable: (family: string) => boolean): Array<{ theme: string; font: string }> {
  const out: Array<{ theme: string; font: string }> = []
  for (const t of themes) {
    for (const font of new Set([t.verseText.fontFamily, t.reference.fontFamily])) {
      if (font && !isAvailable(font)) out.push({ theme: t.name, font })
    }
  }
  return out
}

const fontSeen = new Map<string, boolean>()
let measureCtx: CanvasRenderingContext2D | null | undefined

/**
 * Bundled fonts are always there; a font loaded into the page (a theme's own
 * font file) is there; anything else is measured: text drawn in it must
 * differ from the fallback fonts. (`document.fonts.check` answers true for a
 * font that does not exist at all, so it cannot tell.)
 */
export function fontAvailable(family: string): boolean {
  if ((BRAND_FONTS as readonly string[]).includes(family)) return true
  if (typeof document === "undefined") return true
  const known = fontSeen.get(family)
  if (known !== undefined) return known
  try {
    if ("fonts" in document && Array.from(document.fonts).some((f) => f.family.replace(/^["']|["']$/g, "") === family)) return true // a theme's own font file (loaded or loading)
    if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d")
    const ctx = measureCtx
    if (!ctx) return true // cannot measure here: do not warn
    const sample = "mmmmmmmmmmlli1WQ@#"
    const width = (font: string) => {
      ctx.font = font
      return ctx.measureText(sample).width
    }
    const found = ["monospace", "serif", "sans-serif"].some((base) => width(`72px "${family}", ${base}`) !== width(`72px ${base}`))
    if (found) fontSeen.set(family, true) // a missing one is measured again (it may be installed meanwhile)
    return found
  } catch {
    return true
  }
}
