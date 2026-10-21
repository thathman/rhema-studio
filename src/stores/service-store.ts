import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { useQueueStore } from "@/stores/queue-store"
import { useBibleStore } from "@/stores/bible-store"
import type {
  ItemInput,
  Program,
  ProgramItem,
  ProgramWithItems,
  QueueItem,
  RevisionSummary,
  ImageItemPayload,
  SlideItemPayload,
  SongItemPayload,
  Translation,
  Verse,
} from "@/types"
import { isImageItem, isSlideItem, isVerseItem } from "@/types"
import { safeLink } from "@/lib/qr-bulletin"
import { cleanComments, parseComments } from "@/lib/comments"
import { isContentCommandError, SUPPORTED_ITEM_KINDS } from "@/types/content"

export const CURRENT_SERVICE_KEY = "rhema-studio.service"

export type OpenResult = "ok" | "unsaved" | "missing" | "error"
export type SaveResult = "saved" | "conflict" | "unsupported" | "failed" | "nothing"
export type CreateResult = "created" | "created_unsaved" | "unsaved" | "failed"
export type CloseResult = "closed" | "unsaved"
export type DeleteResult = "deleted" | "unsaved" | "conflict" | "failed"

interface Discard {
  /** Explicitly throw away unsaved changes. Never the default. */
  discard?: boolean
}

interface ServiceState {
  programs: Program[]
  /** The service whose items are loaded into the rundown, if any. */
  current: Program | null
  /** Rundown differs from what was last loaded from or saved to the database. */
  dirty: boolean
  loading: boolean
  saving: boolean
  /** Last error from the content database, for the UI to show. */
  error: string | null
  /** Set when a save was refused because the database has a newer revision. */
  conflict: { expected: number; actual: number } | null
  /** Items of the open service this build cannot edit. Saving is blocked while any exist. */
  unsupportedItems: ProgramItem[]
  /** Translation codes the open service names that are not installed here. */
  missingTranslations: string[]

  loadPrograms: () => Promise<boolean>
  /** Create an empty service and open it. Refuses while another service has unsaved changes. */
  createProgram: (title: string, serviceDate: string | null, opts?: Discard) => Promise<Program | null>
  /** Create a service from the rundown on screen and save it. */
  createFromRundown: (title: string, serviceDate: string | null, opts?: Discard) => Promise<CreateResult>
  /**
   * Copy the open service (its saved items, with fresh item ids) into a new
   * one and open that. The original is untouched. Refuses while unsaved.
   */
  duplicateCurrent: (title: string, serviceDate: string | null) => Promise<CreateResult>
  /** Load a service into the rundown. Refuses while there are unsaved changes unless `discard`. */
  openProgram: (id: string, opts?: Discard) => Promise<OpenResult>
  /** Save the rundown as the current service's items. */
  saveCurrent: () => Promise<SaveResult>
  deleteProgram: (id: string, opts?: Discard) => Promise<DeleteResult>
  /** Detach the rundown from the saved service (keeps the rundown on screen). */
  closeProgram: (opts?: Discard) => CloseResult
  /** Saved snapshots of the open service, newest first. */
  listRevisions: () => Promise<RevisionSummary[]>
  /** Make a snapshot the current items (a normal save, so it is itself undoable). Refuses while unsaved. */
  restoreRevision: (revisionId: string) => Promise<OpenResult | "conflict">
  /** Rename or re-date the open service (its items are untouched; unsaved edits stay unsaved). */
  updateDetails: (title: string, serviceDate: string | null) => Promise<"ok" | "conflict" | "failed">
  /** Archive (hide from the picker, keep) or bring back a service. */
  setArchived: (id: string, archived: boolean) => Promise<boolean>
  /** Mark a service as a template for new services, or not. */
  setTemplate: (id: string, template: boolean) => Promise<boolean>
  /** A new service with a copy of a template's items (fresh ids; the template is untouched). */
  newFromTemplate: (templateId: string, title: string, serviceDate: string | null) => Promise<CreateResult>
  /** Approve the saved service as it is now ("this is Sunday's"). */
  approve: () => Promise<"ok" | "unsaved" | "conflict" | "error">
}

/** Translation abbreviations the operator is presenting with right now. */
export interface ActiveTranslations {
  primary: string | null
  secondary: string | null
}

