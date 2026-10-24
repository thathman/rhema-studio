import { create } from "zustand"
import { load } from "@tauri-apps/plugin-store"
import { LIBRARY_LOOKS } from "@/lib/look-library-data"
import type { LibraryLook, LookFamilyId } from "@/lib/look-library"
import type { SceneTemplateLayer } from "@/lib/look-library"
import type { BroadcastTheme } from "@/types/broadcast"
import type { LowerThirdStyle, TickerStyle } from "@/types/broadcast-output"

export const DESIGN_PACK_FORMAT = "rhema.design-pack"
export const DESIGN_PACK_VERSION = 1
const MAX_BYTES = 2_000_000
const MAX_ITEMS = 160
const SLUG = /^[a-z0-9][a-z0-9-]{2,63}$/
const COLOUR = /^#[0-9a-fA-F]{3,8}$/
const KINDS = new Set(["feed", "camera", "color", "picture", "video", "clock", "ticker", "lowerThird", "logo"])
const FEEDS = new Set(["bible", "song", "hymn", "slide", "picture"])

type Variant = {
  background?: string
  gradient?: string[]
  radial?: boolean
  foreground?: string
  secondary?: string
  accent?: string
  plate?: string
  plateOpacity?: number
  fontSize?: number
  referenceSize?: number
  fontFamily?: string
  align?: "left" | "center" | "right"
  bottom?: number
  height?: number
  motion?: "crawl" | "pages"
  speed?: number
  label?: string
}
type LayerRecipe = {
  kind: SceneTemplateLayer["kind"]
  name: string
  box: { x: number; y: number; w: number; h: number }
  shows?: Array<"bible" | "song" | "hymn" | "slide" | "picture">
  lookId?: string
}
type Entry = { id: string; name: string; purpose?: string; from?: string; variant?: Variant; scene?: { background: string; layers: LayerRecipe[] } }
export interface ImportedPack { id: string; name: string; author: string; license: string; looks: LibraryLook[] }
interface PackState {
  packs: ImportedPack[]
  ready: boolean
  importPack: (pack: ImportedPack) => Promise<void>
  removePack: (id: string) => Promise<void>
}
const finite = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback
const nameOf = (v: unknown, field: string, max = 110) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[<>]/.test(v)) throw new Error("Invalid " + field)
  return v.trim()
}
const colour = (value: unknown, fallback: string) => typeof value === "string" && COLOUR.test(value) ? value : fallback
const validVariant = (value: unknown): Variant => {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid design variant")
  const v = value as Variant
  if (v.gradient !== undefined && (!Array.isArray(v.gradient) || v.gradient.length < 2 || v.gradient.length > 5 || !v.gradient.every((c) => typeof c === "string" && COLOUR.test(c)))) throw new Error("Invalid gradient colours")
  for (const key of ["background", "foreground", "secondary", "accent", "plate"] as const) {
    if (v[key] !== undefined && !COLOUR.test(v[key] as string)) throw new Error("Invalid " + key + " colour")
  }
  return v
}
const paintTheme = (base: BroadcastTheme, variant: Variant): BroadcastTheme => {
  const t = structuredClone(base)
  if (variant.gradient) t.background = { type: "gradient", color: variant.gradient[0], gradient: { type: variant.radial ? "radial" : "linear", angle: 110, stops: variant.gradient.map((color, index) => ({ color, position: Math.round(100 * index / (variant.gradient!.length - 1)) })) }, image: null }
  else if (variant.background) t.background = { type: "solid", color: variant.background, gradient: null, image: null }
  if (variant.foreground) t.verseText.color = variant.foreground
  if (variant.secondary && t.secondaryVerseText) t.secondaryVerseText.color = variant.secondary
  if (variant.accent) { t.reference.color = variant.accent; t.verseNumbers.color = variant.accent }
  if (variant.plate) t.textBox = { ...t.textBox, enabled: true, color: variant.plate, opacity: finite(variant.plateOpacity, 0, 1, 0.9), image: null }
  if (variant.fontSize !== undefined) t.verseText.fontSize = finite(variant.fontSize, 26, 130, t.verseText.fontSize)
  if (variant.referenceSize !== undefined) t.reference.fontSize = finite(variant.referenceSize, 16, 85, t.reference.fontSize)
  if (variant.fontFamily) {
    // Fonts bundled with Rhema, never an untrusted external font URL.
    const fonts = ["Geist Variable", "Inter Variable", "Source Serif 4 Variable", "Geist Mono", "IBM Plex Sans"]
    if (!fonts.includes(variant.fontFamily)) throw new Error("Unbundled font: " + variant.fontFamily)
    t.verseText.fontFamily = variant.fontFamily
  }
  if (variant.align) {
    if (!["left", "center", "right"].includes(variant.align)) throw new Error("Invalid alignment")
    t.layout.textAlign = variant.align
    t.verseText.horizontalAlign = variant.align
    t.reference.horizontalAlign = variant.align
  }
  return t
}
function renderEntry(entry: Entry, packId: string): LibraryLook {
  if (!SLUG.test(entry.id)) throw new Error("Invalid entry id")
  const id = packId + "/" + entry.id
  const name = nameOf(entry.name, "look name")
  const source = entry.from ? LIBRARY_LOOKS.find((l) => l.id === entry.from) : undefined
  if (entry.from && !source) throw new Error("Unknown base look: " + entry.from)
  if (!source && !entry.scene) throw new Error("Each look needs a known base or a scene")
  const variant = validVariant(entry.variant)
  const purpose = typeof entry.purpose === "string" ? nameOf(entry.purpose, "look description", 300) : (source?.purpose ?? "Ready for your own content")
  if (entry.scene) {
    if (!Array.isArray(entry.scene.layers) || entry.scene.layers.length < 1 || entry.scene.layers.length > 20) throw new Error("Scene needs 1–20 layers")
    const layers: SceneTemplateLayer[] = entry.scene.layers.map((l) => {
      if (!l || !KINDS.has(l.kind)) throw new Error("Unsupported scene source")
      const b = l.box
      if (!b || ![b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v)) || b.x < 0 || b.y < 0 || b.w <= 0 || b.h <= 0 || b.x + b.w > 100.01 || b.y + b.h > 100.01) throw new Error("Invalid scene geometry")
      if (l.shows && (!Array.isArray(l.shows) || !l.shows.every((k) => FEEDS.has(k)))) throw new Error("Unknown live source")
      if (l.lookId && !SLUG.test(l.lookId) && !l.lookId.startsWith("look-")) throw new Error("Invalid referenced design")
      return { kind: l.kind, name: nameOf(l.name, "layer name", 80), box: { ...b }, ...(l.shows ? { shows: [...l.shows] } : {}), ...(l.lookId ? { lookId: l.lookId.startsWith("look-") ? l.lookId : packId + "/" + l.lookId } : {}) }
    })
    const background = colour(entry.scene.background, "#101820")
    return { kind: "scene", id, name, purpose, family: (source?.family ?? "broadcast-clean") as LookFamilyId, layout: "scene", content: source?.content ?? "bible", background: "dark", aspect: "16:9", scene: { background, layers } }
  }
  if (!source) throw new Error("Missing base look")
  const meta = { ...source, id, name, purpose }
  switch (source.kind) {
    case "theme": {
      const theme = paintTheme(source.theme, variant)
      return { ...meta, kind: "theme", theme: { ...theme, id, name, builtin: true }, background: theme.background.type === "transparent" ? "transparent" : "dark" }
    }
    case "lower-third": {
      const s: LowerThirdStyle = structuredClone(source.style)
      if (variant.plate) s.background.color = variant.plate
      if (variant.foreground) s.line1.color = variant.foreground
      if (variant.secondary) s.line2.color = variant.secondary
      if (variant.accent) s.accent.color = variant.accent
      if (variant.bottom !== undefined) s.bottom = finite(variant.bottom, 0, 60, s.bottom)
      if (variant.height !== undefined) s.height = finite(variant.height, 4, 40, s.height)
      return { ...meta, kind: "lower-third", style: { ...s, id, name } }
    }
    case "ticker": {
      const s: TickerStyle = structuredClone(source.style)
      if (variant.plate) s.background.color = variant.plate
      if (variant.foreground) s.color = variant.foreground
      if (variant.accent) s.labelBackground = variant.accent
      if (variant.label !== undefined) s.label = nameOf(variant.label, "ticker label", 24)
      if (variant.motion) {
        if (variant.motion !== "crawl" && variant.motion !== "pages") throw new Error("Invalid ticker motion")
        s.motion = variant.motion
      }
      if (variant.speed !== undefined) s.speed = finite(variant.speed, 20, 600, s.speed)
      return { ...meta, kind: "ticker", style: s }
    }
    case "stage": return { ...meta, kind: "stage", style: structuredClone(source.style) }
    case "scene": return { ...meta, kind: "scene", scene: structuredClone(source.scene) }
  }
}
/** Parse untrusted portable recipe data without activating anything or allowing remote media URLs. */
export function parseRhemaDesignPack(text: string): ImportedPack {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("Design pack exceeds the 2 MB limit")
  const raw: unknown = JSON.parse(text)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("This is not a Rhema design pack")
  const p = raw as Record<string, unknown>
  if (p.format !== DESIGN_PACK_FORMAT || p.version !== DESIGN_PACK_VERSION) throw new Error("Unsupported Rhema design-pack format or version")
  if (typeof p.id !== "string" || !SLUG.test(p.id)) throw new Error("Invalid pack id")
  const name = nameOf(p.name, "pack name")
  const author = nameOf(p.author, "author")
  const license = nameOf(p.license, "licence", 90)
  if (!Array.isArray(p.entries) || p.entries.length < 1 || p.entries.length > MAX_ITEMS) throw new Error("Design pack must contain 1–160 looks")
  const ids = new Set<string>()
  const entries = p.entries as Entry[]
  for (const e of entries) {
    if (!e || typeof e !== "object" || !SLUG.test(e.id) || ids.has(e.id)) throw new Error("Duplicate or invalid design id")
    ids.add(e.id)
  }
  const looks = entries.map((e) => renderEntry(e, p.id as string))
  const themes = new Set(looks.filter((l) => l.kind === "theme").map((l) => l.id))
  const builtin = new Set(LIBRARY_LOOKS.filter((l) => l.kind === "theme").map((l) => l.id))
  for (const look of looks) if (look.kind === "scene") for (const layer of look.scene.layers) {
    if (layer.lookId && !themes.has(layer.lookId) && !builtin.has(layer.lookId)) throw new Error("Scene references an unavailable theme: " + layer.lookId)
  }
  return { id: p.id, name, author, license, looks }
}

