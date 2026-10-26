/** Mirrors `rhema-content` (src-tauri/crates/content). */

export interface Program {
  id: string
  title: string
  service_date: string | null
  revision: number
  created_at: string
  updated_at: string
  item_count: number
  /** The revision approved for the service, if any (`approve_program`). */
  approved_revision?: number | null
  approved_at?: string | null
  /** Archived: hidden from the picker, kept with its history (migration 0010). */
  archived_at?: string | null
  /** A starting point for new services (9 am, communion, youth), not a service to hold. */
  is_template?: boolean
  /** Operator name on the approving computer (CL-002), if one was set. */
  approved_by?: string | null
}

/** Kinds this build can show in the rundown. Anything else is preserved, not edited. */
export const SUPPORTED_ITEM_KINDS = ["verse", "song", "slide", "image", "audio", "phase", "group", "cue"] as const
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
  /** Why the database could not be opened (for example: written by a newer version). */
  error?: string | null
}

// ── Media (migration 0004) ───────────────────────────────────────────────

export interface MediaAsset {
  id: string
  kind: "image" | "video" | "audio" | "document"
  name: string
  file: string
  hash: string
  size: number
  mime: string
  width: number | null
  height: number | null
  duration_ms: number | null
  source: string
  source_ref: string
  original_path: string
  created_at: string
}

/** An asset plus where its file is and whether it is still there. */
export interface MediaAssetStatus extends MediaAsset {
  path: string
  present: boolean
}

export type MediaImportResult =
  | { status: "imported"; asset: MediaAssetStatus; duplicate: boolean }
  | { status: "failed"; path: string; message: string }

/** `payload` of a `kind = "image"` program item. */
export interface ImageItemPayload {
  media_id: string
  fit?: "cover" | "contain" | "stretch" | null
  loop?: boolean
  sound?: boolean
}

/** `payload` of a `kind = "audio"` program item. Device ids are local to the host computer. */
export interface AudioItemPayload {
  media_id: string
  output_device_id?: string
  volume?: number
  loop?: boolean
  fade_in_ms?: number
  fade_out_ms?: number
}

export interface RevisionSummary {
  id: string
  program_id: string
  revision: number
  title: string
  service_date: string | null
  item_count: number
  created_at: string
  /** Who saved this version (operator name on that computer), when known. */
  saved_by?: string | null
}

export interface Revision extends RevisionSummary {
  items: ItemInput[]
}

/** What a backup file holds, read before restoring it (content_inspect_backup). */
export interface BackupSummary {
  services: number
  songs: number
  newest_service: string | null
  newest_date: string | null
  /** When a service in it was last changed (ISO). */
  last_changed: string | null
  /** Made by a newer Rhema Studio: this one cannot restore it. */
  newer: boolean
  /** The installation's settings and looks kept in it (#298 E6, JSON); null or absent in a services-and-songs backup. */
  installation?: string | null
}

export interface RestoreReport {
  /** The database as it was before (with this computer's settings and looks): restoring it undoes the restore. */
  snapshot: string | null
  migrations: string[]
  /** The backup's settings and looks (JSON), for the app to put in place. */
  installation?: string | null
}

/** A saved service log (migration 0008): the text kept after a service. */
export interface ServiceLogSummary {
  id: string
  program_id: string | null
  title: string
  saved_at: string
  bytes: number
}
export interface ServiceLog extends ServiceLogSummary {
  body: string
}

/** One service with its songs and pictures, as a checksummed file (`rhema-service-v1`). */
export interface ServicePackage {
  version: 1
  payload: string
  sha256: string
}

export interface PackageReport {
  program: ProgramWithItems
  songs_added: number
  songs_skipped: number
  /** Songs already here whose words or orders differ from the file's; this computer's copy was kept. */
  songs_differ?: string[]
  media_added: number
  media_reused: number
}

// ── Songs and hymnbooks (migration 0003) ─────────────────────────────────

export const SECTION_KINDS = ["verse", "chorus", "bridge", "prechorus", "tag", "ending", "intro", "other"] as const
export type SectionKind = (typeof SECTION_KINDS)[number]
export const LICENCES = ["public_domain", "ccli", "custom", "unknown"] as const
export type Licence = (typeof LICENCES)[number]

export interface Song {
  id: string
  title: string
  /** Other names the song is known by (a hymn's Yorùbá title); searched with the title. */
  alternate_titles?: string[]
  authors: string
  copyright: string
  ccli_number: string | null
  licence: Licence
  licence_note: string
  primary_language: string
  tags: string
  notes: string
  /** Musical key for the band ("G", "F#m"); shown on the stage display only. */
  key: string
  /** Beats per minute, for the band. */
  tempo: number | null
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
  alternate_titles?: string[]
  /** Comma-separated; "choir" marks a choir ministration. */
  tags?: string
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
  alternate_titles?: string[]
  authors?: string
  copyright?: string
  ccli_number?: string | null
  licence?: Licence
  licence_note?: string
  primary_language?: string
  tags?: string
  notes?: string
  key?: string
  tempo?: number | null
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
  /** Hymn numbers left off because another song here already has them. */
  numbers_skipped?: number
}

/** `payload` of a `kind = "slide"` program item. */
export interface SlideItemPayload {
  title: string
  body: string
  link?: string
}

/** `payload` of a `kind = "song"` program item. */
export interface SongItemPayload {
  song_id: string
  /** Saved identity and number snapshot; absent on legacy services. */
  hymn?: boolean
  hymn_numbers?: string[]
  arrangement_id?: string | null
  languages?: string[]
  /** A title slide before the words (#193). */
  title_slide?: boolean
}
