import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs"
import type { ReusableSlide, ReusableSlideInput, SongSummary } from "@/types"
import { collectionsApi, type CollectionItemKind, type CollectionSummary } from "@/studio/library/collections"
import { describeError } from "@/studio/library/content-actions"

/**
 * Library file (#853 G9): reusable slides and announcements, and the church's collections, in one
 * JSON file. Songs and hymn books keep their own file (song-files). Pictures, videos and sounds are
 * files on this computer: a slide background or a collection item names them (id and name), and on
 * import they are found by id, else by name; the files travel with a backup or the church folder.
 */
export const LIBRARY_FILE_FORMAT = "rhema-studio-library"

export interface LibraryFileSlide {
  kind: "slide" | "announcement"
  title: string
  body: string
  link: string | null
  /** The background picture or video: its id here, and its name to find it on another computer. */
  background?: { id: string; name: string } | null
}

export interface LibraryFileCollectionItem {
  kind: CollectionItemKind
  /** The item's id on the computer that exported it; used first when the same library is here. */
  id?: string
  /** How the item is found again on another computer. */
  title: string
  /** hymn/song, slide/announcement, image/video/audio: narrows a title match. */
  detail?: string | null
}

export interface LibraryFile {
  format: typeof LIBRARY_FILE_FORMAT
  version: 1
  exported_at: string
  slides: LibraryFileSlide[]
  collections: Array<{ name: string; items: LibraryFileCollectionItem[] }>
}

export interface LibraryImportOutcome {
  slidesAdded: number
  slidesSkipped: number
  collectionsAdded: number
  itemsLinked: number
  notes: string[]
}

type MediaRef = { id: string; name: string }

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

/** Same kind, title, words, link and background (by name, so it compares across computers). */
const slideKey = (s: Pick<LibraryFileSlide, "kind" | "title" | "body" | "link">, backgroundName: string | null) =>
  JSON.stringify([s.kind, s.title.trim(), s.body.trim(), s.link ?? null, backgroundName ? fold(backgroundName) : null])

export function buildLibraryFile(
  slides: ReusableSlide[],
  collections: Array<{ name: string; items: Array<{ kind: CollectionItemKind; item_id?: string; title: string | null; detail?: string | null }> }>,
  media: MediaRef[] = [],
  now = new Date(),
): LibraryFile {
  const mediaName = new Map(media.map((m) => [m.id, m.name]))
  return {
    format: LIBRARY_FILE_FORMAT,
    version: 1,
    exported_at: now.toISOString(),
    slides: slides.map(({ kind, title, body, link, background_media_id }) => ({
      kind, title, body, link,
      background: background_media_id ? { id: background_media_id, name: mediaName.get(background_media_id) ?? "" } : null,
    })),
    collections: collections.map((c) => ({
      name: c.name,
      // A missing item has nothing to find it by; it is left out.
      items: c.items
        .filter((i): i is typeof i & { title: string } => !!i.title)
        .map(({ kind, item_id, title, detail }) => ({ kind, ...(item_id ? { id: item_id } : {}), title, ...(detail ? { detail } : {}) })),
    })),
  }
}

const KINDS: CollectionItemKind[] = ["song", "slide", "media", "design"]

/** Read a library file; anything not in this shape is refused before a change is made. */
export function parseLibraryFile(text: string): LibraryFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error("This is not a Rhema Studio library file (it is not JSON).")
  }
  const v = value as Partial<LibraryFile>
  if (typeof value !== "object" || value === null || v.format !== LIBRARY_FILE_FORMAT || v.version !== 1) {
    throw new Error("This is not a Rhema Studio library file. Songs files are imported under Songs.")
  }
  if (!Array.isArray(v.slides) || !Array.isArray(v.collections)) throw new Error("The library file is incomplete.")
  const slides = v.slides.filter((s): s is LibraryFileSlide =>
    typeof s === "object" && s !== null &&
    (s.kind === "slide" || s.kind === "announcement") &&
    typeof s.title === "string" && typeof s.body === "string" &&
    (s.link === null || s.link === undefined || typeof s.link === "string"),
  ).map((s) => ({
    kind: s.kind, title: s.title, body: s.body, link: s.link ?? null,
    background: s.background && typeof s.background === "object" && typeof s.background.id === "string" && typeof s.background.name === "string"
      ? { id: s.background.id, name: s.background.name }
      : null,
  }))
  const collections = v.collections.filter((c): c is LibraryFile["collections"][number] =>
    typeof c === "object" && c !== null && typeof c.name === "string" && c.name.trim() !== "" && Array.isArray(c.items),
  ).map((c) => ({
    name: c.name.trim(),
    items: c.items
      .filter((i) => typeof i === "object" && i !== null && KINDS.includes(i.kind) && typeof i.title === "string" && i.title.trim() !== "")
      .map((i) => ({
        kind: i.kind,
        ...(typeof i.id === "string" && i.id ? { id: i.id } : {}),
        title: i.title,
        ...(typeof i.detail === "string" && i.detail ? { detail: i.detail } : {}),
      })),
  }))
  return { format: LIBRARY_FILE_FORMAT, version: 1, exported_at: typeof v.exported_at === "string" ? v.exported_at : "", slides, collections }
}

