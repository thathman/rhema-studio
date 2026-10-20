/** Mirrors `rhema-content` (src-tauri/crates/content). */

export interface Program {
  id: string
  title: string
  service_date: string | null
  revision: number
  created_at: string
  updated_at: string
  item_count: number
}

/** Kinds this build can show in the rundown. Anything else is preserved, not edited. */
export const SUPPORTED_ITEM_KINDS = ["verse", "song", "slide"] as const
export type ProgramItemKind = (typeof SUPPORTED_ITEM_KINDS)[number]

export interface ProgramItem {
  id: string
  program_id: string
  position: number
  /** Stored kind; may be a kind this build does not know. */
  kind: string
  reference: string
  book_number: number | null
  chapter: number | null
  verse: number | null
  /** Translation abbreviation (e.g. "KJV"); null = follow the active translation. */
  translation: string | null
  secondary_translation: string | null
  notes: string | null
  /** Kind-specific JSON (song items: `SongItemPayload`). null for verses. */
  payload: string | null
}

/** What the frontend sends on save. `id` keeps an existing item's identity. */
export interface ItemInput {
  id?: string
  kind: ProgramItemKind
  reference: string
  book_number: number | null
  chapter: number | null
  verse: number | null
  translation: string | null
  secondary_translation: string | null
  notes: string | null
  payload?: string | null
}

export interface ProgramWithItems {
  program: Program
  items: ProgramItem[]
}

/** Error shape returned by every `content_*` command. */
export interface ContentCommandError {
  kind: "unavailable" | "not_found" | "invalid" | "conflict" | "in_use" | "database"
  message: string
  expected?: number
  actual?: number
  /** `in_use`: titles of the services that still use the song. */
  titles?: string[]
}

export function isContentCommandError(e: unknown): e is ContentCommandError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e
}

export interface ContentStatus {
  available: boolean
  path: string | null
  migrations: string[]
  /** Automatic copy made before the last migration, if any. */
  last_backup: string | null
}

export interface RestoreReport {
  snapshot: string | null
  migrations: string[]
}

// ── Songs and hymnbooks (migration 0003) ─────────────────────────────────

export const SECTION_KINDS = ["verse", "chorus", "bridge", "prechorus", "tag", "ending", "intro", "other"] as const
export type SectionKind = (typeof SECTION_KINDS)[number]
export const LICENCES = ["public_domain", "ccli", "custom", "unknown"] as const
export type Licence = (typeof LICENCES)[number]

export interface Song {
  id: string
  title: string
  authors: string
  copyright: string
  ccli_number: string | null
  licence: Licence
  licence_note: string
  primary_language: string
  tags: string
  notes: string
  revision: number
  created_at: string
  updated_at: string
}

export interface SongSection {
  id: string
  kind: SectionKind
  label: string
  /** language tag → lyrics; blank line = slide split hint */
  texts: Record<string, string>
}

export interface Arrangement {
  id: string
  name: string
  /** Section ids; repeats allowed. */
  sequence: string[]
  is_default: boolean
}

export interface HymnNumber {
  hymnbook_id: string
  hymnbook_code: string
  number: string
}

export interface SongWithSections {
  song: Song
  sections: SongSection[]
  arrangements: Arrangement[]
  numbers: HymnNumber[]
}

export interface SongSummary {
  id: string
  title: string
  authors: string
  licence: Licence
  primary_language: string
  languages: string[]
  /** "SSS 245" */
  numbers: string[]
  first_line: string
  revision: number
  updated_at: string
}

export interface Hymnbook {
  id: string
  code: string
  name: string
  language: string
  publisher: string
  licence_note: string
}

export interface SectionInput {
  id?: string
  kind: SectionKind
  label?: string
  texts: Record<string, string>
}

export interface ArrangementInput {
  id?: string
  name: string
  sequence: string[]
  is_default?: boolean
}

export interface HymnNumberInput {
  hymnbook_id: string
  number: string
}

export interface SongInput {
  title: string
  authors?: string
  copyright?: string
  ccli_number?: string | null
  licence?: Licence
  licence_note?: string
  primary_language?: string
  tags?: string
  notes?: string
  sections: SectionInput[]
  /** Empty = a generated "Default" arrangement. */
  arrangements?: ArrangementInput[]
  numbers?: HymnNumberInput[]
}

export interface HymnbookInput {
  id?: string
  code: string
  name: string
  language?: string
  publisher?: string
  licence_note?: string
}

export interface SongExport {
  version: 1
  hymnbooks: Hymnbook[]
  songs: SongWithSections[]
}

export type ImportMode = "skip" | "replace" | "duplicate"

export interface ImportReport {
  added: number
  replaced: number
  skipped: number
  hymnbooks_added: number
}

/** `payload` of a `kind = "slide"` program item. */
export interface SlideItemPayload {
  title: string
  body: string
}

/** `payload` of a `kind = "song"` program item. */
export interface SongItemPayload {
  song_id: string
  arrangement_id?: string | null
  languages?: string[]
}