/**
 * Pure: rundown items → what the database stores. Ids keep item identity.
 * Items loaded from a service keep their stored translation, secondary and
 * notes verbatim; only items that were never saved take the translation they
 * were added with, so changing the active translation later never rewrites a
 * saved service.
 */
export function toItemInputs(
  items: QueueItem[],
  translationOf: (id: number) => string | null = () => null,
  active: ActiveTranslations = { primary: null, secondary: null }
): ItemInput[] {
  const bg = (i: QueueItem) => ({
    // Fields from a newer version or a service file that this build does not edit: kept as they were.
    ...(i.payload_extra ?? {}),
    ...(i.background ? { background_media_id: i.background.media_id } : {}),
    ...(typeof i.planned_minutes === "number" && i.planned_minutes > 0 ? { planned_minutes: i.planned_minutes } : {}),
    ...(i.end_by && isClockTime(i.end_by) ? { end_by: i.end_by } : {}),
    ...(cleanName(i.prepared_by) ? { prepared_by: cleanName(i.prepared_by) } : {}),
    ...(cleanComments(i.comments).length ? { comments: cleanComments(i.comments) } : {}),
  })
  return items.map((i): ItemInput =>
    isImageItem(i)
      ? {
          id: i.id,
          kind: "image",
          reference: i.image.name,
          book_number: null,
          chapter: null,
          verse: null,
          translation: null,
          secondary_translation: null,
          notes: i.notes ?? null,
          payload: JSON.stringify({ media_id: i.image.media_id, fit: i.image.fit, ...(i.image.loop ? { loop: true } : {}), ...(i.image.sound === false ? { sound: false } : {}), ...bg(i) } satisfies ImageItemPayload & { background_media_id?: string }),
        }
      : isSlideItem(i)
      ? {
          id: i.id,
          kind: "slide",
          reference: i.slide.title.trim() || i.slide.body.split("\n")[0]?.trim() || "Slide",
          book_number: null,
          chapter: null,
          verse: null,
          translation: null,
          secondary_translation: null,
          notes: i.notes ?? null,
          payload: JSON.stringify({ title: i.slide.title, body: i.slide.body, ...(i.slide.link ? { link: i.slide.link } : {}), ...bg(i) } satisfies SlideItemPayload & { background_media_id?: string }),
        }
      : isVerseItem(i)
      ? {
          id: i.id,
          kind: "verse",
          reference: i.reference,
          book_number: i.verse.book_number,
          chapter: i.verse.chapter,
          verse: i.verse.verse,
          translation: i.translation === undefined ? translationOf(i.verse.translation_id) : i.translation,
          secondary_translation: i.secondary_translation === undefined ? active.secondary : i.secondary_translation,
          notes: i.notes ?? null,
          ...(Object.keys(bg(i)).length ? { payload: JSON.stringify(bg(i)) } : {}),
        }
      : {
          id: i.id,
          kind: "song",
          reference: i.song.title,
          book_number: null,
          chapter: null,
          verse: null,
          translation: null,
          secondary_translation: null,
          notes: i.notes ?? null,
          payload: JSON.stringify({
            song_id: i.song.song_id,
            arrangement_id: i.song.arrangement_id,
            languages: i.song.languages,
            ...bg(i),
          } satisfies SongItemPayload & { background_media_id?: string }),
        }
  )
}

/** 24-hour "HH:MM". */
export const isClockTime = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/**
 * A short name as the crate accepts it: control characters (a pasted tab)
 * become spaces, runs of space collapse, and it is cut at 60 whole
 * characters (never half an emoji).
 */
export function cleanName(raw: string | null | undefined): string {
  if (!raw) return ""
  // eslint-disable-next-line no-control-regex
  return Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 60).join("").trim()
}

/** The payload keys this build reads and writes, per item kind; anything else is kept untouched (FR-03). */
const COMMON_PAYLOAD_KEYS = ["background_media_id", "planned_minutes", "end_by", "prepared_by", "comments"]
const KNOWN_PAYLOAD_KEYS: Record<string, Set<string>> = {
  verse: new Set(COMMON_PAYLOAD_KEYS),
  image: new Set([...COMMON_PAYLOAD_KEYS, "media_id", "fit", "loop", "sound"]),
  slide: new Set([...COMMON_PAYLOAD_KEYS, "title", "body", "link"]),
  song: new Set([...COMMON_PAYLOAD_KEYS, "song_id", "arrangement_id", "languages"]),
}

