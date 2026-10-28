import type { ArrangementInput, HymnNumberInput, Licence, SectionInput, SectionKind, SongInput, SongWithSections } from "@/types"
import { parsePastedLyrics } from "@/lib/lyrics"

/** Editor state: like `SongInput`, but every section and step has a stable local id. */
export interface SectionForm {
  /** Database id when the section exists, else a local `new-…` id. */
  id: string
  kind: SectionKind
  label: string
  texts: Record<string, string>
}

export interface Step {
  /** Unique per chip, so the same section can appear twice. */
  uid: string
  sectionId: string
}

export interface ArrangementForm {
  id: string
  name: string
  steps: Step[]
  is_default: boolean
}

export interface SongForm {
  title: string
  /** Other titles, one per line. */
  alternate_titles: string
  authors: string
  copyright: string
  ccli_number: string
  licence: Licence
  licence_note: string
  primary_language: string
  tags: string
  notes: string
  key: string
  tempo: string
  sections: SectionForm[]
  arrangements: ArrangementForm[]
  numbers: HymnNumberInput[]
}

let counter = 0
export const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`
const isLocal = (id: string) => id.startsWith("new-")

export function emptyForm(language = "en"): SongForm {
  return {
    title: "", alternate_titles: "", authors: "", copyright: "", ccli_number: "", licence: "unknown", licence_note: "",
    primary_language: language, tags: "", notes: "", key: "", tempo: "", sections: [], arrangements: [], numbers: [],
  }
}

export function formFromSong(s: SongWithSections): SongForm {
  return {
    title: s.song.title,
    alternate_titles: (s.song.alternate_titles ?? []).join("\n"),
    authors: s.song.authors,
    copyright: s.song.copyright,
    ccli_number: s.song.ccli_number ?? "",
    licence: s.song.licence,
    licence_note: s.song.licence_note,
    primary_language: s.song.primary_language,
    tags: s.song.tags,
    notes: s.song.notes,
    key: s.song.key ?? "",
    tempo: s.song.tempo === null || s.song.tempo === undefined ? "" : String(s.song.tempo),
    sections: s.sections.map((x) => ({ id: x.id, kind: x.kind, label: x.label, texts: { ...x.texts } })),
    arrangements: s.arrangements.map((a) => ({
      id: a.id,
      name: a.name,
      is_default: a.is_default,
      steps: a.sequence.map((sectionId) => ({ uid: localId("step"), sectionId })),
    })),
    numbers: s.numbers.map((n) => ({ hymnbook_id: n.hymnbook_id, number: n.number })),
  }
}

/** What the database receives. Local ids are dropped so the crate assigns real ones. */
export function inputFromForm(f: SongForm): SongInput {
  const sections: SectionInput[] = f.sections.map((s) => ({
    id: isLocal(s.id) ? undefined : s.id,
    kind: s.kind,
    label: s.label.trim(),
    texts: Object.fromEntries(Object.entries(s.texts).filter(([, body]) => body.trim())),
  }))
  // Steps name sections by their form id; new sections are referenced by index.
  const ref = (sectionId: string) => {
    const i = f.sections.findIndex((s) => s.id === sectionId)
    return i === -1 ? null : isLocal(sectionId) ? `#${i}` : sectionId
  }
  const arrangements: ArrangementInput[] = f.arrangements.map((a) => ({
    id: isLocal(a.id) ? undefined : a.id,
    name: a.name.trim(),
    is_default: a.is_default,
    sequence: a.steps.map((st) => ref(st.sectionId)).filter((x): x is string => x !== null),
  }))
  return {
    title: f.title.trim(),
    alternate_titles: otherTitles(f),
    authors: f.authors.trim(),
    copyright: f.copyright.trim(),
    ccli_number: f.ccli_number.trim() || null,
    licence: f.licence,
    licence_note: f.licence_note.trim(),
    primary_language: f.primary_language,
    tags: f.tags.trim(),
    notes: f.notes.trim(),
    key: f.key.trim(),
    tempo: f.tempo.trim() ? Number(f.tempo) : null,
    sections,
    arrangements,
    numbers: f.numbers.filter((n) => n.hymnbook_id && n.number.trim()).map((n) => ({ hymnbook_id: n.hymnbook_id, number: n.number.trim() })),
  }
}

