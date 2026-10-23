import type { BroadcastTheme, ContentType } from "@/types/broadcast"
import type { BroadcastOutput, LowerThirdStyle, StageStyle, TickerStyle } from "@/types/broadcast-output"
import type { Scene, SceneBox, SceneLayerKind } from "@/types/scene"
import { themeIdsOf } from "@/lib/output-themes"
import { newLayer } from "@/lib/scenes"
import { brandLowerThirdStyle, brandTheme, type BrandKit } from "@/lib/brand-kit"
import { BUNDLED_FONTS } from "@/lib/fonts"

/**
 * The built-in look library (#299 UX15-3). A library look is never edited or
 * put on air itself: Use copies it into the church's own looks (a theme, a
 * lower-third style, a scene, or the ticker or stage look), where it is an
 * ordinary editable look. No output changes until someone chooses the copy
 * for it (ADR 0001: no layout silently goes live).
 */

export type LookFamilyId = "church-classic" | "broadcast-clean" | "contemporary" | "warm-editorial" | "high-contrast" | "seasonal"
/** How the look sits in the frame. */
export type LookLayout = "fullscreen" | "lower-third" | "ticker" | "scene" | "stage"
/** What it is for. */
export type LookContent = "bible" | "lyrics" | "speaker" | "announcements" | "stage"
/** What is behind the words: a dark or light ground, or nothing (keyed over a camera). */
export type LookBackground = "dark" | "light" | "transparent"
/** A language a look reads right in: English, or Yorùbá (its dotted letters and tone marks). */
export type LookLanguage = "en" | "yo"

export interface LookFamily {
  id: LookFamilyId
  name: string
  description: string
}

/** A layer of a scene template; a feed layer names the library look it shows in. */
export interface SceneTemplateLayer {
  kind: Extract<SceneLayerKind, "camera" | "feed">
  name: string
  shows?: ContentType[]
  box: SceneBox
  lookId?: string
}

interface LookMeta {
  id: string
  name: string
  family: LookFamilyId
  /** One line: what it is for. */
  purpose: string
  layout: LookLayout
  content: LookContent
  background: LookBackground
  aspect: "16:9"
  /**
   * The languages it reads right in. Absent: worked out from its fonts (every bundled font carries
   * Yorùbá's letters). Set it when a look has words of one language built in (a ticker's "NOTICES" tag).
   */
  languages?: readonly LookLanguage[]
}

export type LibraryLook =
  | (LookMeta & { kind: "theme"; theme: BroadcastTheme })
  | (LookMeta & { kind: "lower-third"; style: LowerThirdStyle })
  | (LookMeta & { kind: "ticker"; style: TickerStyle })
  | (LookMeta & { kind: "stage"; style: StageStyle })
  | (LookMeta & { kind: "scene"; scene: { background: string; layers: SceneTemplateLayer[] } })

export const LAYOUT_NAMES: Record<LookLayout, string> = {
  fullscreen: "Full screen",
  "lower-third": "Lower third",
  ticker: "Ticker",
  scene: "Camera scene",
  stage: "Stage",
}

export const CONTENT_LABELS: Record<LookContent, string> = {
  bible: "Bible",
  lyrics: "Songs and hymns",
  speaker: "Speaker name",
  announcements: "Notices",
  stage: "Stage display",
}

export interface LookFilter {
  layout: LookLayout | "all"
  family: LookFamilyId | "all"
  background: LookBackground | "all"
  /** "both": looks that show two languages at once (a bilingual verse or song). Absent: any. */
  language?: LookLanguage | "both" | "all"
  /** Only the favourites (ids in `favourites`). */
  favouritesOnly?: boolean
  favourites?: ReadonlySet<string>
}

/** The looks a filter keeps, in library order. `looks` is the whole library (a scene's layers name looks in it). */
export function filterLooks(looks: readonly LibraryLook[], f: LookFilter): LibraryLook[] {
  const language = f.language ?? "all"
  return looks.filter((l) =>
    (f.layout === "all" || l.layout === f.layout) &&
    (f.family === "all" || l.family === f.family) &&
    (f.background === "all" || l.background === f.background) &&
    (language === "all" || (language === "both" ? showsTwoLanguages(l, looks) : lookLanguages(l, looks).includes(language))) &&
    (!f.favouritesOnly || (f.favourites?.has(l.id) ?? false)))
}

