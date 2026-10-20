import type { BroadcastTheme, ThemeLogo } from "@/types"
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
 * The three themes the kit manages, generated from Classic Dark. Pure:
 * existing managed themes keep their ids; themes the church edited by hand
 * (not `brandManaged`) are never touched; everything else in `themes` is
 * returned as is.
 */
export function applyBrandKit(kit: BrandKit, themes: BroadcastTheme[]): BroadcastTheme[] {
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
  const stale = themes.filter((t) => t.id.startsWith("brand-variant-") && t.brandManaged !== false && !generated.some((g) => g.id === t.id)).map((t) => t.id)
  // A managed theme the church turned into a hand-edited one is left alone.
  const keep = themes.filter((t) => (!managedIds.has(t.id) || t.brandManaged === false) && !stale.includes(t.id))
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

/** Bundled fonts are always there; anything else is asked of the browser. */
export function fontAvailable(family: string): boolean {
  if ((BRAND_FONTS as readonly string[]).includes(family)) return true
  if (typeof document === "undefined" || !("fonts" in document)) return true
  try {
    return document.fonts.check(`16px "${family}"`)
  } catch {
    return true
  }
}
