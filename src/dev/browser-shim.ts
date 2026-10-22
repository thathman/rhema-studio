/**
 * Dev-only: lets the UI run in a plain browser (`bun run dev`, open
 * localhost) for layout and workflow checks when no Tauri window is around.
 * Stubs the Tauri IPC with canned Bible data and an in-memory song library.
 * Imported from main.tsx only when `import.meta.env.DEV` and the real Tauri
 * internals are absent, so production builds never include it.
 *
 * It is not a substitute for desktop testing: nothing here reaches the
 * real database, outputs, NDI or speech.
 */

type Song = {
  song: Record<string, unknown> & { id: string; title: string; revision: number; licence: string; primary_language: string; authors: string; ccli_number: string | null; copyright: string; licence_note: string }
  sections: Array<{ id: string; kind: string; label: string; texts: Record<string, string> }>
  arrangements: Array<{ id: string; name: string; sequence: string[]; is_default: boolean }>
  numbers: Array<{ hymnbook_id: string; hymnbook_code: string; number: string }>
}

const uid = () => crypto.randomUUID()
const songs = new Map<string, Song>()
const hymnbooks = new Map<string, { id: string; code: string; name: string; language: string; publisher: string; licence_note: string }>()
const programs = new Map<string, { program: Record<string, unknown>; items: unknown[] }>()
const logs: Array<{ id: string; program_id: string | null; title: string; saved_at: string; bytes: number; body: string }> = []

const KJV = { id: 1, abbreviation: "KJV", title: "King James Version", language: "en", is_copyrighted: false, is_downloaded: true }
const OYCB = { id: 7, abbreviation: "OYCB", title: "Yoruba Bible", language: "yo", is_copyrighted: false, is_downloaded: true }
const BOOKS = [
  [1, "Genesis", "Gen", "OT"], [19, "Psalms", "Ps", "OT"], [43, "John", "Jn", "NT"], [45, "Romans", "Rom", "NT"], [62, "I John", "1Jn", "NT"],
].map(([n, name, abbr, t], i) => ({ id: i + 1, translation_id: 1, book_number: n, name, abbreviation: abbr, testament: t }))

function verse(translationId: number, bookNumber: number, chapter: number, v: number) {
  const book = BOOKS.find((b) => b.book_number === bookNumber)
  if (!book) return null
  const text = translationId === 7
    ? `Nítorí Ọlọ́run fẹ́ aráyé tó bẹ́ẹ̀ gẹ́ẹ́, tí ó fi Ọmọ bíbí rẹ̀ kan ṣoṣo fúnni (${book.name} ${chapter}:${v})`
    : `For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life. (${book.name} ${chapter}:${v})`
  return { id: bookNumber * 100000 + chapter * 1000 + v, translation_id: translationId, book_number: bookNumber, book_name: book.name, book_abbreviation: book.abbreviation, chapter, verse: v, text }
}

function summary(s: Song) {
  const languages = [...new Set(s.sections.flatMap((x) => Object.keys(x.texts)))].sort()
  const first = s.sections[0]?.texts[s.song.primary_language] ?? Object.values(s.sections[0]?.texts ?? {})[0] ?? ""
  return {
    id: s.song.id, title: s.song.title, alternate_titles: (s.song.alternate_titles as string[] | undefined) ?? [], tags: String(s.song.tags ?? ""), authors: s.song.authors, licence: s.song.licence, primary_language: s.song.primary_language,
    languages, numbers: s.numbers.map((n) => `${n.hymnbook_code} ${n.number}`), first_line: first.split("\n")[0] ?? "", revision: s.song.revision, updated_at: "",
  }
}