/**
 * The form as a brand-new song (RG-05: keeping one's edits after a save
 * conflict): no ids from the original (sections and arrangements are new,
 * steps refer to sections by position) and no hymnbook numbers, which the
 * original keeps. The title gets `suffix`, within the 200-character limit.
 */
export function newSongInputFromForm(f: SongForm, suffix: string): SongInput {
  const base = inputFromForm(f)
  const position = new Map(f.sections.map((s, i) => [s.id, `#${i}`]))
  const title = Array.from(base.title || "Untitled song").slice(0, 200 - Array.from(suffix).length).join("") + suffix
  return {
    ...base,
    title,
    sections: base.sections.map((s) => ({ ...s, id: undefined })),
    arrangements: f.arrangements.map((a) => ({
      id: undefined,
      name: a.name.trim(),
      is_default: a.is_default,
      sequence: a.steps.map((st) => position.get(st.sectionId)).filter((x): x is string => x !== undefined),
    })),
    numbers: [],
  }
}

const KIND_NAME: Record<SectionKind, string> = {
  verse: "Verse", chorus: "Chorus", bridge: "Bridge", prechorus: "Pre-chorus", tag: "Tag", ending: "Ending", intro: "Intro", other: "Section",
}

/** "Verse 1", "Chorus", "Chorus 2": numbered within its kind only when repeated (verses always). */
export function defaultLabel(kind: SectionKind, index: number, all: Array<{ kind: SectionKind }>): string {
  const same = all.map((s, i) => [s.kind, i] as const).filter(([k]) => k === kind).map(([, i]) => i)
  const n = same.indexOf(index) + 1
  return same.length > 1 || kind === "verse" ? `${KIND_NAME[kind]} ${n || 1}` : KIND_NAME[kind]
}

/** Relabel every section that still carries a default-style label. */
export function relabel(sections: SectionForm[]): SectionForm[] {
  const generic = /^(Verse|Chorus|Bridge|Pre-chorus|Tag|Ending|Intro|Section)( \d+)?$/
  return sections.map((s, i) => (generic.test(s.label) || !s.label.trim() ? { ...s, label: defaultLabel(s.kind, i, sections) } : s))
}

/** Append sections parsed from pasted text, in `language`. */
export function applyPaste(form: SongForm, text: string, language: string): SongForm {
  const parsed = parsePastedLyrics(text, language)
  if (parsed.length === 0) return form
  const added: SectionForm[] = parsed.map((p) => ({ id: localId("new"), kind: p.kind, label: "", texts: p.texts }))
  return { ...form, sections: relabel([...form.sections, ...added]) }
}

export function addSection(form: SongForm, kind: SectionKind = "verse"): SongForm {
  const section: SectionForm = { id: localId("new"), kind, label: "", texts: { [form.primary_language]: "" } }
  return { ...form, sections: relabel([...form.sections, section]) }
}

export function removeSection(form: SongForm, sectionId: string): SongForm {
  return {
    ...form,
    sections: relabel(form.sections.filter((s) => s.id !== sectionId)),
    arrangements: form.arrangements.map((a) => ({ ...a, steps: a.steps.filter((st) => st.sectionId !== sectionId) })),
  }
}

export function moveSection(form: SongForm, from: number, to: number): SongForm {
  if (from === to || from < 0 || to < 0 || from >= form.sections.length || to >= form.sections.length) return form
  const sections = [...form.sections]
  const [moved] = sections.splice(from, 1)
  sections.splice(to, 0, moved)
  return { ...form, sections: relabel(sections) }
}

