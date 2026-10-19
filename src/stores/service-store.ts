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
  Verse,
} from "@/types"
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

  loadPrograms: () => Promise<boolean>
  /** Create an empty service and open it. Refuses while another service has unsaved changes. */
  createProgram: (title: string, serviceDate: string | null, opts?: Discard) => Promise<Program | null>
  /** Create a service from the rundown on screen and save it. */
  createFromRundown: (title: string, serviceDate: string | null, opts?: Discard) => Promise<CreateResult>
  /** Load a service into the rundown. Refuses while there are unsaved changes unless `discard`. */
  openProgram: (id: string, opts?: Discard) => Promise<OpenResult>
  /** Save the rundown as the current service's items. */
  saveCurrent: () => Promise<SaveResult>
  deleteProgram: (id: string, opts?: Discard) => Promise<DeleteResult>
  /** Detach the rundown from the saved service (keeps the rundown on screen). */
  closeProgram: (opts?: Discard) => CloseResult
}

/** Pure: rundown items → what the database stores. Ids keep item identity. */
export function toItemInputs(items: QueueItem[], translationOf: (id: number) => string | null = () => null): ItemInput[] {
  return items.map((i) => ({
    id: i.id,
    kind: "verse",
    reference: i.reference,
    book_number: i.verse.book_number,
    chapter: i.verse.chapter,
    verse: i.verse.verse,
    translation: translationOf(i.verse.translation_id),
    secondary_translation: null,
    notes: null,
  }))
}

function isVerseItem(it: ProgramItem): boolean {
  return (
    it.kind === "verse" &&
    typeof it.book_number === "number" && it.book_number > 0 &&
    typeof it.chapter === "number" && it.chapter > 0 &&
    typeof it.verse === "number" && it.verse > 0
  )
}

/**
 * Pure: stored items → rundown items. Only well-formed items of a supported
 * kind become rundown entries; everything else is returned separately and is
 * never silently turned into a verse.
 */
export function toQueueItems(
  data: ProgramWithItems,
  translationId: number
): { items: QueueItem[]; unsupported: ProgramItem[] } {
  const items: QueueItem[] = []
  const unsupported: ProgramItem[] = []
  for (const it of data.items) {
    if (!(SUPPORTED_ITEM_KINDS as readonly string[]).includes(it.kind) || !isVerseItem(it)) {
      unsupported.push(it)
      continue
    }
    items.push({
      id: it.id,
      kind: "verse",
      verse: {
        id: 0,
        translation_id: translationId,
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
    })
  }
  return { items, unsupported }
}

/** What a save persists; verse text and timestamps are not part of it. */
export function rundownSignature(items: QueueItem[]): string {
  return items
    .map((i) => `${i.id}|${i.kind ?? "verse"}|${i.reference}|${i.verse.book_number}:${i.verse.chapter}:${i.verse.verse}`)
    .join("\n")
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
// Monotonic save ticket so a slow, older save cannot overwrite a newer one.
let saveGeneration = 0

const translationAbbrev = (id: number): string | null =>
  useBibleStore.getState().translations.find((t) => t.id === id)?.abbreviation ?? null

export const useServiceStore = create<ServiceState>((set, get) => ({
  programs: [],
  current: null,
  dirty: false,
  loading: false,
  saving: false,
  error: null,
  conflict: null,
  unsupportedItems: [],

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
    set({ current: program, dirty: useQueueStore.getState().items.length > 0, conflict: null, unsupportedItems: [] })
    remember(program.id)
    if (!get().dirty) return "created"
    const saved = await get().saveCurrent()
    return saved === "saved" ? "created" : "created_unsaved"
  },

  openProgram: async (id, opts) => {
    if (get().dirty && !opts?.discard) return "unsaved"
    set({ loading: true })
    try {
      const data = await invoke<ProgramWithItems | null>("content_get_program", { id })
      if (!data) {
        set({ error: "That service no longer exists" })
        if (get().current?.id === id) {
          set({ current: null, dirty: false })
          remember(null)
        }
        return "missing"
      }
      const translationId = useBibleStore.getState().activeTranslationId
      const { items, unsupported } = toQueueItems(data, translationId)
      baseline = rundownSignature(items)
      useQueueStore.setState({ items, activeIndex: null })
      set({ current: data.program, dirty: false, error: null, conflict: null, unsupportedItems: unsupported })
      remember(data.program.id)
      // Fill in verse text so preview works before anything is presented.
      // Text is not part of the signature, so this never marks dirty.
      await Promise.all(
        items.map(async (item) => {
          try {
            const v = await invoke<Verse | null>("get_verse", {
              translationId,
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
        items: toItemInputs(snapshotItems, translationAbbrev),
      })
      if (generation !== saveGeneration) return "saved" // a newer save owns the state now
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
        ...(st.current?.id === id ? { current: null, dirty: false, conflict: null, unsupportedItems: [] } : {}),
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
    set({ current: null, dirty: false, conflict: null, unsupportedItems: [] })
    remember(null)
    return "closed"
  },
}))

// Any rundown change while a service is open makes it dirty; a change that
// brings it back to the baseline makes it clean again.
useQueueStore.subscribe((state) => {
  const svc = useServiceStore.getState()
  if (!svc.current || svc.loading) return
  const dirty = rundownSignature(state.items) !== baseline
  if (dirty !== svc.dirty) useServiceStore.setState({ dirty })
})