/** The background a slide gets here: the same id when this library has it, else the one file with that name. */
export function resolveBackground(background: LibraryFileSlide["background"], media: MediaRef[]): { id: string | null; note: string | null } {
  if (!background) return { id: null, note: null }
  if (media.some((m) => m.id === background.id)) return { id: background.id, note: null }
  const byName = media.filter((m) => background.name && fold(m.name) === fold(background.name))
  if (byName.length === 1) return { id: byName[0].id, note: null }
  return {
    id: null,
    note: byName.length > 1
      ? `More than one picture or video here is called “${background.name}”, so the slide was added without its background.`
      : `The background “${background.name || background.id}” is not on this computer, so the slide was added without it.`,
  }
}

/** The slides in `file` that this library does not have yet (same kind, title, words, link and background). */
export function newSlides(file: LibraryFile, existing: ReusableSlide[], media: MediaRef[] = []): LibraryFileSlide[] {
  const mediaName = new Map(media.map((m) => [m.id, m.name]))
  const have = new Set(existing.map((s) => slideKey(s, s.background_media_id ? mediaName.get(s.background_media_id) ?? s.background_media_id : null)))
  const out: LibraryFileSlide[] = []
  for (const s of file.slides) {
    const key = slideKey(s, s.background ? s.background.name || s.background.id : null)
    if (have.has(key)) continue
    have.add(key)
    out.push(s)
  }
  return out
}

export interface LibraryIndexEntry { id: string; title: string; detail?: string | null }

export interface LibraryIndex {
  song: LibraryIndexEntry[]
  slide: LibraryIndexEntry[]
  media: LibraryIndexEntry[]
  design: LibraryIndexEntry[]
}

/**
 * Find a collection item again: by its id when this is the same library, else by title (case and
 * spacing ignored) narrowed by its detail (hymn or song, slide or announcement, picture, video or
 * sound). Two or more equal matches are ambiguous: nothing is linked and the note says why.
 */
export function matchCollectionItem(item: LibraryFileCollectionItem, index: LibraryIndex): { id: string | null; note: string | null } {
  const candidates = index[item.kind]
  if (item.id && candidates.some((c) => c.id === item.id)) return { id: item.id, note: null }
  const want = fold(item.title)
  let matches = candidates.filter((c) => fold(c.title) === want)
  if (matches.length > 1 && item.detail) {
    const narrowed = matches.filter((c) => c.detail === item.detail)
    if (narrowed.length > 0) matches = narrowed
  }
  if (matches.length === 1) return { id: matches[0].id, note: null }
  if (matches.length === 0) return { id: null, note: null }
  return { id: null, note: `${matches.length} items here match “${item.title}” (${item.kind}); add the right one to the collection yourself.` }
}

const slideTitle = (s: Pick<ReusableSlide, "title" | "body">) => s.title.trim() || s.body.slice(0, 80)

async function listMedia(): Promise<MediaRef[]> {
  return invoke<Array<{ id: string; name: string; kind?: string }>>("media_list").catch(() => [])
}

