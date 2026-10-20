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

/** Kinds this version can read and write. Anything else is preserved, not edited. */
export const SUPPORTED_ITEM_KINDS = ["verse"] as const
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
}

export interface ProgramWithItems {
  program: Program
  items: ProgramItem[]
}

/** Error shape returned by every `content_*` command. */
export interface ContentCommandError {
  kind: "unavailable" | "not_found" | "invalid" | "conflict" | "database"
  message: string
  expected?: number
  actual?: number
}

export function isContentCommandError(e: unknown): e is ContentCommandError {
  return typeof e === "object" && e !== null && "kind" in e && "message" in e
}

export interface ContentStatus {
  available: boolean
  path: string | null
  migrations: string[]
}
