import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs"
import type { ReusableSlide, ReusableSlideInput, SongSummary } from "@/types"
import { collectionsApi, type CollectionItemKind, type CollectionSummary } from "@/studio/library/collections"

/**
 * Library file (#853 G9): reusable slides and announcements, and the church's collections, in one
 * JSON file. Songs and hymn books keep their own file (song-files). Pictures, videos and sounds are
 * files on this computer, so a collection names them and they are matched by name on import; they
 * travel with a backup or the church folder.
 */
export const LIBRARY_FILE_FORMAT = "rhema-studio-library"

export interface LibraryFileSlide {
  kind: "slide" | "announcement"
  title: string
  body: string
  link: string | null
}

export interface LibraryFileCollectionItem {
  kind: CollectionItemKind
  /** How the item is found again on another computer. */
  title: string
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

const slideKey = (s: Pick<LibraryFileSlide, "kind" | "title" | "body" | "link">) =>
  JSON.stringify([s.kind, s.title.trim(), s.body.trim(), s.link ?? null])

export function buildLibraryFile(
  slides: ReusableSlide[],
  collections: Array<{ name: string; items: Array<{ kind: CollectionItemKind; title: string | null }> }>,
  now = new Date(),
): LibraryFile {
  return {
    format: LIBRARY_FILE_FORMAT,
    version: 1,
    exported_at: now.toISOString(),
    slides: slides.map(({ kind, title, body, link }) => ({ kind, title, body, link })),
    collections: collections.map((c) => ({
      name: c.name,
      // A missing item has nothing to find it by; it is left out.
      items: c.items.filter((i): i is { kind: CollectionItemKind; title: string } => !!i.title).map(({ kind, title }) => ({ kind, title })),
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
  ).map((s) => ({ ...s, link: s.link ?? null }))
  const collections = v.collections.filter((c): c is LibraryFile["collections"][number] =>
    typeof c === "object" && c !== null && typeof c.name === "string" && c.name.trim() !== "" && Array.isArray(c.items),
  ).map((c) => ({
    name: c.name.trim(),
    items: c.items.filter((i) => typeof i === "object" && i !== null && KINDS.includes(i.kind) && typeof i.title === "string" && i.title.trim() !== ""),
  }))
  return { format: LIBRARY_FILE_FORMAT, version: 1, exported_at: typeof v.exported_at === "string" ? v.exported_at : "", slides, collections }
}

/** The slides in `file` that this library does not have yet (same kind, title, words and link). */
export function newSlides(file: LibraryFile, existing: ReusableSlide[]): LibraryFileSlide[] {
  const have = new Set(existing.map(slideKey))
  const out: LibraryFileSlide[] = []
  for (const s of file.slides) {
    const key = slideKey(s)
    if (have.has(key)) continue
    have.add(key)
    out.push(s)
  }
  return out
}

export interface LibraryIndex {
  song: Array<{ id: string; title: string }>
  slide: Array<{ id: string; title: string }>
  media: Array<{ id: string; title: string }>
  design: Array<{ id: string; title: string }>
}

/** Find a collection item again by its title (case and spacing ignored); null when this library has none. */
export function matchCollectionItem(item: LibraryFileCollectionItem, index: LibraryIndex): string | null {
  const want = item.title.trim().toLowerCase().replace(/\s+/g, " ")
  return index[item.kind].find((candidate) => candidate.title.trim().toLowerCase().replace(/\s+/g, " ") === want)?.id ?? null
}

const slideTitle = (s: Pick<ReusableSlide, "title" | "body">) => s.title.trim() || s.body.slice(0, 80)

async function libraryIndex(): Promise<LibraryIndex> {
  const [songs, slides, media, designs] = await Promise.all([
    invoke<SongSummary[]>("content_list_songs", { query: null, limit: 5000 }).catch(() => [] as SongSummary[]),
    invoke<ReusableSlide[]>("content_list_reusable_slides", { query: null, limit: 5000 }).catch(() => [] as ReusableSlide[]),
    invoke<Array<{ id: string; name: string }>>("media_list").catch(() => [] as Array<{ id: string; name: string }>),
    invoke<Array<{ id: string; title: string }>>("design_list", {}).catch(() => [] as Array<{ id: string; title: string }>),
  ])
  return {
    song: songs.map((s) => ({ id: s.id, title: s.title })),
    slide: slides.map((s) => ({ id: s.id, title: slideTitle(s) })),
    media: media.map((m) => ({ id: m.id, title: m.name })),
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
  const path = await save({
    defaultPath: `rhema-library-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "Rhema Studio library", extensions: ["json"] }],
  })
  if (!path) return null
  await writeTextFile(path, JSON.stringify(buildLibraryFile(slides, collections), null, 2))
  return path
}

/** Import a library file: new slides are added, collections are added and their items found by title. */
export async function importLibraryFromFile(): Promise<LibraryImportOutcome | null> {
  const picked = await open({ multiple: false, filters: [{ name: "Rhema Studio library", extensions: ["json"] }] })
  const path = Array.isArray(picked) ? picked[0] : picked
  if (!path) return null
  const file = parseLibraryFile(new TextDecoder().decode(await readFile(path)))
  const outcome: LibraryImportOutcome = { slidesAdded: 0, slidesSkipped: 0, collectionsAdded: 0, itemsLinked: 0, notes: [] }
  const existing = await invoke<ReusableSlide[]>("content_list_reusable_slides", { query: null, limit: 5000 })
  const toAdd = newSlides(file, existing)
  outcome.slidesSkipped = file.slides.length - toAdd.length
  for (const s of toAdd) {
    const input: ReusableSlideInput = { kind: s.kind, title: s.title, body: s.body, link: s.link, background_media_id: null }
    try {
      await invoke<ReusableSlide>("content_create_reusable_slide", { input })
      outcome.slidesAdded += 1
    } catch (e) {
      outcome.notes.push(`Slide “${s.title || s.body.slice(0, 40)}” was not added: ${e instanceof Error ? e.message : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e)}`)
    }
  }
  if (file.collections.length === 0) return outcome
  const index = await libraryIndex()
  const have = new Map((await collectionsApi.list()).map((c: CollectionSummary) => [c.name.toLowerCase(), c]))
  for (const c of file.collections) {
    let target = have.get(c.name.toLowerCase())
    if (!target) {
      target = await collectionsApi.create(c.name)
      have.set(c.name.toLowerCase(), target)
      outcome.collectionsAdded += 1
    }
    for (const item of c.items) {
      const id = matchCollectionItem(item, index)
      if (!id) {
        outcome.notes.push(`“${item.title}” (${item.kind}) in ${c.name} is not in this library.`)
        continue
      }
      await collectionsApi.add(target.id, item.kind, id)
      outcome.itemsLinked += 1
    }
  }
  return outcome
}