async function libraryIndex(): Promise<LibraryIndex> {
  const [songs, slides, media, designs] = await Promise.all([
    invoke<SongSummary[]>("content_list_songs", { query: null, limit: 5000 }).catch(() => [] as SongSummary[]),
    invoke<ReusableSlide[]>("content_list_reusable_slides", { query: null, limit: 5000 }).catch(() => [] as ReusableSlide[]),
    invoke<Array<{ id: string; name: string; kind?: string }>>("media_list").catch(() => [] as Array<{ id: string; name: string; kind?: string }>),
    invoke<Array<{ id: string; title: string }>>("design_list", {}).catch(() => [] as Array<{ id: string; title: string }>),
  ])
  return {
    song: songs.map((s) => ({ id: s.id, title: s.title, detail: s.numbers.length > 0 ? "hymn" : "song" })),
    slide: slides.map((s) => ({ id: s.id, title: slideTitle(s), detail: s.kind })),
    media: media.map((m) => ({ id: m.id, title: m.name, detail: m.kind ?? null })),
    design: designs.map((d) => ({ id: d.id, title: d.title })),
  }
}

/** Save the reusable slides and every collection to a file. Null when cancelled. */
export async function exportLibraryToFile(): Promise<string | null> {
  const slides = await invoke<ReusableSlide[]>("content_list_reusable_slides", { query: null, limit: 5000 })
  const summaries = await collectionsApi.list()
  const collections = []
  for (const summary of summaries) {
    const full = await collectionsApi.get(summary.id)
    if (full) collections.push({ name: summary.name, items: full.items })
  }
  const media = await listMedia()
  const path = await save({
    defaultPath: `rhema-library-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "Rhema Studio library", extensions: ["json"] }],
  })
  if (!path) return null
  await writeTextFile(path, JSON.stringify(buildLibraryFile(slides, collections, media), null, 2))
  return path
}

/**
 * Put a read library file into this library. Each slide, collection and item that fails is noted
 * and the rest carry on, so the outcome always says what was written.
 */
export async function applyLibraryFile(file: LibraryFile): Promise<LibraryImportOutcome> {
  const outcome: LibraryImportOutcome = { slidesAdded: 0, slidesSkipped: 0, collectionsAdded: 0, itemsLinked: 0, notes: [] }
  const existing = await invoke<ReusableSlide[]>("content_list_reusable_slides", { query: null, limit: 5000 })
  const media = await listMedia()
  const toAdd = newSlides(file, existing, media)
  outcome.slidesSkipped = file.slides.length - toAdd.length
  for (const s of toAdd) {
    const background = resolveBackground(s.background, media)
    const input: ReusableSlideInput = { kind: s.kind, title: s.title, body: s.body, link: s.link, background_media_id: background.id }
    try {
      await invoke<ReusableSlide>("content_create_reusable_slide", { input })
      outcome.slidesAdded += 1
      if (background.note) outcome.notes.push(`Slide “${s.title || s.body.slice(0, 40)}”: ${background.note}`)
    } catch (e) {
      outcome.notes.push(`Slide “${s.title || s.body.slice(0, 40)}” was not added: ${describeError(e)}`)
    }
  }
  if (file.collections.length === 0) return outcome
  const index = await libraryIndex()
  let have: Map<string, CollectionSummary>
  try {
    have = new Map((await collectionsApi.list()).map((c) => [c.name.toLowerCase(), c]))
  } catch (e) {
    outcome.notes.push(`Collections were not imported: ${describeError(e)}`)
    return outcome
  }
  for (const c of file.collections) {
    let target = have.get(c.name.toLowerCase())
    if (!target) {
      try {
        target = await collectionsApi.create(c.name)
      } catch (e) {
        outcome.notes.push(`Collection “${c.name}” was not added: ${describeError(e)}`)
        continue
      }
      have.set(c.name.toLowerCase(), target)
      outcome.collectionsAdded += 1
    }
    for (const item of c.items) {
      const match = matchCollectionItem(item, index)
      if (!match.id) {
        outcome.notes.push(match.note ? `${c.name}: ${match.note}` : `“${item.title}” (${item.kind}) in ${c.name} is not in this library.`)
        continue
      }
      try {
        await collectionsApi.add(target.id, item.kind, match.id)
        outcome.itemsLinked += 1
      } catch (e) {
        outcome.notes.push(`“${item.title}” was not placed in ${c.name}: ${describeError(e)}`)
      }
    }
  }
  return outcome
}

/** Pick a library file and import it. Null when cancelled. */
export async function importLibraryFromFile(): Promise<LibraryImportOutcome | null> {
  const picked = await open({ multiple: false, filters: [{ name: "Rhema Studio library", extensions: ["json"] }] })
  const path = Array.isArray(picked) ? picked[0] : picked
  if (!path) return null
  return applyLibraryFile(parseLibraryFile(new TextDecoder().decode(await readFile(path))))
}
