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

export type ProgramItemKind = "verse"

export interface ProgramItem {
  id: string
  program_id: string
  position: number
  kind: ProgramItemKind | string
  reference: string
  book_number: number | null
  chapter: number | null
  verse: number | null
  notes: string | null
}

export interface NewProgramItem {
  kind: ProgramItemKind | string
  reference: string
  book_number: number | null
  chapter: number | null
  verse: number | null
  notes: string | null
}

export interface ProgramWithItems {
  program: Program
  items: ProgramItem[]
}