/** Payload keys this build does not know for that kind (from a newer version or a service file), to write back unchanged. */
export function parsePayloadExtra(raw: string | null | undefined, kind: string): Record<string, unknown> | undefined {
  const known = KNOWN_PAYLOAD_KEYS[kind] ?? new Set(COMMON_PAYLOAD_KEYS)
  if (!raw) return undefined
  try {
    const p = JSON.parse(raw) as unknown
    if (typeof p !== "object" || p === null || Array.isArray(p)) return undefined
    const extra = Object.fromEntries(Object.entries(p).filter(([k]) => !known.has(k)))
    return Object.keys(extra).length ? extra : undefined
  } catch {
    return undefined
  }
}

/** `prepared_by` from any item's payload (CL-007). */
export function parsePreparedBy(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { prepared_by?: unknown }
    return typeof p.prepared_by === "string" ? cleanName(p.prepared_by) || null : null
  } catch {
    return null
  }
}

/** `end_by` from any item's payload. */
export function parseEndBy(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { end_by?: unknown }
    return typeof p.end_by === "string" && isClockTime(p.end_by) ? p.end_by : null
  } catch {
    return null
  }
}

/** `planned_minutes` from any item's payload. */
export function parsePlannedMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { planned_minutes?: unknown }
    return typeof p.planned_minutes === "number" && p.planned_minutes > 0 ? p.planned_minutes : null
  } catch {
    return null
  }
}

/** `background_media_id` from any item's payload; the name is filled in from the library later. */
export function parseBackground(raw: string | null | undefined): { media_id: string; name: string } | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as { background_media_id?: unknown }
    return typeof p.background_media_id === "string" && p.background_media_id ? { media_id: p.background_media_id, name: "" } : null
  } catch {
    return null
  }
}

/** The picture payload of a stored item, or null when it is not well-formed. */
export function parseImagePayload(raw: string | null | undefined): { media_id: string; fit: "cover" | "contain" | "stretch"; loop?: boolean; sound?: boolean } | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<ImageItemPayload>
    if (typeof p.media_id !== "string" || !p.media_id) return null
    const fit = p.fit === "contain" || p.fit === "stretch" ? p.fit : "cover"
    return { media_id: p.media_id, fit, ...(p.loop === true ? { loop: true } : {}), ...(p.sound === false ? { sound: false } : {}) }
  } catch {
    return null
  }
}

/** The custom-slide payload of a stored item, or null when it is not well-formed. */
export function parseSlidePayload(raw: string | null | undefined): SlideItemPayload | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<SlideItemPayload>
    const title = typeof p.title === "string" ? p.title : ""
    const body = typeof p.body === "string" ? p.body : ""
    const link = typeof p.link === "string" ? safeLink(p.link) : null
    return title.trim() || body.trim() || link ? { title, body, ...(link ? { link } : {}) } : null
  } catch {
    return null
  }
}

/** The song payload of a stored item, or null when it is not well-formed. */
export function parseSongPayload(raw: string | null | undefined): SongItemPayload | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<SongItemPayload>
    if (typeof p.song_id !== "string" || !p.song_id) return null
    return {
      song_id: p.song_id,
      arrangement_id: typeof p.arrangement_id === "string" ? p.arrangement_id : null,
      languages: Array.isArray(p.languages) ? p.languages.filter((l): l is string => typeof l === "string") : [],
    }
  } catch {
    return null
  }
}

function isStoredVerse(it: ProgramItem): boolean {
  return (
    it.kind === "verse" &&
    typeof it.book_number === "number" && it.book_number > 0 &&
    typeof it.chapter === "number" && it.chapter > 0 &&
    typeof it.verse === "number" && it.verse > 0
  )
}

const findTranslation = (translations: Translation[], abbrev: string | null): Translation | undefined =>
  abbrev === null ? undefined : translations.find((t) => t.abbreviation.toLowerCase() === abbrev.toLowerCase())