/** The fonts a look's words use; a scene's are its layers' looks'. */
function lookFonts(look: LibraryLook, library: readonly LibraryLook[]): string[] {
  switch (look.kind) {
    case "theme":
      return [look.theme.verseText.fontFamily, look.theme.reference.fontFamily, ...(look.theme.secondaryVerseText ? [look.theme.secondaryVerseText.fontFamily] : [])]
    case "lower-third":
    case "ticker":
      // null: the theme's verse font.
      return look.style.fontFamily ? [look.style.fontFamily] : []
    case "stage":
      return []
    case "scene":
      return layerLooks(look, library).flatMap((l) => lookFonts(l, library))
  }
}

const layerLooks = (look: Extract<LibraryLook, { kind: "scene" }>, library: readonly LibraryLook[]) =>
  look.scene.layers.flatMap((l) => library.filter((x) => x.id === l.lookId))

/**
 * The languages a look reads right in: its own `languages` when set, else English always and
 * Yorùbá when every font it uses is one Rhema bundles (each carries Yorùbá's dotted letters and
 * tone marks; a system font may not).
 */
export function lookLanguages(look: LibraryLook, library: readonly LibraryLook[] = []): LookLanguage[] {
  if (look.languages) return [...look.languages]
  const bundled = new Set<string>(BUNDLED_FONTS)
  return lookFonts(look, library).every((f) => bundled.has(f)) ? ["en", "yo"] : ["en"]
}

/**
 * Shows two languages at once: a theme with a style for the second language (a bilingual verse
 * or song slide gets its own block), the stage display (it shows every line live), or a scene
 * whose layer looks do. Name bands and tickers show one line of words, in whichever language.
 */
export function showsTwoLanguages(look: LibraryLook, library: readonly LibraryLook[] = []): boolean {
  const langs = lookLanguages(look, library)
  if (!langs.includes("en") || !langs.includes("yo")) return false
  switch (look.kind) {
    case "theme":
      return !!look.theme.secondaryVerseText
    case "stage":
      return true
    case "scene":
      return layerLooks(look, library).some((l) => showsTwoLanguages(l, library))
    default:
      return false
  }
}

/** The library looks "Use with church colours" works for: ones Use copies (not the church's one ticker or stage look). */
export function brandable(look: LibraryLook): boolean {
  return look.kind === "theme" || look.kind === "lower-third" || look.kind === "scene"
}

/** `name`, or `name 2`, `name 3`… when one of `taken` already has it. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()))
  if (!used.has(name.toLowerCase())) return name
  for (let n = 2; ; n++) if (!used.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`
}

/** What Use adds to the church's looks. Outputs are never in it. */
export interface AdoptedLook {
  /** New themes (copies): the look itself, or the looks a scene's layers show in. */
  themes: BroadcastTheme[]
  lowerThirdStyle?: LowerThirdStyle
  /** Replaces the church's one ticker look (the ticker on air keeps its look until it is started again). */
  tickerStyle?: TickerStyle
  /** Replaces the church's one stage look. */
  stageStyle?: StageStyle
  scene?: Scene
  /** With church colours: a look's own text or accent colour was kept, because the church's would not read on it. */
  kept?: { text: boolean; accent: boolean }
}

interface AdoptOptions {
  newId?: () => string
  now?: number
  /** Names already used by the church's themes, scenes and lower-third styles, so copies get their own. */
  takenNames?: readonly string[]
  /** Every library look, for a scene's layer looks. */
  library?: readonly LibraryLook[]
  /**
   * "Use with church colours": the copies take the Brand Kit's colours and fonts (only the copies;
   * the library look is never changed). Only for looks `brandable` allows.
   */
  brand?: BrandKit
}

const randomId = () => crypto.randomUUID()

/** A theme copy the church owns: a new id, editable, remembering the look it came from (for Reset). */
function copyTheme(source: BroadcastTheme, lookId: string, name: string, id: string, now: number): BroadcastTheme {
  return { ...structuredClone(source), id, name, builtin: false, pinned: false, createdAt: now, updatedAt: now, libraryLookId: lookId }
}

/**
 * Use a library look: copies with new ids, ready to be edited and chosen for an
 * output. Pure: the caller adds them to the store.
 */
