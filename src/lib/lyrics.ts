import type { SectionInput, SectionKind, SongQueueItem, SongSummary, SongWithSections, VerseRenderData } from "@/types"

/** One screen of a song: a section (or part of one) in one or two languages. */
export interface LyricSlide {
  sectionId: string
  sectionLabel: string
  lines: string[]
  /** Second language, same section. */
  secondaryLines?: string[]
  /** Language tags the item asked for that this section has no text in. */
  missing: string[]
  index: number
  total: number
}

export const DEFAULT_MAX_LYRIC_LINES = 6

// ── paste-first parser ──────────────────────────────────────────────────

/**
 * Section headings a volunteer might type on their own line, in English and
 * Yoruba. Matched case-insensitively, with or without a number or colon.
 */
const HEADINGS: Array<[RegExp, SectionKind]> = [
  [/^(verse|v|stanza|ẹsẹ|ese)\s*(\d+)?[.:]?$/i, "verse"],
  [/^(chorus|refrain|c|ẹgbẹ́ orin|egbe orin|ẹgbẹ|egbe|ìpadàbọ̀|ipadabo)\s*(\d+)?[.:]?$/i, "chorus"],
  [/^(pre-?chorus|pc)\s*(\d+)?[.:]?$/i, "prechorus"],
  [/^(bridge|b|afárá|afara)\s*(\d+)?[.:]?$/i, "bridge"],
  [/^(tag|t)\s*(\d+)?[.:]?$/i, "tag"],
  [/^(ending|end|outro|coda|ìparí|ipari)\s*(\d+)?[.:]?$/i, "ending"],
  [/^(intro|introduction|ìbẹ̀rẹ̀|ibere)\s*(\d+)?[.:]?$/i, "intro"],
]

export function matchHeading(line: string): SectionKind | null {
  const t = line.trim()
  if (!t || t.length > 24) return null
  for (const [re, kind] of HEADINGS) if (re.test(t)) return kind
  return null
}

/**
 * Plain pasted lyrics → sections. Blank lines separate sections; a heading
 * on its own line ("Chorus", "Verse 2", "Ẹgbẹ́ orin") names the next block.
 * Blocks without a heading are verses. No markup to learn.
 */
export function parsePastedLyrics(text: string, language = "en"): SectionInput[] {
  const sections: SectionInput[] = []
  let kind: SectionKind | null = null
  let buffer: string[] = []
  const flush = () => {
    const body = buffer.join("\n").trim()
    if (body) sections.push({ kind: kind ?? "verse", texts: { [language]: body } })
    buffer = []
    kind = null
  }
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      if (buffer.length) flush()
      continue
    }
    const heading = matchHeading(line)
    if (heading) {
      if (buffer.length) flush()
      kind = heading
      continue
    }
    buffer.push(line.trim())
  }
  flush()
  return sections
}

// ── slides ──────────────────────────────────────────────────────────────

const nonEmpty = (s: string) => s.trim().length > 0

/** Blank-line hints first; then any chunk over `max` lines is split evenly. */
export function splitBody(body: string, max = DEFAULT_MAX_LYRIC_LINES): string[][] {
  const chunks = body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((c) => c.split("\n").map((l) => l.trim()).filter(nonEmpty))
    .filter((c) => c.length > 0)
  return chunks.flatMap((c) => splitEvenly(c, max))
}

export function splitEvenly(lines: string[], max: number): string[][] {
  if (lines.length <= max) return [lines]
  const parts = Math.ceil(lines.length / max)
  const size = Math.ceil(lines.length / parts)
  const out: string[][] = []
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size))
  return out
}

/**
 * Build the slides of a song for one arrangement and language choice.
 * Two languages are aligned by section: a slide shows the whole section in
 * both, and is split only when both exceed `max` (then into the same number
 * of parts). A section with text in only one of the requested languages is
 * shown in that one and names the other in `missing`; a section with no
 * text in any of them is skipped.
 */
