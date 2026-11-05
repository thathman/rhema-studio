import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs"
import type { BackupSummary, ContentStatus, Hymnbook, ImportMode, ImportReport, PackageReport, RestoreReport, ServicePackage, SongExport, SongSummary, SongWithSections } from "@/types"
import { CAC_TAG } from "@/lib/cac-hymnbook"
import { parseOpenLyrics, toOpenLyrics } from "@/lib/openlyrics"
import { songToMarkdown } from "@/lib/lyrics"
import { useSettingsStore } from "@/stores/settings-store"
import { installationForBackup } from "@/lib/installation-export"
import { fold } from "@/lib/fuzzy"
import type { SongInput } from "@/types"

export interface ImportOutcome {
  /** Files that were read. */
  files: number
  added: number
  replaced: number
  skipped: number
  hymnbooks_added: number
  /** Per-file problems and things an OpenLyrics file had that were not kept. */
  notes: string[]
}

/** Save the whole song library (or `ids`) as `rhema-songs-v1.json`; the CAC hymn book stays out. Null when cancelled. */
export async function exportSongsToFile(ids?: string[]): Promise<string | null> {
  const library = ids ?? (await invoke<SongSummary[]>("content_list_songs", { query: null, limit: 5000, tag: CAC_TAG, withTag: false })).map((s) => s.id)
  const data = await invoke<SongExport>("content_export_songs", { ids: library })
  const path = await save({
    defaultPath: `rhema-songs-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "Rhema Studio songs", extensions: ["json"] }],
  })
  if (!path) return null
  await writeTextFile(path, JSON.stringify(data, null, 2))
  return path
}

/** Save one song as an OpenLyrics .xml (for OpenLP and others). Null when cancelled. */
export async function exportOpenLyricsToFile(song: SongWithSections): Promise<string | null> {
  const path = await save({
    defaultPath: `${song.song.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "song"}.xml`,
    filters: [{ name: "OpenLyrics", extensions: ["xml"] }],
  })
  if (!path) return null
  await writeTextFile(path, toOpenLyrics(song))
  return path
}

/** Save one song as Markdown / plain text (reads fine in any editor; pastes back into Rhema). Null when cancelled. */
export async function exportSongTextToFile(song: SongWithSections, language?: string): Promise<string | null> {
  const path = await save({
    defaultPath: `${song.song.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "song"}.md`,
    filters: [{ name: "Text (Markdown)", extensions: ["md", "txt"] }],
  })
  if (!path) return null
  await writeTextFile(path, songToMarkdown(song, language))
  return path
}

function isSongExport(x: unknown): x is SongExport {
  return typeof x === "object" && x !== null && (x as SongExport).version === 1 && Array.isArray((x as SongExport).songs)
}

/** First non-empty line of a song's first section, folded (for matching an import to the library). */
function firstLineOf(input: SongInput): string {
  const texts = input.sections?.[0]?.texts ?? {}
  const text = (input.primary_language && texts[input.primary_language]) || Object.values(texts)[0] || ""
  return fold(text.split("\n").map((l) => l.trim()).find(Boolean) ?? "")
}

/**
 * The library song an OpenLyrics file is (#411): the same title, and the same first line or one of
 * the same hymn numbers ("SSS 245"). Accents and case do not matter. Null when it is new.
 */
export function existingSongFor(input: SongInput, library: SongSummary[], codeOf: (hymnbookId: string) => string | undefined): SongSummary | null {
  const title = fold(input.title.trim())
  const line = firstLineOf(input)
  const numbers = new Set((input.numbers ?? []).map((n) => `${codeOf(n.hymnbook_id) ?? ""} ${n.number}`.trim().toLowerCase()))
  return library.find((s) => fold(s.title.trim()) === title && ((!!line && fold(s.first_line.trim()) === line) || s.numbers.some((n) => numbers.has(n.toLowerCase())))) ?? null
}

/**
 * Pick one or more files: `rhema-songs-v1.json` (whole library, with `mode`)
 * or OpenLyrics `.xml` (one song each, matched to the library: a song already here is kept, in any mode
 * but Duplicate, which adds it again). Nothing is written
 * until a file parses; a JSON import is one transaction in the database.
 */
export async function importSongsFromFiles(mode: ImportMode, hymnbooks: Hymnbook[]): Promise<ImportOutcome | null> {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Songs", extensions: ["json", "xml"] }],
  })
  if (!selected) return null
  const paths = Array.isArray(selected) ? selected : [selected]
  const outcome: ImportOutcome = { files: 0, added: 0, replaced: 0, skipped: 0, hymnbooks_added: 0, notes: [] }
  const bookIds: Record<string, string> = {}
  const codeOf = (id: string) => hymnbooks.find((b) => b.id === id)?.code
  // The library as it is, to tell a song already here from a new one (#411); kept current as files import.
  let library: SongSummary[] | null = null
  let keptForReplace = 0
  for (const b of hymnbooks) {
    bookIds[b.code] = b.id
    bookIds[b.code.toUpperCase()] = b.id
    bookIds[b.name] = b.id
  }
  for (const path of paths) {
    const name = path.split(/[\\/]/).pop() ?? path
    let text: string
    try {
      text = new TextDecoder().decode(await readFile(path))
    } catch (e) {
      outcome.notes.push(`${name}: could not read (${e instanceof Error ? e.message : String(e)})`)
      continue
    }
    outcome.files += 1
    try {
      if (text.trimStart().startsWith("{")) {
        const parsed: unknown = JSON.parse(text)
        if (!isSongExport(parsed)) throw new Error("not a rhema-songs-v1 file")
        const r = await invoke<ImportReport>("content_import_songs", { export: parsed, mode })
        outcome.added += r.added
        outcome.replaced += r.replaced
        outcome.skipped += r.skipped
        outcome.hymnbooks_added += r.hymnbooks_added
        if (r.numbers_skipped) outcome.notes.push(`${name}: ${r.numbers_skipped} hymn number${r.numbers_skipped === 1 ? " was" : "s were"} left off (another song here already has ${r.numbers_skipped === 1 ? "it" : "them"})`)
      } else {
        const { input, report } = parseOpenLyrics(text, bookIds)
        library ??= (await invoke<SongSummary[] | null>("content_list_songs", { limit: 5000 })) ?? []
        const existing: SongSummary | null = mode === "duplicate" ? null : existingSongFor(input, library, codeOf)
        // A song already here is kept, in Replace too: an OpenLyrics file lacks its tags (the CAC
        // hymn book's), notes, other books' numbers and the arrangement ids services choose, so
        // writing it over the song would lose them. Edit the song in the Library instead.
        if (existing) {
          outcome.skipped += 1
          if (mode === "replace") keptForReplace += 1
        } else {
          const saved = await invoke<SongWithSections>("content_create_song", { input })
          // The file just added is matched by the next one too (two copies in one folder).
          library.push({ id: saved.song.id, title: input.title, numbers: (input.numbers ?? []).map((n) => `${codeOf(n.hymnbook_id) ?? ""} ${n.number}`.trim()), first_line: Object.values(input.sections?.[0]?.texts ?? {})[0]?.split("\n")[0] ?? "", revision: saved.song.revision } as unknown as SongSummary)
          outcome.added += 1
        }
        for (const i of report.ignored) outcome.notes.push(`${name}: ${i} ignored`)
      }
    } catch (e) {
      const message = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : e instanceof Error ? e.message : String(e)
      outcome.notes.push(`${name}: ${message}`)
    }
  }
  if (keptForReplace) outcome.notes.push(`${keptForReplace} OpenLyrics song${keptForReplace === 1 ? " is" : "s are"} already here and ${keptForReplace === 1 ? "was" : "were"} kept as ${keptForReplace === 1 ? "it is" : "they are"}: a file does not replace a song (it lacks its tags, notes and arrangements). Edit it in the Library.`)
  return outcome
}

// ── one service as a package ─────────────────────────────────────────────

/** Save a saved service with its songs and pictures as one file. Null when cancelled. */
export async function exportServicePackageToFile(programId: string, title: string): Promise<string | null> {
  const pkg = await invoke<ServicePackage>("content_export_service_package", { programId })
  const path = await save({
    defaultPath: `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "service"}.rhema-service.json`,
    filters: [{ name: "Rhema Studio service package", extensions: ["json"] }],
  })
  if (!path) return null
  await writeTextFile(path, JSON.stringify(pkg))
  return path
}

function isServicePackage(x: unknown): x is ServicePackage {
  const p = x as ServicePackage
  // Any version: the backend says which it reads (1, and 2 for a service with phases).
  return typeof x === "object" && x !== null && Number.isInteger(p.version) && p.version >= 1 && typeof p.payload === "string" && typeof p.sha256 === "string"
}

/** Open a package as a new service. The backend checks the checksum before writing anything. Null when cancelled. */
export async function importServicePackageFromFile(): Promise<PackageReport | null> {
  const selected = await open({ multiple: false, filters: [{ name: "Rhema Studio service package", extensions: ["json"] }] })
  if (!selected) return null
  const path = Array.isArray(selected) ? selected[0] : selected
  const parsed: unknown = JSON.parse(new TextDecoder().decode(await readFile(path)))
  if (!isServicePackage(parsed)) throw new Error("This is not a Rhema Studio service package.")
  return invoke<PackageReport>("content_import_service_package", { package: parsed })
}

// ── whole database ──────────────────────────────────────────────────────

export const contentStatus = () => invoke<ContentStatus>("content_status")

/**
 * Copy the whole content database (services and songs) to a file the user picks, with this
 * computer's settings and looks inside it (#298 E6; no saved keys or passwords).
 */
export async function backupDatabaseToFile(): Promise<string | null> {
  const path = await save({
    defaultPath: `rhema-studio-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: "Rhema Studio database", extensions: ["db"] }],
  })
  if (!path) return null
  await invoke("content_backup", { path, installation: JSON.stringify(await installationForBackup()) })
  // The setup's Finish step shows when the last backup was made.
  useSettingsStore.getState().setSetup({ lastBackupAt: new Date().toISOString() })
  return path
}

/**
 * Replace the content database with a backup the user picks. The backend
 * verifies the file and keeps the current database as a snapshot first.
 */
export async function restoreDatabaseFromFile(): Promise<RestoreReport | null> {
  const path = await pickBackupFile()
  return path ? restoreDatabaseFrom(path) : null
}

/** Ask for a backup file; null when cancelled. */
export async function pickBackupFile(): Promise<string | null> {
  const selected = await open({ multiple: false, filters: [{ name: "Rhema Studio database", extensions: ["db", "bak"] }] })
  if (!selected) return null
  return Array.isArray(selected) ? (selected[0] ?? null) : selected
}

/** What a backup holds (services, songs, the newest service), without changing anything. */
export const inspectBackup = (path: string) => invoke<BackupSummary>("content_inspect_backup", { path })

/**
 * Restore this backup file's services and songs (checked and snapshotted by the backend, as
 * above). This computer's settings and looks go into the snapshot with them, so restoring the
 * snapshot undoes it; the backup's own settings and looks come back in the report for the caller.
 */
export const restoreDatabaseFrom = async (path: string) => invoke<RestoreReport>("content_restore", { path, current: JSON.stringify(await installationForBackup()) })
