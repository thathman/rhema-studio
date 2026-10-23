import type { OutlineHeader, PhaseRole, PhaseRule } from "@/lib/run-of-show"
import type { QueueItem } from "@/types"

/**
 * A service an AI assistant proposed through Rhema MCP (#252), as saved for review: phases of
 * items already matched to the library and the installed Bible, or marked missing. Opening one
 * makes an unsaved rundown in Prepare; nothing is saved or approved until a person does it.
 */
export interface AiDraftItem {
  kind: "song" | "verse" | "slide" | "missing"
  status: "found" | "missing"
  planned_minutes?: number | null
  notes?: string | null
  /** The assistant's suggestions for how it looks (shown in review; never stored in the service). */
  suggested_look?: string | null
  suggested_scene?: string | null
  song?: { id: string; title: string; primary_language: string; languages: string[]; hymn?: boolean }
  reference?: string
  translation?: string
  book_number?: number
  book_name?: string
  chapter?: number
  verse?: number
  verses?: number
  title?: string
  text?: string
  wanted?: string
}

export interface AiDraft {
  v: 1
  id: string
  title: string
  date?: string | null
  created_at: string
  /** When the assistant last revised it (rhema_update_service_draft). */
  updated_at?: string
  client?: { name?: string; version?: string } | null
  assumptions?: string[]
  phases: { name: string; role?: PhaseRole; rule?: PhaseRule; starts_at?: string; items: AiDraftItem[] }[]
}

/** Who wrote it, for the items' "prepared by" and the review list. */
export function draftAuthor(d: AiDraft): string {
  return `AI draft · ${d.client?.name?.trim() || "an assistant"}`.slice(0, 60)
}

/** The draft as a rundown: items in order and the phases before them. */
export function draftToRundown(d: AiDraft, newId: () => string = () => crypto.randomUUID()): { items: QueueItem[]; headers: OutlineHeader[] } {
  const items: QueueItem[] = []
  const headers: OutlineHeader[] = []
  const by = draftAuthor(d)
  const now = Date.now()
  for (const p of d.phases) {
    headers.push({ id: newId(), type: "phase", name: p.name, at: items.length, ...(p.rule ? { rule: p.rule } : {}), ...(p.role ? { role: p.role } : {}), ...(p.starts_at ? { starts_at: p.starts_at } : {}) })
    for (const it of p.items) {
      const base = { id: newId(), confidence: 1, source: "manual" as const, added_at: now, prepared_by: by, planned_minutes: it.planned_minutes ?? null, notes: it.notes ?? null }
      if (it.kind === "song" && it.song) {
        const languages = [it.song.primary_language, ...it.song.languages.filter((l) => l !== it.song!.primary_language)]
        items.push({ ...base, kind: "song", reference: it.song.title, song: { song_id: it.song.id, title: it.song.title, arrangement_id: null, languages } })
      } else if (it.kind === "verse" && it.book_number && it.chapter && it.verse) {
        items.push({
          ...base,
          reference: it.reference ?? `${it.book_name} ${it.chapter}:${it.verse}`,
          verse: { id: 0, translation_id: 0, book_number: it.book_number, book_name: it.book_name ?? "", book_abbreviation: "", chapter: it.chapter, verse: it.verse, text: "" },
          translation: it.translation ?? null,
          ...(it.verses && it.verses > 1 ? { notes: [it.notes, `The reading continues to ${it.reference}: Next verse steps through it.`].filter(Boolean).join(" ") } : {}),
        })
      } else if (it.kind === "slide") {
        items.push({ ...base, kind: "slide", reference: it.title || it.text?.slice(0, 40) || "Slide", slide: { title: it.title ?? "", body: it.text ?? "" } })
      } else {
        // Not in the library: a placeholder for people to source, never invented words.
        const what = it.wanted === "hymn" ? "hymn" : "song"
        items.push({ ...base, kind: "slide", reference: `Missing ${what}: ${it.title ?? ""}`.trim(), slide: { title: `Missing ${what}: ${it.title ?? ""}`, body: "" }, notes: [it.notes, `Not found in the library: add it (with its licence) or choose another ${what}.`].filter(Boolean).join(" ") })
      }
    }
  }
  return { items, headers }
}
