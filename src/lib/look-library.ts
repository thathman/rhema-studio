import type { BroadcastTheme, ContentType } from "@/types/broadcast"
import type { BroadcastOutput, BroadcastOutputStatus, LowerThird, LowerThirdStyle, StageStyle, Ticker, TickerStyle } from "@/types/broadcast-output"
import type { Scene, SceneBox, SceneLayerKind } from "@/types/scene"
import { themeIdsOf } from "@/lib/output-themes"
import { newLayer, sceneForOutput } from "@/lib/scenes"
import { brandLowerThirdStyle, brandTheme, type BrandKit } from "@/lib/brand-kit"
import { BUNDLED_FONTS } from "@/lib/fonts"
import { outputOnAir } from "@/lib/output-on-air"
import type { DesignDraft } from "@/lib/design-drafts"

/**
 * The built-in look library (#299 UX15-3). A library look is never edited or
 * put on air itself: Use copies it into the church's own themes, lower-third
 * styles and scenes, or saves ticker and stage designs as drafts. No output
 * changes until someone deliberately applies or routes a design (ADR 0001).
 */

/** A built-in family, or an imported design pack's (`pack:<pack id>`, see design-packs.ts). */
export type LookFamilyId = "church-classic" | "broadcast-clean" | "contemporary" | "warm-editorial" | "high-contrast" | "seasonal" | `pack:${string}`
/** How the look sits in the frame. */
export type LookLayout = "fullscreen" | "lower-third" | "ticker" | "scene" | "stage"
/** What it is for. */
export type LookContent = "bible" | "lyrics" | "speaker" | "announcements" | "stage"
/** What is behind the words: a dark or light ground, or nothing (keyed over a camera). */
export type LookBackground = "dark" | "light" | "transparent"
/** A language a look reads right in: English, or Yorùbá (its dotted letters and tone marks). */
export type LookLanguage = "en" | "yo"
/** The frame's shape: wide (every screen and stream today) or tall (a phone or a portrait screen). */
export type LookAspect = "16:9" | "9:16"
/**
 * Sound: "silent" looks make none of their own, so they sit over any feed that carries the service's
 * sound (an NDI or OBS stream); an "own-sound" look plays a video with sound that would mix with it.
 */
export type LookAudio = "silent" | "own-sound"

export interface LookFamily {
  id: LookFamilyId
  name: string
  description: string
}

/**
 * A layer of a scene template; a feed layer names the library look it shows in. A picture, video,
 * camera or logo layer is a place only: the church chooses its picture, video or camera in Scenes.
 */