/**
 * Pure: stored items → rundown items. Only well-formed items of a supported
 * kind become rundown entries; everything else is returned separately and is
 * never silently turned into a verse. Translation, secondary and notes are
 * carried onto the rundown item verbatim. A pinned translation that is not
 * installed falls back to the active one for text lookup only and is listed
 * in `missingTranslations`; the item still remembers it for the next save.
 */
export function toQueueItems(
  data: ProgramWithItems,
  translationId: number,
  translations: Translation[] = []
): { items: QueueItem[]; unsupported: ProgramItem[]; missingTranslations: string[] } {
  const items: QueueItem[] = []
  const unsupported: ProgramItem[] = []
  const missing = new Set<string>()
  for (const it of data.items) {
    if (it.kind === "image") {
      const image = parseImagePayload(it.payload)
      if (!image) {
        unsupported.push(it)
        continue
      }
      items.push({ id: it.id, kind: "image", image: { media_id: image.media_id, name: it.reference, fit: image.fit, ...(image.loop ? { loop: true } : {}), ...(image.sound === false ? { sound: false } : {}) }, reference: it.reference, confidence: 1, source: "manual", added_at: Date.now(), notes: it.notes, background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), prepared_by: parsePreparedBy(it.payload), comments: parseComments(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind) })
      continue
    }
    if (it.kind === "slide") {
      const slide = parseSlidePayload(it.payload)
      if (!slide) {
        unsupported.push(it)
        continue
      }
      items.push({ id: it.id, kind: "slide", slide, reference: it.reference, confidence: 1, source: "manual", added_at: Date.now(), notes: it.notes, background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), prepared_by: parsePreparedBy(it.payload), comments: parseComments(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind) })
      continue
    }
    if (it.kind === "song") {
      const payload = parseSongPayload(it.payload)
      if (!payload) {
        unsupported.push(it)
        continue
      }
      items.push({
        id: it.id,
        kind: "song",
        song: { song_id: payload.song_id, title: it.reference, arrangement_id: payload.arrangement_id ?? null, languages: payload.languages ?? [] },
        reference: it.reference,
        confidence: 1,
        source: "manual",
        added_at: Date.now(),
        notes: it.notes,
        background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), prepared_by: parsePreparedBy(it.payload), comments: parseComments(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind),
      })
      continue
    }
    if (!(SUPPORTED_ITEM_KINDS as readonly string[]).includes(it.kind) || !isStoredVerse(it)) {
      unsupported.push(it)
      continue
    }
    const pinned = findTranslation(translations, it.translation)
    if (it.translation !== null && !pinned) missing.add(it.translation)
    if (it.secondary_translation !== null && !findTranslation(translations, it.secondary_translation)) missing.add(it.secondary_translation)
    items.push({
      id: it.id,
      kind: "verse",
      verse: {
        id: 0,
        translation_id: pinned?.id ?? translationId,
        book_number: it.book_number!,
        book_name: it.reference.replace(/\s+\d+:\d+$/, ""),
        book_abbreviation: "",
        chapter: it.chapter!,
        verse: it.verse!,
        text: "",
      },
      reference: it.reference,
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
      translation: it.translation,
      secondary_translation: it.secondary_translation,
      notes: it.notes,
      background: parseBackground(it.payload), planned_minutes: parsePlannedMinutes(it.payload), end_by: parseEndBy(it.payload), prepared_by: parsePreparedBy(it.payload), comments: parseComments(it.payload), payload_extra: parsePayloadExtra(it.payload, it.kind),
    })
  }
  return { items, unsupported, missingTranslations: [...missing] }
}

/**
 * What a save persists (exactly the items a save writes), so every saved
 * field counts as a change; verse text and timestamps are not part of it.
 */
export function rundownSignature(items: QueueItem[]): string {
  return JSON.stringify(toItemInputs(items))
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_SERVICE_KEY, id)
    else localStorage.removeItem(CURRENT_SERVICE_KEY)
  } catch {
    // convenience only
  }
}

export function rememberedServiceId(): string | null {
  try {
    return localStorage.getItem(CURRENT_SERVICE_KEY)
  } catch {
    return null
  }
}

function describe(e: unknown): string {
  if (isContentCommandError(e)) return e.message
  return e instanceof Error ? e.message : String(e)
}