function writeSong(id: string, input: Record<string, unknown>, revision: number): Song {
  const sections = (input.sections as Array<{ id?: string; kind: string; label?: string; texts: Record<string, string> }>).map((s, i, all) => ({
    id: s.id ?? uid(),
    kind: s.kind,
    label: s.label?.trim() || `${s.kind === "verse" ? "Verse" : s.kind[0].toUpperCase() + s.kind.slice(1)}${s.kind === "verse" || all.filter((x) => x.kind === s.kind).length > 1 ? ` ${all.slice(0, i + 1).filter((x) => x.kind === s.kind).length}` : ""}`,
    texts: s.texts,
  }))
  const ids = sections.map((s) => s.id)
  const resolve = (ref: string) => (ref.startsWith("#") ? ids[Number(ref.slice(1))] : ref)
  const given = (input.arrangements as Array<{ id?: string; name: string; sequence: string[]; is_default?: boolean }>) ?? []
  const chorus = sections.filter((s) => s.kind === "chorus")
  const generated = sections.flatMap((s) => (s.kind === "chorus" && chorus.length === 1 ? [] : chorus.length === 1 && s.kind === "verse" ? [s.id, chorus[0].id] : [s.id]))
  const arrangements = given.length
    ? given.map((a, i) => ({ id: a.id ?? uid(), name: a.name, sequence: a.sequence.map(resolve), is_default: a.is_default ?? i === 0 }))
    : [{ id: uid(), name: "Default", sequence: generated, is_default: true }]
  const numbers = ((input.numbers as Array<{ hymnbook_id: string; number: string }>) ?? []).map((n) => ({ ...n, hymnbook_code: hymnbooks.get(n.hymnbook_id)?.code ?? "?" }))
  const song: Song = {
    song: { id, revision, created_at: "", updated_at: "", tags: "", notes: "", ...input, title: String(input.title), licence: String(input.licence ?? "unknown"), primary_language: String(input.primary_language ?? "en"), authors: String(input.authors ?? ""), ccli_number: (input.ccli_number as string | null) ?? null, copyright: String(input.copyright ?? ""), licence_note: String(input.licence_note ?? "") },
    sections, arrangements, numbers,
  }
  songs.set(id, song)
  return song
}

const invalid = (message: string) => ({ kind: "invalid", message })

