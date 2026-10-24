import { clockMinutes, type OutlineHeader, type PhaseRole, type PhaseRule } from "@/lib/run-of-show"
import { idByName } from "@/lib/item-intent"
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
  /** A clock time it should finish by, "HH:MM" (drafts from before this have none). */
  end_by?: string | null
  /** The group within its phase: items next to each other with the same name share a heading. */
  group?: string | null
  notes?: string | null
  /**
   * The assistant's suggestions for how it looks, by name (shown in review). Opening the draft sets
   * them as the item's look and scene when the church has one by that name (#299 6.6); they stay
   * Preview hints, never taken live.
   */
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
  /** 1 when saved, one more per revision; absent on drafts from before revisions. */
  revision?: number
  client?: { name?: string; version?: string } | null
  assumptions?: string[]
  phases: { name: string; role?: PhaseRole; rule?: PhaseRule; starts_at?: string; items: AiDraftItem[] }[]
}

/** Who wrote it, for the items' "prepared by" and the review list. */
export function draftAuthor(d: AiDraft): string {
  return `AI draft · ${d.client?.name?.trim() || "an assistant"}`.slice(0, 60)
}

/** An item's place in a draft, for choosing what to leave out: "phase:item". */
export const itemKey = (phase: number, item: number) => `${phase}:${item}`

/** The draft without the items people unticked (phases stay, so the run of show keeps its shape). */
export function leaveOut(d: AiDraft, out: ReadonlySet<string>): AiDraft {
  if (out.size === 0) return d
  return { ...d, phases: d.phases.map((p, pi) => ({ ...p, items: p.items.filter((_, ii) => !out.has(itemKey(pi, ii))) })) }
}

export interface DraftDiff {
  /** In the draft, not in the open service. */
  added: string[]
  /** In the open service, not in the draft. */
  missing: string[]
  /** In both, with a different planned length or finish-by time. */
  changed: { label: string; from: string; to: string }[]
}

const timing = (i: { planned_minutes?: number | null; end_by?: string | null }) =>
  [i.planned_minutes ? `${i.planned_minutes} min` : null, i.end_by ? `by ${i.end_by}` : null].filter(Boolean).join(", ") || "no time"

/** What opening the draft would change against the open service's rundown, matched by name. */
export function draftDiff(draft: QueueItem[], open: QueueItem[]): DraftDiff {
  const key = (i: QueueItem) => i.reference.trim().toLowerCase()
  const left = [...open]
  const added: string[] = []
  const changed: DraftDiff["changed"] = []
  for (const it of draft) {
    const k = left.findIndex((o) => key(o) === key(it))
    if (k === -1) {
      added.push(it.reference)
      continue
    }
    const [was] = left.splice(k, 1)
    if ((was.planned_minutes ?? null) !== (it.planned_minutes ?? null) || (was.end_by ?? null) !== (it.end_by ?? null)) changed.push({ label: it.reference, from: timing(was), to: timing(it) })
  }
  return { added, missing: left.map((o) => o.reference), changed }
}

/** The church's looks and congregation scenes, by name, to match a draft's suggestions against. */
export interface DraftNames {
  looks: readonly { id: string; name: string }[]
  scenes: readonly { id: string; name: string }[]
}

/** An item's suggested look and scene, each with the id of the church's one by that name (null: none here). */
export function matchSuggestions(it: Pick<AiDraftItem, "suggested_look" | "suggested_scene">, names: DraftNames): { look: { name: string; id: string | null } | null; scene: { name: string; id: string | null } | null } {
  const one = (name: string | null | undefined, list: DraftNames["looks"]) => (name?.trim() ? { name: name.trim(), id: idByName(name, list) } : null)
  return { look: one(it.suggested_look, names.looks), scene: one(it.suggested_scene, names.scenes) }
}

/**
 * The draft as a rundown: items in order and the phases (and groups) before them. A suggested look
 * or scene the church has (matched by name) becomes the item's look or scene; one it lacks is left out.
 */
export function draftToRundown(d: AiDraft, newId: () => string = () => crypto.randomUUID(), names: DraftNames = { looks: [], scenes: [] }): { items: QueueItem[]; headers: OutlineHeader[] } {
  const items: QueueItem[] = []
  const headers: OutlineHeader[] = []
  const by = draftAuthor(d)
  const now = Date.now()
  for (const p of d.phases) {
    headers.push({ id: newId(), type: "phase", name: p.name, at: items.length, ...(p.rule ? { rule: p.rule } : {}), ...(p.role ? { role: p.role } : {}), ...(p.starts_at ? { starts_at: p.starts_at } : {}) })
    let group: string | null = null
    for (const it of p.items) {
      const g = it.group?.trim() || null
      if (g && g !== group) headers.push({ id: newId(), type: "group", name: g, at: items.length })
      if (g) group = g
      const endBy = clockMinutes(it.end_by) !== null ? it.end_by! : null
      const { look, scene } = matchSuggestions(it, names)
      const base = { id: newId(), confidence: 1, source: "manual" as const, added_at: now, prepared_by: by, planned_minutes: it.planned_minutes ?? null, ...(endBy ? { end_by: endBy } : {}), notes: it.notes ?? null, ...(look?.id ? { look_id: look.id } : {}), ...(scene?.id ? { scene_id: scene.id } : {}) }
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
