import { create } from "zustand"
import { load } from "@tauri-apps/plugin-store"
import type { BroadcastTheme, ContentType } from "@/types/broadcast"
import type { LowerThirdStyle, TickerStyle } from "@/types/broadcast-output"
import type { SceneLayerKind } from "@/types/scene"
import { LIBRARY_LOOKS, LOOK_FAMILIES } from "@/lib/look-library-data"
import type { LibraryLook, LookBackground, LookContent, LookFamily, LookFamilyId, SceneTemplateLayer } from "@/lib/look-library"
import { contrastRatio } from "@/lib/brand-kit"
import { BUNDLED_FONTS } from "@/lib/fonts"
import worshipExpressionsSource from "../../design-packs/rhema-worship-expressions.rhema-design.json?raw"

/**
 * Design packs (#354): a file of look recipes a church imports into Design → Library. A recipe
 * names a built-in look and changes its colours and type, or lays out a scene template; the
 * importer builds ordinary library looks from it, so Use, Use with church colours, Reset and the
 * filters work on them as on the built-in ones. Importing only adds looks to the library: nothing
 * goes on air, and no output, camera or scene changes (ADR 0001). A file is data, never code: no
 * address, path or font from outside Rhema is read from it, and anything it does not know is dropped.
 */
export const DESIGN_PACK_FORMAT = "rhema.design-pack"
export const DESIGN_PACK_VERSION = 1
export const DESIGN_PACK_MAX_BYTES = 2_000_000
export const DESIGN_PACK_MAX_LOOKS = 160
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/
const COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const LAYER_KINDS: ReadonlySet<SceneLayerKind> = new Set(["feed", "camera", "color", "picture", "video", "clock", "ticker", "lowerThird", "logo"])
const SOURCES: ReadonlySet<ContentType> = new Set(["bible", "song", "hymn", "slide", "picture"])