async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (cmd) {
    case "list_translations": return [KJV, OYCB]
    case "list_books": return BOOKS
    case "get_verse": return verse(Number(args.translationId ?? 1), Number(args.bookNumber), Number(args.chapter), Number(args.verse))
    case "get_chapter": return Array.from({ length: 10 }, (_, i) => verse(Number(args.translationId ?? 1), Number(args.bookNumber), Number(args.chapter), i + 1))
    case "search_verses": return [verse(1, 43, 3, 16)]
    case "content_status": return { available: true, path: "(browser shim)", migrations: ["0001_programs", "0002_item_identity", "0003_songs"], last_backup: null }
    case "content_export_service_package": throw { message: "Not available in the browser shim" }
    case "content_import_service_package": throw { message: "Not available in the browser shim" }
    case "content_list_song_attachments": return []
    case "content_add_song_attachment": return []
    case "content_remove_song_attachment": return []
    case "remote_set_keys": return 0
    case "remote_pair_start": return "123456"
    case "remote_pair_cancel": return null
    case "get_audio_devices": return [] // the real command always returns a list; null crashed Settings
    case "damaged_store_files": return [] // nothing is set aside in the browser
    case "content_set_actor": return null
    case "content_save_service_log": { const id = crypto.randomUUID(); logs.unshift({ id, program_id: (args.programId as string | null) ?? null, title: String(args.title), saved_at: new Date().toISOString(), bytes: String(args.body).length, body: String(args.body) }); return logs[0] }
    case "content_list_service_logs": { const q = String(args.query ?? "").toLowerCase(); return logs.filter((l) => !q || l.title.toLowerCase().includes(q) || l.body.toLowerCase().includes(q)) }
    case "content_get_service_log": return logs.find((l) => l.id === args.id) ?? null
    case "content_delete_service_log": { const i = logs.findIndex((l) => l.id === args.id); if (i >= 0) logs.splice(i, 1); return null }
    case "content_backup": return null
    case "media_list": return []
    case "media_import": return (args.paths as string[]).map((path) => ({ status: "failed", path, message: "the browser shim has no media folder" }))
    case "content_restore": return { snapshot: "(browser shim)", migrations: ["0001_programs", "0002_item_identity", "0003_songs"] }
    case "content_list_programs": return [...programs.values()].map((p) => p.program)
    case "content_create_program": {
      const id = uid()
      const program = { id, title: args.title, service_date: args.serviceDate ?? null, revision: 1, created_at: "", updated_at: "", item_count: 0 }
      programs.set(id, { program, items: [] })
      return program
    }
    case "content_get_program": return programs.get(String(args.id)) ?? null
    case "content_replace_items": {
      const p = programs.get(String(args.programId))
      if (!p) throw { kind: "not_found", message: "no such program" }
      if (p.program.revision !== args.expectedRevision) throw { kind: "conflict", message: "conflict", expected: args.expectedRevision, actual: p.program.revision }
      p.items = (args.items as Array<Record<string, unknown>>).map((it, position) => ({ id: it.id ?? uid(), program_id: p.program.id, position, payload: null, notes: null, translation: null, secondary_translation: null, ...it }))
      p.program = { ...p.program, revision: (p.program.revision as number) + 1, item_count: p.items.length }
      return p
    }
    case "content_delete_program": programs.delete(String(args.id)); return null
    case "content_list_revisions": return []
    case "content_approve_program": {
      const p = programs.get(String(args.id))
      if (!p) throw { kind: "not_found", message: "no such service" }
      p.program = { ...p.program, approved_revision: p.program.revision, approved_at: new Date().toISOString() }
      return p.program
    }
    case "content_get_revision": return null
    case "content_list_songs": {
      const q = String(args.query ?? "").toLowerCase().trim()
      const tag = typeof args.tag === "string" ? args.tag.toLowerCase() : null
      const tagged = (s: Song) => String(s.song.tags ?? "").toLowerCase().split(",").map((t) => t.trim()).includes(tag ?? "")
      return [...songs.values()]
        .filter((s) => !tag || tagged(s) === (args.withTag !== false))
        .filter((s) => !q || JSON.stringify(summary(s)).toLowerCase().includes(q) || s.sections.some((x) => Object.values(x.texts).some((t) => t.toLowerCase().includes(q))))
        .slice(0, Number(args.limit ?? 200))
        .map(summary)
    }
    case "content_import_hymnbook": {
      let added = 0
      let replaced = 0
      let booksAdded = 0
      for (const part of args.parts as Array<{ book: { code: string; name: string; language?: string }; songs: Array<{ number: string; song: Record<string, unknown> }> }>) {
        const existing = [...hymnbooks.values()].find((b) => b.code.toLowerCase() === part.book.code.toLowerCase())
        const id = existing?.id ?? uid()
        if (!existing) {
          hymnbooks.set(id, { id, code: part.book.code, name: part.book.name, language: part.book.language ?? "yo", publisher: "", licence_note: "" })
          booksAdded += 1
        }
        for (const n of part.songs) {
          const holder = [...songs.values()].find((s) => s.numbers.some((x) => x.hymnbook_id === id && x.number === n.number))
          writeSong(holder?.song.id ?? uid(), { ...n.song, numbers: [{ hymnbook_id: id, number: n.number }] }, (holder?.song.revision ?? 0) + 1)
          if (holder) replaced += 1
          else added += 1
        }
      }
      return { added, replaced, skipped: 0, hymnbooks_added: booksAdded, numbers_skipped: 0 }
    }
    case "content_get_song": return songs.get(String(args.id)) ?? null
    case "content_create_song": {
      const input = args.input as Record<string, unknown>
      if (!String(input.title ?? "").trim()) throw invalid("title is required")
      return writeSong(uid(), input, 1)
    }
    case "content_update_song": {
      const existing = songs.get(String(args.id))
      if (!existing) throw { kind: "not_found", message: "no such song" }
      if (existing.song.revision !== args.expectedRevision) throw { kind: "conflict", message: "conflict: expected revision", expected: args.expectedRevision, actual: existing.song.revision }
      return writeSong(existing.song.id, args.input as Record<string, unknown>, existing.song.revision + 1)
    }
    case "content_delete_song": {
      const used = [...programs.values()].filter((p) => p.items.some((it) => String((it as { payload?: string }).payload ?? "").includes(String(args.id)))).map((p) => p.program.title)
      if (used.length) throw { kind: "in_use", message: "in use", titles: used }
      songs.delete(String(args.id))
      return null
    }
    case "content_list_hymnbooks": return [...hymnbooks.values()]
    case "content_upsert_hymnbook": {
      const input = args.input as { id?: string; code: string; name: string; language?: string }
      const id = input.id ?? uid()
      const book = { id, code: input.code, name: input.name, language: input.language ?? "en", publisher: "", licence_note: "" }
      hymnbooks.set(id, book)
      return book
    }
    case "content_delete_hymnbook": {
      hymnbooks.delete(String(args.id))
      for (const s of songs.values()) s.numbers = s.numbers.filter((n) => n.hymnbook_id !== String(args.id))
      return null
    }
    case "content_export_songs": return { version: 1, hymnbooks: [...hymnbooks.values()], songs: [...songs.values()] }
    case "content_import_songs": {
      const e = args.export as { songs: Song[]; hymnbooks: Array<{ id: string; code: string; name: string; language: string; publisher: string; licence_note: string }> }
      for (const b of e.hymnbooks) hymnbooks.set(b.id, b)
      let added = 0
      for (const s of e.songs) { songs.set(s.song.id, s); added += 1 }
      return { added, replaced: 0, skipped: 0, hymnbooks_added: e.hymnbooks.length }
    }
    default:
      if (cmd === "plugin:store|get") return [null, false]
      if (cmd === "plugin:store|load") return 1
      return null
  }
}

