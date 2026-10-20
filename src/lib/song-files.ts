import { invoke } from "@tauri-apps/api/core"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs"
import type { ContentStatus, Hymnbook, ImportMode, ImportReport, RestoreReport, SongExport, SongWithSections } from "@/types"
import { parseOpenLyrics, toOpenLyrics } from "@/lib/openlyrics"

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

/** Save the whole library (or `ids`) as `rhema-songs-v1.json`. Null when cancelled. */
export async function exportSongsToFile(ids?: string[]): Promise<string | null> {
  const data = await invoke<SongExport>("content_export_songs", { ids: ids ?? null })
  const path = await save({
    defaultPath: `rhema-songs-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "Rhema songs", extensions: ["json"] }],
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

function isSongExport(x: unknown): x is SongExport {
  return typeof x === "object" && x !== null && (x as SongExport).version === 1 && Array.isArray((x as SongExport).songs)
}

/**
 * Pick one or more files: `rhema-songs-v1.json` (whole library, with `mode`)
 * or OpenLyrics `.xml` (one song each, always added). Nothing is written
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
      } else {
        const { input, report } = parseOpenLyrics(text, bookIds)
        await invoke<SongWithSections>("content_create_song", { input })
        outcome.added += 1
        for (const i of report.ignored) outcome.notes.push(`${name}: ${i} ignored`)
      }
    } catch (e) {
      const message = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : e instanceof Error ? e.message : String(e)
      outcome.notes.push(`${name}: ${message}`)
    }
  }
  return outcome
}

// ── whole database ──────────────────────────────────────────────────────

export const contentStatus = () => invoke<ContentStatus>("content_status")

/** Copy the whole content database (services and songs) to a file the user picks. */
export async function backupDatabaseToFile(): Promise<string | null> {
  const path = await save({
    defaultPath: `rhema-studio-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: "Rhema Studio database", extensions: ["db"] }],
  })
  if (!path) return null
  await invoke("content_backup", { path })
  return path
}

/**
 * Replace the content database with a backup the user picks. The backend
 * verifies the file and keeps the current database as a snapshot first.
 */
export async function restoreDatabaseFromFile(): Promise<RestoreReport | null> {
  const selected = await open({ multiple: false, filters: [{ name: "Rhema Studio database", extensions: ["db", "bak"] }] })
  if (!selected) return null
  const path = Array.isArray(selected) ? selected[0] : selected
  return invoke<RestoreReport>("content_restore", { path })
}