/** A recipe's changes to its built-in look; each one optional. */
export interface PackVariant {
  background?: string
  /** 2–5 colours, evenly spaced; `radial` for a radial one. */
  gradient?: string[]
  radial?: boolean
  foreground?: string
  secondary?: string
  accent?: string
  /** The box behind the words (theme), or the band (lower third, ticker). */
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

export interface PackLayer {
  kind: SceneLayerKind
  name: string
  box: { x: number; y: number; w: number; h: number }
  shows?: ContentType[]
  /** A theme in the same pack (its entry id), or a built-in theme look ("look-…"). */
  lookId?: string
}

export interface PackEntry {
  id: string
  name: string
  purpose?: string
  /** The built-in look it starts from. */
  from?: string
  variant?: PackVariant
  scene?: { background: string; layers: PackLayer[] }
}

/** A pack as it is kept and backed up: only what the importer read and checked. */
export interface DesignPackDoc {
  format: typeof DESIGN_PACK_FORMAT
  version: typeof DESIGN_PACK_VERSION
  id: string
  name: string
  author: string
  license: string
  description?: string
  entries: PackEntry[]
}

export interface DesignPack {
  doc: DesignPackDoc
  family: LookFamily
  looks: LibraryLook[]
}

class PackError extends Error {}
const fail = (message: string): never => {
  throw new PackError(message)
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function text(v: unknown, what: string, max: number): string {
  // Plain words: no markup and no control characters.
  if (typeof v !== "string" || !v.trim() || v.length > max || /[<>]/.test(v) || [...v].some((c) => c.charCodeAt(0) < 32)) fail(`${what} is missing or not plain text (at most ${max} characters).`)
  return (v as string).trim()
}
function colour(v: unknown, what: string): string {
  if (typeof v !== "string" || !COLOUR.test(v)) fail(`${what} is not a colour like #1a2b3c.`)
  return v as string
}
function num(v: unknown, what: string, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${what} is not a number.`)
  return Math.max(lo, Math.min(hi, v as number))
}
function oneOf<T extends string>(v: unknown, what: string, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) fail(`${what} must be one of ${allowed.join(", ")}.`)
  return v as T
}

/** The variant with only the fields Rhema knows, each checked. */
function readVariant(raw: unknown, where: string): PackVariant {
  if (raw === undefined) return {}
  if (!isObject(raw)) return fail(`${where}: "variant" is not an object.`)
  const v: PackVariant = {}
  if (raw.gradient !== undefined) {
    if (!Array.isArray(raw.gradient) || raw.gradient.length < 2 || raw.gradient.length > 5) fail(`${where}: a gradient has 2 to 5 colours.`)
    v.gradient = (raw.gradient as unknown[]).map((c) => colour(c, `${where}: a gradient colour`))
  }
  if (raw.radial !== undefined) v.radial = raw.radial === true
  for (const key of ["background", "foreground", "secondary", "accent", "plate"] as const) if (raw[key] !== undefined) v[key] = colour(raw[key], `${where}: ${key}`)
  if (raw.plateOpacity !== undefined) v.plateOpacity = num(raw.plateOpacity, `${where}: plateOpacity`, 0, 1)
  if (raw.fontSize !== undefined) v.fontSize = num(raw.fontSize, `${where}: fontSize`, 26, 130)
  if (raw.referenceSize !== undefined) v.referenceSize = num(raw.referenceSize, `${where}: referenceSize`, 16, 85)
  // Only a font Rhema carries: never one to fetch, and one that has Yorùbá's letters.
  if (raw.fontFamily !== undefined) v.fontFamily = oneOf(raw.fontFamily, `${where}: fontFamily`, BUNDLED_FONTS)
  if (raw.align !== undefined) v.align = oneOf(raw.align, `${where}: align`, ["left", "center", "right"] as const)
  if (raw.bottom !== undefined) v.bottom = num(raw.bottom, `${where}: bottom`, 0, 60)
  if (raw.height !== undefined) v.height = num(raw.height, `${where}: height`, 4, 40)
  if (raw.motion !== undefined) v.motion = oneOf(raw.motion, `${where}: motion`, ["crawl", "pages"] as const)
  if (raw.speed !== undefined) v.speed = num(raw.speed, `${where}: speed`, 20, 600)
  if (raw.label !== undefined) v.label = text(raw.label, `${where}: label`, 24)
  return v
}

/** A scene layer with only its place, its sources and its look: no address, picture or video. */
function readLayer(raw: unknown, where: string): PackLayer {
  if (!isObject(raw)) return fail(`${where}: a layer is not an object.`)
  if (!LAYER_KINDS.has(raw.kind as SceneLayerKind)) fail(`${where}: "${String(raw.kind)}" is not a kind of scene layer.`)
  const b = raw.box
  if (!isObject(b)) return fail(`${where}: a layer has no box.`)
  const [x, y, w, h] = [b.x, b.y, b.w, b.h].map((n) => (typeof n === "number" && Number.isFinite(n) ? n : NaN))
  if ([x, y, w, h].some(Number.isNaN) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 100.01 || y + h > 100.01) fail(`${where}: a layer's box is outside the frame.`)
  const layer: PackLayer = { kind: raw.kind as SceneLayerKind, name: text(raw.name, `${where}: a layer name`, 80), box: { x, y, w, h } }
  if (raw.shows !== undefined) {
    if (!Array.isArray(raw.shows) || !raw.shows.every((s) => SOURCES.has(s as ContentType))) fail(`${where}: a layer shows something Rhema does not have.`)
    layer.shows = [...new Set(raw.shows as ContentType[])]
  }
  if (raw.lookId !== undefined) {
    if (typeof raw.lookId !== "string" || !(SLUG.test(raw.lookId) || /^look-[a-z0-9-]+$/.test(raw.lookId))) fail(`${where}: a layer's look is not a look id.`)
    layer.lookId = raw.lookId as string
  }
  return layer
}

function readEntry(raw: unknown, index: number): PackEntry {
  if (!isObject(raw)) return fail(`Look ${index + 1} is not an object.`)
  if (typeof raw.id !== "string" || !SLUG.test(raw.id)) fail(`Look ${index + 1} has no id (lower-case letters, digits and dashes).`)
  const where = `"${raw.id as string}"`
  const entry: PackEntry = { id: raw.id as string, name: text(raw.name, `${where}: the name`, 110) }
  if (raw.purpose !== undefined) entry.purpose = text(raw.purpose, `${where}: the purpose`, 300)
  if (raw.from !== undefined) {
    if (typeof raw.from !== "string" || !LIBRARY_LOOKS.some((l) => l.id === raw.from)) fail(`${where}: "${String(raw.from)}" is not a look in this version of Rhema.`)
    entry.from = raw.from as string
  }
  const variant = readVariant(raw.variant, where)
  if (Object.keys(variant).length) entry.variant = variant
  if (raw.scene !== undefined) {
    const s = raw.scene
    if (!isObject(s) || !Array.isArray(s.layers) || s.layers.length < 1 || s.layers.length > 20) return fail(`${where}: a scene has 1 to 20 layers.`)
    const background = s.background === "transparent" ? "transparent" : colour(s.background, `${where}: the scene background`)
    entry.scene = { background, layers: s.layers.map((l) => readLayer(l, where)) }
  }
  if (!entry.from && !entry.scene) fail(`${where} names no built-in look ("from") and has no scene.`)
  return entry
}

const lightOrDark = (color: string): LookBackground => (contrastRatio(color, "#000000") > contrastRatio(color, "#ffffff") ? "light" : "dark")

function paintTheme(base: BroadcastTheme, v: PackVariant): BroadcastTheme {
  const t = structuredClone(base)
  if (v.gradient) {
    const stops = v.gradient.map((color, i, all) => ({ color, position: Math.round((100 * i) / (all.length - 1)) }))
    t.background = { type: "gradient", color: v.gradient[0], gradient: { type: v.radial ? "radial" : "linear", angle: 110, stops }, image: null }
  } else if (v.background) t.background = { type: "solid", color: v.background, gradient: null, image: null }
  if (v.foreground) t.verseText.color = v.foreground
  if (v.secondary && t.secondaryVerseText) t.secondaryVerseText.color = v.secondary
  if (v.accent) {
    t.reference.color = v.accent
    t.verseNumbers.color = v.accent
  }
  if (v.plate) t.textBox = { ...t.textBox, enabled: true, color: v.plate, opacity: v.plateOpacity ?? 0.9, image: null }
  if (v.fontSize !== undefined) t.verseText.fontSize = v.fontSize
  if (v.referenceSize !== undefined) t.reference.fontSize = v.referenceSize
  if (v.fontFamily) {
    t.verseText.fontFamily = v.fontFamily
    if (t.secondaryVerseText) t.secondaryVerseText.fontFamily = v.fontFamily
  }
  if (v.align) {
    t.layout.textAlign = v.align
    t.verseText.horizontalAlign = v.align
    t.reference.horizontalAlign = v.align
  }
  return t
}

/** What a scene is for, from what its layers show. */
function sceneContent(layers: readonly PackLayer[], fallback: LookContent): LookContent {
  const shows = new Set(layers.flatMap((l) => l.shows ?? []))
  if (shows.has("bible")) return "bible"
  if (shows.has("song") || shows.has("hymn")) return "lyrics"
  if (shows.has("slide") || layers.some((l) => l.kind === "ticker")) return "announcements"
  if (layers.some((l) => l.kind === "lowerThird")) return "speaker"
  return fallback
}

/** The pack's family in the library: its looks are grouped under the pack's name. */
export const packFamilyId = (packId: string): LookFamilyId => `pack:${packId}`

function buildLook(entry: PackEntry, doc: DesignPackDoc): LibraryLook {
  const id = `${doc.id}/${entry.id}`
  const source = entry.from ? LIBRARY_LOOKS.find((l) => l.id === entry.from) : undefined
  const v = entry.variant ?? {}
  const meta = { id, name: entry.name, purpose: entry.purpose ?? source?.purpose ?? "", family: packFamilyId(doc.id), aspect: source?.aspect ?? "16:9", ...(source?.languages ? { languages: source.languages } : {}) } as const
  if (entry.scene) {
    const layers: SceneTemplateLayer[] = entry.scene.layers.map((l) => ({
      kind: l.kind,
      name: l.name,
      box: { ...l.box },
      ...(l.shows ? { shows: [...l.shows] } : {}),
      ...(l.lookId ? { lookId: l.lookId.startsWith("look-") ? l.lookId : `${doc.id}/${l.lookId}` } : {}),
    }))
    const background: LookBackground = entry.scene.background === "transparent" ? "transparent" : lightOrDark(entry.scene.background)
    return { ...meta, kind: "scene", layout: "scene", content: sceneContent(entry.scene.layers, source?.content ?? "bible"), background, aspect: "16:9", scene: { background: entry.scene.background, layers } }
  }
  if (!source) return fail(`"${entry.id}" names no built-in look.`)
  const base = { ...meta, layout: source.layout, content: source.content }
  switch (source.kind) {
    case "theme": {
      const theme = paintTheme(source.theme, v)
      const background: LookBackground = theme.background.type === "transparent" ? "transparent" : lightOrDark(theme.background.color)
      return { ...base, kind: "theme", background, theme: { ...theme, id, name: entry.name, builtin: true } }
    }
    case "lower-third": {
      const s: LowerThirdStyle = structuredClone(source.style)
      if (v.plate) s.background.color = v.plate
      if (v.foreground) s.line1.color = v.foreground
      if (v.secondary) s.line2.color = v.secondary
      if (v.accent) s.accent.color = v.accent
      if (v.bottom !== undefined) s.bottom = v.bottom
      if (v.height !== undefined) s.height = v.height
      return { ...base, kind: "lower-third", background: source.background, style: { ...s, id, name: entry.name } }
    }
    case "ticker": {
      const s: TickerStyle = structuredClone(source.style)
      if (v.plate) s.background.color = v.plate
      if (v.foreground) s.color = v.foreground
      if (v.accent) s.labelBackground = v.accent
      if (v.label !== undefined) s.label = v.label
      if (v.motion) s.motion = v.motion
      if (v.speed !== undefined) s.speed = v.speed
      return { ...base, kind: "ticker", background: source.background, style: s }
    }
    case "stage":
      return { ...base, kind: "stage", background: source.background, style: structuredClone(source.style) }
    case "scene":
      return { ...base, kind: "scene", background: source.background, scene: structuredClone(source.scene) }
  }
}

/** A pack's document, checked: what is not known is dropped, what is wrong is refused with a reason. */
export function readDesignPackDoc(raw: unknown): DesignPackDoc {
  if (!isObject(raw) || raw.format !== DESIGN_PACK_FORMAT) return fail("This is not a Rhema design pack.")
  if (raw.version !== DESIGN_PACK_VERSION) fail(`This design pack is version ${String(raw.version)}; this Rhema reads version ${DESIGN_PACK_VERSION}.`)
  if (typeof raw.id !== "string" || !SLUG.test(raw.id)) fail("The pack has no id (lower-case letters, digits and dashes).")
  if (!Array.isArray(raw.entries) || raw.entries.length < 1 || raw.entries.length > DESIGN_PACK_MAX_LOOKS) fail(`A design pack has 1 to ${DESIGN_PACK_MAX_LOOKS} looks.`)
  const entries = (raw.entries as unknown[]).map(readEntry)
  const ids = new Set<string>()
  for (const e of entries) {
    if (ids.has(e.id)) fail(`Two looks are called "${e.id}".`)
    ids.add(e.id)
  }
  return {
    format: DESIGN_PACK_FORMAT,
    version: DESIGN_PACK_VERSION,
    id: raw.id as string,
    name: text(raw.name, "The pack name", 110),
    author: text(raw.author, "The author", 110),
    license: text(raw.license, "The licence", 90),
    ...(raw.description !== undefined ? { description: text(raw.description, "The description", 400) } : {}),
    entries,
  }
}

/** The library looks a checked document makes. A scene's layer looks must be themes in the pack or built in. */
export function designPackFrom(doc: DesignPackDoc): DesignPack {
  const looks = doc.entries.map((e) => buildLook(e, doc))
  const themes = new Set([...LIBRARY_LOOKS, ...looks].filter((l) => l.kind === "theme").map((l) => l.id))
  for (const look of looks) {
    if (look.kind !== "scene") continue
    for (const layer of look.scene.layers) if (layer.lookId && !themes.has(layer.lookId)) fail(`"${look.name}" shows a layer in "${layer.lookId}", which is not a theme in this pack or in Rhema.`)
  }
  const family: LookFamily = { id: packFamilyId(doc.id), name: doc.name, description: doc.description ?? `Imported design pack by ${doc.author} (${doc.license}).` }
  return { doc, family, looks }
}

/** Read a design pack file's text: refused over 2 MB, when it is not JSON, or when a look is wrong. */
export function parseDesignPack(json: string): DesignPack {
  if (new TextEncoder().encode(json).length > DESIGN_PACK_MAX_BYTES) fail("This design pack is larger than 2 MB.")
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return fail("This file is not a Rhema design pack (it is not JSON).")
  }
  return designPackFrom(readDesignPackDoc(raw))
}

// Use the same strict parser for app-bundled recipes and imported files. This keeps the gallery
// available on a clean, offline install without introducing a second, looser data path.
const BUNDLED_DESIGN_PACKS: readonly DesignPack[] = [parseDesignPack(worshipExpressionsSource)]
const BUNDLED_DESIGN_PACK_BY_ID = new Map(BUNDLED_DESIGN_PACKS.map((pack) => [pack.doc.id, pack]))

export function isBundledDesignPack(id: string): boolean {
  return BUNDLED_DESIGN_PACK_BY_ID.has(id)
}

/** A kept or backed-up pack, read again as an import is; null when it no longer reads (it is left out). */
function packOrNull(raw: unknown): DesignPack | null {
  try {
    return designPackFrom(readDesignPackDoc(raw))
  } catch (e) {
    console.warn("[design-packs] a saved pack was left out:", e instanceof Error ? e.message : e)
    return null
  }
}

// ── the imported packs on this computer ──────────────────────────────────

interface PackState {
  packs: DesignPack[]
}

export const useDesignPackStore = create<PackState>(() => ({ packs: [] }))

const STORE_FILE = "rhema-design-packs.json"

async function persist(packs: readonly DesignPack[]): Promise<void> {
  try {
    const store = await load(STORE_FILE, { autoSave: false, defaults: {} })
    await store.set("packs", packs.map((p) => p.doc))
    await store.save()
  } catch {
    console.warn("[design-packs] could not save the imported packs")
  }
}

let hydration: Promise<void> | null = null

function storedPacks(raw: unknown): { packs: DesignPack[]; validCount: number } {
  if (!Array.isArray(raw)) return { packs: [], validCount: 0 }
  const valid = raw.map(packOrNull).filter((p): p is DesignPack => p !== null)
  // Last saved version wins, matching importDesignPack's replace-by-id behavior.
  const unique = [...new Map(valid.map((pack) => [pack.doc.id, pack])).values()]
  // Older Rhema versions required manual import. Remove an unchanged copy now that it ships with
  // the app; preserve customized copies as a local override, keeping stable look IDs.
  const packs = unique.filter((pack) => {
    const bundled = BUNDLED_DESIGN_PACK_BY_ID.get(pack.doc.id)
    return !bundled || JSON.stringify(pack.doc) !== JSON.stringify(bundled.doc)
  })
  return { packs, validCount: valid.length }
}

/** Load the imported packs; each is checked again, as on import. */
export function hydrateDesignPacks(): Promise<void> {
  hydration ??= (async () => {
    try {
      const store = await load(STORE_FILE, { autoSave: false, defaults: {} })
      const raw = await store.get("packs")
      if (Array.isArray(raw)) {
        const { packs, validCount } = storedPacks(raw)
        useDesignPackStore.setState({ packs })
        if (packs.length !== validCount) await persist(packs)
      }
    } catch {
      // No store (a browser preview, a test): no imported packs.
    }
  })()
  return hydration
}

/** Add a pack to the library, or replace the one with its id. Copies already made stay as they are. */
export async function importDesignPack(pack: DesignPack): Promise<void> {
  await hydrateDesignPacks()
  const current = useDesignPackStore.getState().packs
  if (isBundledDesignPack(pack.doc.id) && !current.some((p) => p.doc.id === pack.doc.id)) {
    throw new Error("This pack is included with Rhema Studio. To import a customized version, give it a different pack ID.")
  }
  const packs = [...current.filter((p) => p.doc.id !== pack.doc.id), pack]
  useDesignPackStore.setState({ packs })
  await persist(packs)
}

/** Take a pack out of the library. The church's copies of its looks stay theirs. */
export async function removeDesignPack(id: string): Promise<void> {
  await hydrateDesignPacks()
  const packs = useDesignPackStore.getState().packs.filter((p) => p.doc.id !== id)
  useDesignPackStore.setState({ packs })
  await persist(packs)
}

/** The imported packs as a backup file carries them. */
export function designPacksForBackup(packs: readonly DesignPack[] = useDesignPackStore.getState().packs): DesignPackDoc[] {
  return packs.map((p) => p.doc)
}

/** Put a backup's packs in place of these, each checked as on import; one that does not read is left out. */
export async function restoreDesignPacksFromBackup(raw: unknown): Promise<void> {
  if (!Array.isArray(raw)) return
  await hydrateDesignPacks()
  const { packs } = storedPacks(raw)
  useDesignPackStore.setState({ packs })
  await persist(packs)
}

// ── the library: built-in looks, then each imported pack's ───────────────

export function libraryLooks(packs: readonly DesignPack[] = useDesignPackStore.getState().packs): LibraryLook[] {
  const imported = uniquePacks(packs)
  const importedIds = new Set(imported.map((pack) => pack.doc.id))
  const bundled = BUNDLED_DESIGN_PACKS.filter((pack) => !importedIds.has(pack.doc.id))
  return [...LIBRARY_LOOKS, ...bundled.flatMap((pack) => pack.looks), ...imported.flatMap((pack) => pack.looks)]
}

export function libraryFamilies(packs: readonly DesignPack[] = useDesignPackStore.getState().packs): LookFamily[] {
  const imported = uniquePacks(packs)
  const importedIds = new Set(imported.map((pack) => pack.doc.id))
  const bundled = BUNDLED_DESIGN_PACKS.filter((pack) => !importedIds.has(pack.doc.id))
  return [...LOOK_FAMILIES, ...bundled.map((pack) => pack.family), ...imported.map((pack) => pack.family)]
}

function uniquePacks(packs: readonly DesignPack[]): DesignPack[] {
  return [...new Map(packs.map((pack) => [pack.doc.id, pack])).values()]
}

/** For tests: forget the loaded packs. */
export function resetDesignPacksForTests(): void {
  hydration = null
  useDesignPackStore.setState({ packs: [] })
}