export function adoptLook(look: LibraryLook, opts: AdoptOptions = {}): AdoptedLook {
  const newId = opts.newId ?? randomId
  const now = opts.now ?? Date.now()
  const taken = [...(opts.takenNames ?? [])]
  const brand = opts.brand && brandable(look) ? opts.brand : undefined
  // A church-colour copy says so in its name, so it is easy to tell from a plain one.
  const suffix = brand ? ` · ${brand.churchName.trim() || "Church colours"}` : ""
  const name = (n: string) => {
    const unique = uniqueName(n + suffix, taken)
    taken.push(unique)
    return unique
  }
  const kept = { text: false, accent: false }
  const branded = <T>(value: T, paint: (v: T, kit: BrandKit) => { value: T; keptText: boolean; keptAccent: boolean }): T => {
    if (!brand) return value
    const out = paint(value, brand)
    kept.text ||= out.keptText
    kept.accent ||= out.keptAccent
    return out.value
  }
  const theme = (source: BroadcastTheme, lookId: string, n: string) => branded(copyTheme(source, lookId, name(n), newId(), now), brandTheme)
  const withKept = (a: AdoptedLook): AdoptedLook => (brand ? { ...a, kept } : a)
  switch (look.kind) {
    case "theme":
      return withKept({ themes: [theme(look.theme, look.id, look.name)] })
    case "lower-third":
      return withKept({ themes: [], lowerThirdStyle: branded({ ...structuredClone(look.style), id: newId(), name: name(look.name) }, brandLowerThirdStyle) })
    case "ticker":
      return { themes: [], tickerStyle: structuredClone(look.style) }
    case "stage":
      return { themes: [], stageStyle: structuredClone(look.style) }
    case "scene": {
      // Each look the scene's layers show in becomes the church's own theme once.
      const themes: BroadcastTheme[] = []
      const copied = new Map<string, string>()
      for (const l of look.scene.layers) {
        if (!l.lookId || copied.has(l.lookId)) continue
        const source = (opts.library ?? []).find((x) => x.id === l.lookId)
        if (source?.kind !== "theme") continue
        const t = theme(source.theme, source.id, source.name)
        themes.push(t)
        copied.set(l.lookId, t.id)
      }
      const layers = look.scene.layers.map((l) => newLayer(l.kind, {
        id: newId(),
        name: l.name,
        box: { ...l.box },
        ...(l.shows ? { shows: [...l.shows] } : {}),
        ...(l.lookId && copied.has(l.lookId) ? { themeId: copied.get(l.lookId) } : {}),
      }))
      return withKept({ themes, scene: { id: newId(), name: name(look.name), background: look.scene.background, layers, createdAt: now, updatedAt: now } })
    }
  }
}

/** The library look a theme was copied from, when it still exists. */
export function sourceLook(theme: Pick<BroadcastTheme, "libraryLookId">, library: readonly LibraryLook[]): Extract<LibraryLook, { kind: "theme" }> | null {
  const look = theme.libraryLookId ? library.find((l) => l.id === theme.libraryLookId) : undefined
  return look?.kind === "theme" ? look : null
}

/** A copy put back as the library look has it; its id, name, favourite pin and date added stay. */
export function resetCopy(copy: BroadcastTheme, look: Extract<LibraryLook, { kind: "theme" }>, now = Date.now()): BroadcastTheme {
  return { ...copyTheme(look.theme, look.id, copy.name, copy.id, now), pinned: copy.pinned, createdAt: copy.createdAt }
}

/**
 * Where a theme shows now: outputs that use it, and outputs showing a scene
 * with a layer in it. Reset is refused for these, so nothing on air changes.
 */
export function themeUsedBy(themeId: string, outputs: readonly BroadcastOutput[], scenes: readonly Scene[]): string[] {
  return outputs
    .filter((o) => themeIdsOf(o).includes(themeId) || (!!o.sceneId && scenes.some((s) => s.id === o.sceneId && s.layers.some((l) => l.themeId === themeId))))
    .map((o) => o.name)
}

// ── favourites: a per-computer convenience, not church content ───────────
export const LOOK_FAVOURITES_KEY = "rhema-studio.look-favourites"

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readLookFavourites(storage: StorageLike | null): Set<string> {
  if (!storage) return new Set()
  try {
    const raw = JSON.parse(storage.getItem(LOOK_FAVOURITES_KEY) ?? "[]") as unknown
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}

export function writeLookFavourites(storage: StorageLike | null, ids: ReadonlySet<string>): void {
  if (!storage) return
  try {
    storage.setItem(LOOK_FAVOURITES_KEY, JSON.stringify([...ids]))
  } catch {
    // Private mode or quota: favourites are a convenience.
  }
}