export interface SceneTemplateLayer {
  kind: SceneLayerKind
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
  /** Every look is drawn 16:9 today; a 9:16 look would need a tall output to show it. */
  aspect: LookAspect
  /** Absent: "silent" (no look in the library has sound of its own yet). */
  audio?: LookAudio
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

/** The OBS overlay filter's name: keyed lower thirds and tickers, to lay over the camera in OBS. */
export const OBS_OVERLAY = "OBS overlay"

export const CONTENT_LABELS: Record<LookContent, string> = {
  bible: "Bible",
  lyrics: "Songs and hymns",
  speaker: "Speaker name",
  announcements: "Notices",
  stage: "Stage display",
}

export interface LookFilter {
  /** "obs-overlay": keyed lower thirds and tickers (see `isObsOverlay`). */
  layout: LookLayout | "obs-overlay" | "all"
  family: LookFamilyId | "all"
  background: LookBackground | "all"
  /** "both": looks that show two languages at once (a bilingual verse or song). Absent: any. */
  language?: LookLanguage | "both" | "all"
  /** Absent: any. */
  aspect?: LookAspect | "all"
  /** Only the favourites (ids in `favourites`). */
  favouritesOnly?: boolean
  favourites?: ReadonlySet<string>
}

/** The looks a filter keeps, in library order. `looks` is the whole library (a scene's layers name looks in it). */
export function filterLooks(looks: readonly LibraryLook[], f: LookFilter): LibraryLook[] {
  const language = f.language ?? "all"
  const aspect = f.aspect ?? "all"
  return looks.filter((l) =>
    (f.layout === "all" || (f.layout === "obs-overlay" ? isObsOverlay(l) : l.layout === f.layout)) &&
    (aspect === "all" || l.aspect === aspect) &&
    (f.family === "all" || l.family === f.family) &&
    (f.background === "all" || l.background === f.background) &&
    (language === "all" || (language === "both" ? showsTwoLanguages(l, looks) : lookLanguages(l, looks).includes(language))) &&
    (!f.favouritesOnly || (f.favourites?.has(l.id) ?? false)))
}

/**
 * An OBS overlay: a lower third or ticker with nothing behind it, so OBS (over NDI with alpha, or a
 * browser source) lays it over the camera. Worked out from the look, not a separate list to keep.
 */
export function isObsOverlay(look: Pick<LibraryLook, "layout" | "background">): boolean {
  return look.background === "transparent" && (look.layout === "lower-third" || look.layout === "ticker")
}

/** Whether the look plays sound of its own. */
export function lookAudio(look: Pick<LibraryLook, "audio">): LookAudio {
  return look.audio ?? "silent"
}

/** The frame shapes the library has looks in, wide first. */
export function lookAspects(looks: readonly LibraryLook[]): LookAspect[] {
  return (["16:9", "9:16"] as const).filter((a) => looks.some((l) => l.aspect === a))
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
  /** Copy to save as a ticker design draft. */
  tickerStyle?: TickerStyle
  /** Copy to save as a stage design draft. */
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
  /** Layer looks the church already has a copy of (library look id → theme id): a scene uses those instead of new copies. */
  reuse?: ReadonlyMap<string, string>
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
      return withKept({ themes: [], lowerThirdStyle: branded({ ...structuredClone(look.style), id: newId(), name: name(look.name), libraryLookId: look.id }, brandLowerThirdStyle) })
    case "ticker":
      return { themes: [], tickerStyle: { ...structuredClone(look.style), libraryLookId: look.id } }
    case "stage":
      return { themes: [], stageStyle: { ...structuredClone(look.style), libraryLookId: look.id } }
    case "scene": {
      // Each look the scene's layers show in becomes the church's own theme once.
      const themes: BroadcastTheme[] = []
      const copied = new Map<string, string>(opts.reuse ?? [])
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
      return withKept({ themes, scene: { id: newId(), name: name(look.name), background: look.scene.background, layers, createdAt: now, updatedAt: now, libraryLookId: look.id } })
    }
  }
}

export type LookOf<K extends LibraryLook["kind"]> = Extract<LibraryLook, { kind: K }>

/** The library look of this kind a copy came from, when it still exists. */
export function libraryLookOf<K extends LibraryLook["kind"]>(kind: K, libraryLookId: string | undefined, library: readonly LibraryLook[]): LookOf<K> | null {
  const look = libraryLookId ? library.find((l) => l.id === libraryLookId) : undefined
  return look?.kind === kind ? (look as LookOf<K>) : null
}

/** The library look a theme was copied from, when it still exists. */
export function sourceLook(theme: Pick<BroadcastTheme, "libraryLookId">, library: readonly LibraryLook[]): LookOf<"theme"> | null {
  return libraryLookOf("theme", theme.libraryLookId, library)
}

/** A copy put back as the library look has it; its id, name, favourite pin and date added stay. */
export function resetCopy(copy: BroadcastTheme, look: Extract<LibraryLook, { kind: "theme" }>, now = Date.now()): BroadcastTheme {
  return { ...copyTheme(look.theme, look.id, copy.name, copy.id, now), pinned: copy.pinned, createdAt: copy.createdAt }
}

/** A lower-third style put back as the library look has it; its id and name stay. */
export function resetLowerThirdCopy(copy: LowerThirdStyle, look: LookOf<"lower-third">): LowerThirdStyle {
  return { ...structuredClone(look.style), id: copy.id, name: copy.name, libraryLookId: look.id }
}

/** The church's ticker or stage look put back as the library look has it. */
export function resetSingleLook<T extends TickerStyle | StageStyle>(look: { style: T; id: string }): T {
  return { ...structuredClone(look.style), libraryLookId: look.id }
}

/**
 * A scene copy put back as the library template has it: its id, name and date added stay; its
 * layers come back as the template places them. The looks its layers showed in are used again
 * (not reset, other scenes or outputs may show them); only a missing one is copied anew. A camera
 * layer keeps its stream address and the words shown while it is not playing.
 */
