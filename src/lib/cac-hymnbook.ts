import { invoke } from "@tauri-apps/api/core"
import type { HymnbookInput, ImportReport, SectionInput, SongInput, SongSummary } from "@/types"

/**
 * The CAC Gospel Hymn Book (Christ Apostolic Church), English and Yorùbá.
 * Kept apart from the song library: its hymns carry this tag, the Songs tab
 * leaves them out and the Hymn book tab lists only them. Stored as bilingual
 * songs, so they present, style and travel like songs.
 */
export const CAC_TAG = "cacghb"

export const CAC_PARTS = [
  { part: 1, series: "main", code: "CAC", name: "CAC Gospel Hymn Book", label: "Part 1" },
  { part: 2, series: "V", code: "CACV", name: "CAC Gospel Hymn Book, Part 2 (various hymns)", label: "Part 2 · Various" },
] as const
export type CacPart = (typeof CAC_PARTS)[number]["part"]

export interface NumberedSong {
  number: string
  song: SongInput
}

interface RawVerse {
  label?: unknown
  lines?: unknown
}
interface RawHymn {
  title?: unknown
  tune?: unknown
  category?: unknown
  verses?: unknown
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const verses = (h: RawHymn | undefined): RawVerse[] => (Array.isArray(h?.verses) ? h.verses.filter((v): v is RawVerse => typeof v === "object" && v !== null) : [])
const verseText = (v: RawVerse) => (Array.isArray(v.lines) ? v.lines.filter((l): l is string => typeof l === "string").join("\n").trim() : "")

/**
 * The two languages' verses as sections, paired by label and occurrence (the
 * second "chorus" with the second "chorus"), never by position: the books
 * differ (an English chorus the Yorùbá prints once less, an unlabelled
 * opening line). English order; a Yorùbá-only verse goes after the one it
 * follows in Yorùbá.
 */
export function pairSections(en: RawVerse[], yo: RawVerse[]): SectionInput[] {
  const keyed = (vs: RawVerse[]) => {
    const seen = new Map<string, number>()
    return vs.map((v) => {
      const label = str(v.label).toLowerCase()
      const n = (seen.get(label) ?? 0) + 1
      seen.set(label, n)
      return { key: `${label}#${n}`, label, text: verseText(v) }
    })
  }
  const E = keyed(en)
  const Y = keyed(yo)
  const order = E.map((e) => e.key)
  Y.forEach((y, i) => {
    if (!order.includes(y.key)) order.splice(i > 0 ? order.indexOf(Y[i - 1].key) + 1 : 0, 0, y.key)
  })
  const eBy = new Map(E.map((e) => [e.key, e]))
  const yBy = new Map(Y.map((y) => [y.key, y]))
  return order
    .map((key): SectionInput => {
      const e = eBy.get(key)
      const y = yBy.get(key)
      const label = (e ?? y)?.label ?? ""
      const texts: Record<string, string> = {}
      if (e?.text) texts.en = e.text
      if (y?.text) texts.yo = y.text
      return { kind: label === "chorus" ? "chorus" : /^\d+$/.test(label) ? "verse" : "other", texts }
    })
    .filter((s) => Object.keys(s.texts).length > 0)
}

/**
 * The hymn book's JSON (an array of { number, series, english, yoruba }) as
 * one import per part. Entries without a number, a known part or any words
 * are left out and counted; a number met twice keeps its first hymn.
 */
export function cacHymnbookFromJson(raw: unknown): { parts: Array<{ book: HymnbookInput; songs: NumberedSong[] }>; skipped: number } {
  if (!Array.isArray(raw)) throw new Error("This is not the hymn book file: expected a list of hymns (hymns_combined.json).")
  let skipped = 0
  const parts = CAC_PARTS.map((p) => ({ shown: p.part === 2 ? "V" : "", book: { code: p.code, name: p.name, language: "yo", publisher: "Christ Apostolic Church", licence_note: "" } as HymnbookInput, songs: [] as NumberedSong[], seen: new Set<string>() }))
  for (const h of raw as Array<Record<string, unknown>>) {
    const part = parts[CAC_PARTS.findIndex((p) => p.series === h?.series)]
    const number = typeof h?.number === "number" && Number.isInteger(h.number) && h.number > 0 ? String(h.number) : ""
    const en = (h?.english ?? undefined) as RawHymn | undefined
    const yo = (h?.yoruba ?? undefined) as RawHymn | undefined
    const sections = pairSections(verses(en), verses(yo)).slice(0, 60)
    const title = [...(str(en?.title) || str(yo?.title))].slice(0, 200).join("")
    if (!part || !number || part.seen.has(number) || sections.length === 0 || !title) {
      skipped++
      continue
    }
    part.seen.add(number)
    const notes = [str(yo?.title) && `Yorùbá: ${str(yo?.title)}`, str(en?.tune) && `Tune: ${str(en?.tune)}`, str(en?.category)].filter(Boolean).join(" · ")
    part.songs.push({
      number,
      // The screen's footer line then reads "<title> · CAC Gospel Hymn Book 245".
      song: { title, primary_language: "yo", licence: "custom", licence_note: `CAC Gospel Hymn Book ${part.shown}${number}`, tags: CAC_TAG, notes: [...notes].slice(0, 2000).join(""), sections },
    })
  }
  return { parts: parts.map(({ book, songs }) => ({ book, songs })), skipped }
}

/** Import (or import again: hymns are matched by number, service items keep working). */
export async function importCacHymnbook(raw: unknown): Promise<{ added: number; replaced: number; skipped: number }> {
  const { parts, skipped } = cacHymnbookFromJson(raw)
  if (parts.every((p) => p.songs.length === 0)) throw new Error("No hymns found in this file.")
  let added = 0
  let replaced = 0
  for (const p of parts) {
    if (p.songs.length === 0) continue
    const r = await invoke<ImportReport>("content_import_hymnbook", { book: p.book, songs: p.songs })
    added += r.added
    replaced += r.replaced
  }
  return { added, replaced, skipped }
}

/** Which part and number a listed hymn has ("CAC 245" → part 1, 245), or null for any other song. */
export function cacNumber(song: Pick<SongSummary, "numbers">): { part: CacPart; number: number } | null {
  for (const n of song.numbers) {
    const m = n.match(/^(CACV?)\s+(\d+)$/i)
    if (m) return { part: m[1].toUpperCase() === "CACV" ? 2 : 1, number: parseInt(m[2]) }
  }
  return null
}

/** All the hymns, both parts (the Songs tab never lists them). */
export const listCacHymns = () => invoke<SongSummary[]>("content_list_songs", { query: null, limit: 5000, tag: CAC_TAG, withTag: true })
/** Hymns whose words match (either language). */
export const searchCacHymns = (query: string) => invoke<SongSummary[]>("content_list_songs", { query, limit: 200, tag: CAC_TAG, withTag: true })