// Seed: one bilingual hymn and a hymnbook, so the library is not empty.
const sss = { id: "book-sss", code: "SSS", name: "Sacred Songs and Solos", language: "en", publisher: "", licence_note: "" }
hymnbooks.set(sss.id, sss)
writeSong("seed-amazing-grace", {
  title: "Amazing Grace", authors: "John Newton", licence: "public_domain", primary_language: "en",
  sections: [
    { kind: "verse", texts: { en: "Amazing grace! how sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found,\nWas blind, but now I see.", yo: "Oore-ọ̀fẹ́ ìyanu, ohùn dídùn\nTí ó gba ẹ̀dá bí èmi là!\nMo ti sọnù, ṣùgbọ́n a rí mi,\nMo fọ́jú, ṣùgbọ́n mo ríran." } },
    { kind: "verse", texts: { en: "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed!" } },
  ],
  numbers: [{ hymnbook_id: sss.id, number: "245" }],
}, 1)
writeSong("seed-blessed", {
  title: "Blessed Assurance", authors: "Fanny Crosby; Phoebe Knapp", licence: "unknown", primary_language: "en",
  sections: [
    { kind: "verse", texts: { en: "Blessed assurance, Jesus is mine!\nO what a foretaste of glory divine!" } },
    { kind: "chorus", texts: { en: "This is my story, this is my song,\nPraising my Savior all the day long;" } },
    { kind: "verse", texts: { en: "Perfect submission, perfect delight,\nVisions of rapture now burst on my sight;" } },
  ],
}, 1)

const w = window as unknown as Record<string, unknown>
w.__TAURI_INTERNALS__ = {
  invoke,
  transformCallback: () => 0,
  unregisterCallback: () => {},
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  plugins: {},
  convertFileSrc: (p: string) => p,
}
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
console.info("[dev] Tauri browser shim active: canned Bible data, in-memory songs. Not the real app.")