export const useDesignPackStore = create<PackState>((set, get) => ({
  packs: [], ready: false,
  importPack: async (pack) => {
    const next = [...get().packs.filter((p) => p.id !== pack.id), pack]
    const store = await load("rhema-design-packs.json", { autoSave: false, defaults: {} })
    await store.set("packs", next)
    await store.save()
    set({ packs: next })
  },
  removePack: async (id) => {
    const next = get().packs.filter((p) => p.id !== id)
    const store = await load("rhema-design-packs.json", { autoSave: false, defaults: {} })
    await store.set("packs", next)
    await store.save()
    set({ packs: next })
  },
}))
let hydration: Promise<void> | null = null
export function hydrateDesignPacks(): Promise<void> {
  if (hydration) return hydration
  hydration = (async () => {
    try {
      const store = await load("rhema-design-packs.json", { autoSave: false, defaults: {} })
      const raw = await store.get("packs")
      if (Array.isArray(raw)) {
        // Hydrated packs contain only render data (no executable methods). A corrupted entry is skipped.
        const packs = raw.filter((x): x is ImportedPack => !!x && typeof x === "object" && typeof x.id === "string" && Array.isArray(x.looks) && x.looks.length <= MAX_ITEMS)
        useDesignPackStore.setState({ packs })
      }
    } catch {
      // An unavailable store should not prevent Design from opening in a browser preview.
    } finally { useDesignPackStore.setState({ ready: true }) }
  })()
  return hydration
}
/** Full catalog for Look Library preview/adoption. Import only registers looks; no Take or output routing. */
export function allRhemaLooks(): LibraryLook[] {
  return [...LIBRARY_LOOKS, ...useDesignPackStore.getState().packs.flatMap((p) => p.looks)]
}