// Baseline the dirty flag compares against: the rundown as last loaded/saved.
let baseline = ""
/** With no service open: the operator's items as they were when the last service closed (or none). */
let closedBaseline = "[]"
const operatorItems = (items: QueueItem[]) => items.filter((i) => i.source === "manual")

/**
 * A rundown the operator built or changed with no service open: unsaved
 * work for the close question. Items kept from a service just closed are
 * not; heard verses collected by themselves never are.
 */
export function unsavedScratch(items: QueueItem[], current: Program | null): boolean {
  if (current) return false
  const mine = operatorItems(items)
  return mine.length > 0 && rundownSignature(mine) !== closedBaseline // an empty rundown is nothing to lose
}
// Monotonic save ticket so a slow, older save cannot overwrite a newer one.
let saveGeneration = 0

const translationAbbrev = (id: number): string | null =>
  useBibleStore.getState().translations.find((t) => t.id === id)?.abbreviation ?? null

const activeTranslations = (): ActiveTranslations => {
  const b = useBibleStore.getState()
  return {
    primary: translationAbbrev(b.activeTranslationId),
    secondary: b.secondaryTranslationId === null ? null : translationAbbrev(b.secondaryTranslationId),
  }
}

export const useServiceStore = create<ServiceState>((set, get) => ({
  programs: [],
  current: null,
  dirty: false,
  loading: false,
  saving: false,
  error: null,
  conflict: null,
  unsupportedItems: [],
  missingTranslations: [],

  loadPrograms: async () => {
    set({ loading: true })
    try {
      const programs = await invoke<Program[]>("content_list_programs")
      set({ programs, error: null })
      return true
    } catch (e) {
      set({ error: describe(e) })
      return false
    } finally {
      set({ loading: false })
    }
  },

  createProgram: async (title, serviceDate, opts) => {
    if (get().dirty && !opts?.discard) return null
    try {
      const program = await invoke<Program>("content_create_program", { title, serviceDate })
      set((s) => ({ programs: [program, ...s.programs], error: null }))
      return program
    } catch (e) {
      set({ error: describe(e) })
      return null
    }
  },

  createFromRundown: async (title, serviceDate, opts) => {
    if (get().current && get().dirty && !opts?.discard) return "unsaved"
    const program = await get().createProgram(title, serviceDate, { discard: true })
    if (!program) return "failed"
    baseline = "" // the rundown is not yet what the database has
    set({ current: program, dirty: useQueueStore.getState().items.length > 0, conflict: null, unsupportedItems: [], missingTranslations: [] })
    remember(program.id)
    if (!get().dirty) return "created"
    const saved = await get().saveCurrent()
    return saved === "saved" ? "created" : "created_unsaved"
  },

  listRevisions: async () => {
    const current = get().current
    if (!current) return []
    try {
      return await invoke<RevisionSummary[]>("content_list_revisions", { programId: current.id })
    } catch (e) {
      set({ error: describe(e) })
      return []
    }
  },

  approve: async () => {
    const current = get().current
    if (!current) return "error"
    if (get().dirty) return "unsaved"
    try {
      const program = await invoke<Program>("content_approve_program", { id: current.id, expectedRevision: current.revision })
      set((s) => ({ current: program, programs: s.programs.map((p) => (p.id === program.id ? program : p)), error: null }))
      return "ok"
    } catch (e) {
      if (isContentCommandError(e) && e.kind === "conflict") {
        set({ conflict: { expected: e.expected ?? current.revision, actual: e.actual ?? -1 }, error: e.message })
        return "conflict"
      }
      set({ error: describe(e) })
      return "error"
    }
  },

  restoreRevision: async (revisionId) => {
    const current = get().current
    if (!current) return "error"
    if (get().dirty) return "unsaved"
    try {
      await invoke<ProgramWithItems>("content_restore_revision", { programId: current.id, expectedRevision: current.revision, revisionId })
    } catch (e) {
      if (isContentCommandError(e) && e.kind === "conflict") {
        set({ conflict: { expected: e.expected ?? current.revision, actual: e.actual ?? -1 }, error: e.message })
        return "conflict"
      }
      set({ error: describe(e) })
      return "error"
    }
    return get().openProgram(current.id, { discard: true })
  },

  updateDetails: async (title, serviceDate) => {
    const current = get().current
    if (!current) return "failed"
    try {
      const program = await invoke<Program>("content_update_program", { id: current.id, expectedRevision: current.revision, title, serviceDate })
      // Only this service's record changed; a newer save or open owns the state if it moved on meanwhile.
      if (get().current?.id === program.id) set({ current: program, error: null })
      void get().loadPrograms()
      return "ok"
    } catch (e) {
      set({ error: describe(e) })
      return isContentCommandError(e) && e.kind === "conflict" ? "conflict" : "failed"
    }
  },

  setArchived: async (id, archived) => {
    try {
      const program = await invoke<Program>("content_set_program_archived", { id, archived })
      if (get().current?.id === id) set({ current: { ...get().current!, archived_at: program.archived_at } })
      await get().loadPrograms()
      return true
    } catch (e) {
      set({ error: describe(e) })
      return false
    }
  },

  setTemplate: async (id, template) => {
    try {
      const program = await invoke<Program>("content_set_program_template", { id, template })
      if (get().current?.id === id) set({ current: { ...get().current!, is_template: program.is_template } })
      await get().loadPrograms()
      return true
    } catch (e) {
      set({ error: describe(e) })
      return false
    }
  },

  newFromTemplate: async (templateId, title, serviceDate) => {
    if (get().dirty) return "unsaved"
    // The template is read, never opened: nothing on this path can save into it.
    let data: ProgramWithItems | null = null
    try {
      data = await invoke<ProgramWithItems | null>("content_get_program", { id: templateId })
    } catch (e) {
      set({ error: describe(e) })
      return "failed"
    }
    if (!data) {
      set({ error: "That template no longer exists" })
      return "failed"
    }
    const bible = useBibleStore.getState()
    const { items, unsupported } = toQueueItems(data, bible.activeTranslationId, bible.translations)
    if (unsupported.length > 0) {
      set({ error: `The template has ${unsupported.length} item${unsupported.length === 1 ? "" : "s"} this version cannot copy. Open it in a newer Rhema Studio, or remove them there.` })
      return "failed"
    }
    const before = useQueueStore.getState().items
    useQueueStore.setState({ items: items.map((i) => ({ ...i, id: crypto.randomUUID() })), activeIndex: null })
    const r = await get().createFromRundown(title, serviceDate, { discard: true })
    if (r === "failed") {
      useQueueStore.setState({ items: before, activeIndex: null }) // nothing was created: the screen goes back as it was
      return r
    }
    // Reload the new service so verse text is filled in for Preview.
    const created = get().current
    if (created && r === "created") await get().openProgram(created.id, { discard: true })
    return r
  },

  duplicateCurrent: async (title, serviceDate) => {
    if (!get().current) return "failed"
    if (get().dirty) return "unsaved"
    // Fresh ids: the copy must never share item identity with the original.
    const before = useQueueStore.getState().items
    const copies = before.map((i) => ({ ...i, id: crypto.randomUUID() }))
    useQueueStore.setState({ items: copies, activeIndex: null })
    const r = await get().createFromRundown(title, serviceDate, { discard: true })
    // Nothing was created: put the original's items back, so a later Save cannot renumber the original.
    if (r === "failed") useQueueStore.setState({ items: before, activeIndex: null })
    return r
  },

  openProgram: async (id, opts) => {
    if (get().dirty && !opts?.discard) return "unsaved"
    set({ loading: true })
    try {
      const data = await invoke<ProgramWithItems | null>("content_get_program", { id })
      if (!data) {
        set({ error: "That service no longer exists" })
        if (get().current?.id === id) {
          closedBaseline = rundownSignature(operatorItems(useQueueStore.getState().items))
          set({ current: null, dirty: false })
          remember(null)
        }
        return "missing"
      }
      const bible = useBibleStore.getState()
      const { items, unsupported, missingTranslations } = toQueueItems(data, bible.activeTranslationId, bible.translations)
      baseline = rundownSignature(items)
      useQueueStore.setState({ items, activeIndex: null })
      set({ current: data.program, dirty: false, error: null, conflict: null, unsupportedItems: unsupported, missingTranslations })
      remember(data.program.id)
      // Fill in verse text so preview works before anything is presented.
      // Text is not part of the signature, so this never marks dirty.
      await Promise.all(
        items.filter(isVerseItem).map(async (item) => {
          try {
            const v = await invoke<Verse | null>("get_verse", {
              translationId: item.verse.translation_id,
              bookNumber: item.verse.book_number,
              chapter: item.verse.chapter,
              verse: item.verse.verse,
            })
            if (v?.text) useQueueStore.getState().backfillText(item.id, v.text)
          } catch {
            // Leave empty; presentVerse refetches on present anyway.
          }
        })
      )
      return "ok"
    } catch (e) {
      set({ error: describe(e) })
      return "error"
    } finally {
      set({ loading: false })
    }
  },

  saveCurrent: async () => {
    const current = get().current
    if (!current) return "nothing"
    if (get().saving) return "nothing"
    if (get().unsupportedItems.length > 0) {
      set({
        error: `This service has ${get().unsupportedItems.length} item(s) this version cannot edit; saving would remove them.`,
      })
      return "unsupported"
    }
    const generation = ++saveGeneration
    const snapshotItems = useQueueStore.getState().items
    const snapshot = rundownSignature(snapshotItems)
    set({ saving: true, conflict: null })
    try {
      const data = await invoke<ProgramWithItems>("content_replace_items", {
        programId: current.id,
        expectedRevision: current.revision,
        items: toItemInputs(snapshotItems, translationAbbrev, activeTranslations()),
      })
      if (generation !== saveGeneration) return "saved" // a newer save owns the state now
      if (get().current?.id !== current.id) return "saved" // discarded or another service opened meanwhile: do not link it back
      // What was saved is the new baseline; edits made meanwhile stay dirty.
      baseline = snapshot
      set((s) => ({
        current: data.program,
        dirty: rundownSignature(useQueueStore.getState().items) !== snapshot,
        error: null,
        programs: s.programs.map((p) => (p.id === data.program.id ? data.program : p)),
      }))
      return "saved"
    } catch (e) {
      if (generation !== saveGeneration) return "failed"
      if (isContentCommandError(e) && e.kind === "conflict") {
        set({
          conflict: { expected: e.expected ?? current.revision, actual: e.actual ?? -1 },
          error: "This service was changed elsewhere since you opened it. Reload it to see the latest, or keep editing and reload later.",
        })
        return "conflict"
      }
      set({ error: describe(e) })
      return "failed"
    } finally {
      if (generation === saveGeneration) set({ saving: false })
    }
  },

  deleteProgram: async (id, opts) => {
    const s = get()
    if (s.current?.id === id && s.dirty && !opts?.discard) return "unsaved"
    const target = s.programs.find((p) => p.id === id) ?? (s.current?.id === id ? s.current : null)
    if (!target) return "failed"
    try {
      await invoke("content_delete_program", { id, expectedRevision: target.revision })
      set((st) => ({
        programs: st.programs.filter((p) => p.id !== id),
        ...(st.current?.id === id ? { current: null, dirty: false, conflict: null, unsupportedItems: [], missingTranslations: [] } : {}),
        error: null,
      }))
      if (get().current === null) remember(null)
      return "deleted"
    } catch (e) {
      set({ error: describe(e) })
      return isContentCommandError(e) && e.kind === "conflict" ? "conflict" : "failed"
    }
  },

  closeProgram: (opts) => {
    if (get().dirty && !opts?.discard) return "unsaved"
    // The rundown stays on screen: as it is now it belongs to a saved service (or was just discarded).
    closedBaseline = rundownSignature(operatorItems(useQueueStore.getState().items))
    set({ current: null, dirty: false, conflict: null, unsupportedItems: [], missingTranslations: [] })
    remember(null)
    return "closed"
  },
}))

// Any rundown change while a service is open makes it dirty; a change that
// brings it back to the baseline makes it clean again.
function recheckDirty() {
  const svc = useServiceStore.getState()
  if (!svc.current || svc.loading) return
  const dirty = rundownSignature(useQueueStore.getState().items) !== baseline
  if (dirty !== svc.dirty) useServiceStore.setState({ dirty })
}
useQueueStore.subscribe(recheckDirty)
// Edits made while a load was running (a rename refreshing the list, verse text filling in) count once it ends.
useServiceStore.subscribe((s, prev) => {
  if (prev.loading && !s.loading) recheckDirty()
})