/** The crate's rule: authoring order, a single chorus after every verse. */
export function defaultSteps(sections: SectionForm[]): Step[] {
  const choruses = sections.filter((s) => s.kind === "chorus")
  const chorus = choruses.length === 1 ? choruses[0] : null
  const steps: Step[] = []
  for (const s of sections) {
    if (chorus && s.id === chorus.id) {
      if (!sections.slice(0, sections.indexOf(s)).some((x) => x.kind === "verse")) steps.push({ uid: localId("step"), sectionId: s.id })
      continue
    }
    steps.push({ uid: localId("step"), sectionId: s.id })
    if (chorus && s.kind === "verse") steps.push({ uid: localId("step"), sectionId: chorus.id })
  }
  return steps
}

export function addArrangement(form: SongForm, name: string): SongForm {
  const arrangement: ArrangementForm = {
    id: localId("new"),
    name,
    steps: defaultSteps(form.sections),
    is_default: form.arrangements.length === 0,
  }
  return { ...form, arrangements: [...form.arrangements, arrangement] }
}

export function updateArrangement(form: SongForm, id: string, patch: Partial<ArrangementForm>): SongForm {
  return {
    ...form,
    arrangements: form.arrangements.map((a) =>
      a.id === id ? { ...a, ...patch } : patch.is_default ? { ...a, is_default: false } : a
    ),
  }
}

export function removeArrangement(form: SongForm, id: string): SongForm {
  const rest = form.arrangements.filter((a) => a.id !== id)
  if (rest.length > 0 && !rest.some((a) => a.is_default)) rest[0] = { ...rest[0], is_default: true }
  return { ...form, arrangements: rest }
}

export const appendStep = (steps: Step[], sectionId: string): Step[] => [...steps, { uid: localId("step"), sectionId }]
export const removeStep = (steps: Step[], uid: string): Step[] => steps.filter((s) => s.uid !== uid)
export function moveStep(steps: Step[], from: number, to: number): Step[] {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return steps
  const next = [...steps]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** The other-titles box as a list: one per line, blanks dropped. */
export const otherTitles = (f: Pick<SongForm, "alternate_titles">): string[] => f.alternate_titles.split("\n").map((t) => t.trim()).filter(Boolean)

/** Problems a volunteer must fix before saving; empty when the form is valid. */
export function validateForm(f: SongForm): string[] {
  const problems: string[] = []
  if (!f.title.trim()) problems.push("Give the song a title.")
  if (otherTitles(f).length > 20) problems.push("At most 20 other titles.")
  if (f.sections.length === 0) problems.push("Add at least one section of words.")
  if (f.sections.some((s) => !Object.values(s.texts).some((t) => t.trim()))) problems.push("Every section needs some words, or remove the empty one.")
  if (f.ccli_number.trim() && !/^\d{1,12}$/.test(f.ccli_number.trim())) problems.push("The CCLI number is digits only.")
  if (f.tempo.trim() && !(Number.isInteger(Number(f.tempo)) && Number(f.tempo) >= 20 && Number(f.tempo) <= 300)) problems.push("Tempo is whole beats per minute, 20 to 300.")
  for (const n of f.numbers) {
    if (n.hymnbook_id && !/^\d{1,5}[a-z]?$/i.test(n.number.trim())) problems.push(`Hymn number "${n.number}" should be a number like 245 or 12a.`)
  }
  const names = f.arrangements.map((a) => a.name.trim().toLowerCase())
  if (names.some((n) => !n)) problems.push("Every arrangement needs a name.")
  if (new Set(names).size !== names.length) problems.push("Two arrangements have the same name.")
  return problems
}

/** Languages present anywhere in the song, primary first. */
export function formLanguages(f: SongForm): string[] {
  const set = new Set<string>([f.primary_language])
  for (const s of f.sections) for (const [lang, body] of Object.entries(s.texts)) if (body.trim()) set.add(lang)
  return [...set]
}
