import type { BroadcastTheme, ContentType } from "@/types/broadcast"
import type { BroadcastOutput, LowerThirdStyle, StageStyle, TickerStyle } from "@/types/broadcast-output"
import type { Scene, SceneBox, SceneLayerKind } from "@/types/scene"
import { themeIdsOf } from "@/lib/output-themes"
import { newLayer } from "@/lib/scenes"

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
  /** Only the favourites (ids in `favourites`). */
  favouritesOnly?: boolean
  favourites?: ReadonlySet<string>
}

/** The looks a filter keeps, in library order. */
export function filterLooks(looks: readonly LibraryLook[], f: LookFilter): LibraryLook[] {
  return looks.filter((l) =>
    (f.layout === "all" || l.layout === f.layout) &&
    (f.family === "all" || l.family === f.family) &&
    (f.background === "all" || l.background === f.background) &&
    (!f.favouritesOnly || (f.favourites?.has(l.id) ?? false)))
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
}

interface AdoptOptions {
  newId?: () => string
  now?: number
  /** Names already used by the church's themes, scenes and lower-third styles, so copies get their own. */
  takenNames?: readonly string[]
  /** Every library look, for a scene's layer looks. */
  library?: readonly LibraryLook[]
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
  const name = (n: string) => {
    const unique = uniqueName(n, taken)
    taken.push(unique)
    return unique
  }
  switch (look.kind) {
    case "theme":
      return { themes: [copyTheme(look.theme, look.id, name(look.name), newId(), now)] }
    case "lower-third":
      return { themes: [], lowerThirdStyle: { ...structuredClone(look.style), id: newId(), name: name(look.name) } }
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
        const t = copyTheme(source.theme, source.id, name(source.name), newId(), now)
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
      return { themes, scene: { id: newId(), name: name(look.name), background: look.scene.background, layers, createdAt: now, updatedAt: now } }
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