export function buildSlides(
  song: SongWithSections,
  arrangementId: string | null,
  languages: string[],
  max = DEFAULT_MAX_LYRIC_LINES
): LyricSlide[] {
  const arrangement =
    (arrangementId ? song.arrangements.find((a) => a.id === arrangementId) : undefined) ??
    song.arrangements.find((a) => a.is_default) ??
    song.arrangements[0]
  const sequence = arrangement?.sequence.length ? arrangement.sequence : song.sections.map((s) => s.id)
  const langs = languages.length ? languages : [song.song.primary_language]
  const slides: LyricSlide[] = []
  for (const sectionId of sequence) {
    const section = song.sections.find((s) => s.id === sectionId)
    if (!section) continue
    const available = langs.filter((l) => nonEmpty(section.texts[l] ?? ""))
    const missing = langs.filter((l) => !available.includes(l))
    if (available.length === 0) continue
    const primary = splitBody(section.texts[available[0]], max)
    const secondary = available[1] ? splitBody(section.texts[available[1]], max) : null
    if (!secondary) {
      for (const lines of primary) slides.push({ sectionId, sectionLabel: section.label, lines, missing, index: 0, total: 0 })
      continue
    }
    // Aligned: pair blank-line chunks when the counts agree, else whole section.
    const pairs: Array<[string[], string[]]> =
      primary.length === secondary.length
        ? primary.map((p, i) => [p, secondary[i]])
        : [[primary.flat(), secondary.flat()]]
    for (const [p, s] of pairs) {
      if (p.length > max && s.length > max) {
        const parts = Math.max(Math.ceil(p.length / max), Math.ceil(s.length / max))
        const ps = splitInto(p, parts)
        const ss = splitInto(s, parts)
        for (let i = 0; i < parts; i++) {
          slides.push({ sectionId, sectionLabel: section.label, lines: ps[i] ?? [], secondaryLines: ss[i] ?? [], missing, index: 0, total: 0 })
        }
      } else {
        slides.push({ sectionId, sectionLabel: section.label, lines: p, secondaryLines: s, missing, index: 0, total: 0 })
      }
    }
  }
  return slides.map((s, index) => ({ ...s, index, total: slides.length }))
}

function splitInto(lines: string[], parts: number): string[][] {
  const size = Math.ceil(lines.length / parts)
  const out: string[][] = []
  for (let i = 0; i < parts; i++) out.push(lines.slice(i * size, (i + 1) * size))
  return out
}

// ── render data ─────────────────────────────────────────────────────────

/** The copyright line shown under lyrics when the licence calls for it. */
export function copyrightFooter(song: SongWithSections["song"]): string | undefined {
  if (song.licence === "public_domain") return undefined
  const parts = [song.title, song.authors, song.copyright, song.ccli_number ? `CCLI ${song.ccli_number}` : "", song.licence_note]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
  return parts.length ? parts.join(" · ") : undefined
}

export function toLyricRenderData(song: SongWithSections, slide: LyricSlide): VerseRenderData {
  return {
    kind: "lyric",
    reference: `${song.song.title} · ${slide.sectionLabel}`,
    segments: [{ text: [...slide.lines, ...(slide.secondaryLines ?? [])].join(" ") }],
    lines: slide.lines,
    secondaryLines: slide.secondaryLines,
    footer: copyrightFooter(song.song),
  }
}

/** Short badge text for a section kind. */
export function sectionShort(kind: SectionKind, label: string): string {
  const n = label.match(/\d+/)?.[0] ?? ""
  const letter: Record<SectionKind, string> = { verse: "V", chorus: "C", bridge: "B", prechorus: "PC", tag: "T", ending: "E", intro: "I", other: "S" }
  return `${letter[kind]}${n}`
}

/** A song (from search) as a rundown item: default arrangement, primary language first, then the others it has. */
export function songQueueItem(song: SongSummary, id: string = crypto.randomUUID()): SongQueueItem {
  const languages = [song.primary_language, ...song.languages.filter((l) => l !== song.primary_language)].filter((l) =>
    song.languages.includes(l)
  )
  return {
    id,
    kind: "song",
    song: { song_id: song.id, title: song.title, arrangement_id: null, languages: languages.length ? languages : [song.primary_language] },
    reference: song.title,
    confidence: 1,
    source: "manual",
    added_at: Date.now(),
  }
}