export function resetSceneCopy(copy: Scene, look: LookOf<"scene">, opts: AdoptOptions & { themes: readonly BroadcastTheme[] }): { scene: Scene; themes: BroadcastTheme[] } {
  const now = opts.now ?? Date.now()
  const reuse = new Map<string, string>()
  for (const l of copy.layers) {
    const t = l.themeId ? opts.themes.find((x) => x.id === l.themeId) : undefined
    if (t?.libraryLookId && !reuse.has(t.libraryLookId)) reuse.set(t.libraryLookId, t.id)
  }
  const fresh = adoptLook(look, { ...opts, now, brand: undefined, reuse })
  const cameras = copy.layers.filter((l) => l.kind === "camera")
  let next = 0
  const layers = (fresh.scene?.layers ?? []).map((l) => {
    if (l.kind !== "camera") return l
    const was = cameras[next++]
    return was ? { ...l, ...(was.cameraUrl ? { cameraUrl: was.cameraUrl } : {}), ...(was.cameraFallback ? { cameraFallback: was.cameraFallback } : {}), ...(was.noSignal ? { noSignal: was.noSignal } : {}), ...(was.noSignalName ? { noSignalName: true } : {}) } : l
  })
  return { scene: { ...(fresh.scene as Scene), id: copy.id, name: copy.name, layers, createdAt: copy.createdAt, updatedAt: now }, themes: fresh.themes }
}

/** One of the church's copies of a library look, and what shows it now (Reset is refused while anything does). */
export interface LookCopy {
  id: string
  name: string
  usedBy: string[]
}

/** The church's looks, scenes and what is on air, for finding a library look's copies. */
export interface ChurchLooks {
  themes: readonly BroadcastTheme[]
  lowerThirdStyles: readonly LowerThirdStyle[]
  scenes: readonly Scene[]
  tickerStyle: TickerStyle
  stageStyle: StageStyle
  tickerDraft?: Extract<DesignDraft, { kind: "ticker" }>
  stageDraft?: Extract<DesignDraft, { kind: "stage" }>
  outputs: readonly BroadcastOutput[]
  outputStatus?: Readonly<Record<string, BroadcastOutputStatus>>
  lowerThird?: LowerThird | null
  ticker?: Ticker | null
}

/**
 * The church's copies of a library look, each with what shows it now: outputs using a theme (or a
 * scene with it), the name band on air in a lower-third style, outputs showing a scene, the ticker
 * running, stage screens that are on.
 */
export function lookCopies(look: LibraryLook, s: ChurchLooks): LookCopy[] {
  switch (look.kind) {
    case "theme":
      return s.themes.filter((t) => t.libraryLookId === look.id).map((t) => ({ id: t.id, name: t.name, usedBy: themeUsedBy(t.id, s.outputs, s.scenes) }))
    case "lower-third":
      return s.lowerThirdStyles.filter((x) => x.libraryLookId === look.id).map((x) => ({ id: x.id, name: x.name, usedBy: s.lowerThird?.style?.id === x.id ? ["the name band on air"] : [] }))
    case "scene":
      return s.scenes.filter((x) => x.libraryLookId === look.id).map((x) => ({ id: x.id, name: x.name, usedBy: s.outputs.filter((o) => o.sceneId === x.id).map((o) => o.name) }))
    case "ticker": {
      const draft = s.tickerDraft
      const style = draft?.value ?? s.tickerStyle
      return style.libraryLookId === look.id ? [{ id: "ticker", name: draft ? "Your ticker draft" : "Your ticker look", usedBy: draft ? [] : s.ticker ? ["the ticker running now"] : [] }] : []
    }
    case "stage": {
      const draft = s.stageDraft
      const style = draft?.value ?? s.stageStyle
      if (style.libraryLookId !== look.id) return []
      if (draft) return [{ id: "stage", name: "Your stage draft", usedBy: [] }]
      const on = s.outputs.filter((o) => o.role === "stage" && outputOnAir(o, s.outputStatus?.[o.id])).map((o) => o.name)
      return [{ id: "stage", name: "Your stage display look", usedBy: on }]
    }
  }
}

/**
 * Where a theme shows now: outputs that use it, and outputs showing a scene
 * with a layer in it. Reset is refused for these, so nothing on air changes.
 */
export function themeUsedBy(themeId: string, outputs: readonly BroadcastOutput[], scenes: readonly Scene[]): string[] {
  return outputs
    .filter((o) => themeIdsOf(o).includes(themeId) || sceneForOutput(o, scenes)?.layers.some((l) => l.themeId === themeId))
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
