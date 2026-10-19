import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { useQueueStore } from "@/stores/queue-store"
import { useBibleStore } from "@/stores/bible-store"
import type { NewProgramItem, Program, ProgramWithItems, QueueItem, Verse } from "@/types"

export const CURRENT_SERVICE_KEY = "rhema-studio.service"

interface ServiceState {
  programs: Program[]
  /** The service whose items are loaded into the rundown, if any. */
  current: Program | null
  /** Rundown changed since it was last loaded from or saved to the database. */
  dirty: boolean
  loading: boolean
  saving: boolean
  /** Last error from the content database, for the UI to show. */
  error: string | null

  loadPrograms: () => Promise<void>
  createProgram: (title: string, serviceDate: string | null) => Promise<Program | null>
  /** Load a service into the rundown. Replaces the current rundown. */
  openProgram: (id: string) => Promise<boolean>
  /** Save the current rundown as the current service's items. */
  saveCurrent: () => Promise<boolean>
  deleteProgram: (id: string) => Promise<boolean>
  /** Detach the rundown from any saved service (does not clear it). */
  closeProgram: () => void
}

/** Pure: rundown items → what the database stores. */
export function toProgramItems(items: QueueItem[]): NewProgramItem[] {
  return items.map((i) => ({
    kind: i.kind ?? "verse",
    reference: i.reference,
    book_number: i.verse.book_number,
    chapter: i.verse.chapter,
    verse: i.verse.verse,
    notes: null,
  }))
}

/** Pure: stored items → rundown items. Verse text is filled in afterwards. */
export function toQueueItems(data: ProgramWithItems, translationId: number): QueueItem[] {
  return data.items.map((it) => ({
    id: it.id,
    kind: "verse",
    verse: {
      id: 0,
      translation_id: translationId,
      book_number: it.book_number ?? 0,
      book_name: it.reference.replace(/\s+\d+:\d+$/, ""),
      book_abbreviation: "",
      chapter: it.chapter ?? 0,
      verse: it.verse ?? 0,
      text: "",
    },
    reference: it.reference,
    confidence: 1,
    source: "manual",
    added_at: Date.now(),
  }))
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

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const useServiceStore = create<ServiceState>((set, get) => ({
  programs: [],
  current: null,
  dirty: false,
  loading: false,
  saving: false,
  error: null,

  loadPrograms: async () => {
    set({ loading: true })
    try {
      const programs = await invoke<Program[]>("content_list_programs")
      set({ programs, error: null })
    } catch (e) {
      set({ error: message(e) })
    } finally {
      set({ loading: false })
    }
  },

  createProgram: async (title, serviceDate) => {
    try {
      const program = await invoke<Program>("content_create_program", {
        title,
        serviceDate,
      })
      set((s) => ({ programs: [program, ...s.programs], error: null }))
      return program
    } catch (e) {
      set({ error: message(e) })
      return null
    }
  },

  openProgram: async (id) => {
    set({ loading: true })
    try {
      const data = await invoke<ProgramWithItems | null>("content_get_program", { id })
      if (!data) {
        set({ error: "That service no longer exists" })
        remember(null)
        return false
      }
      const translationId = useBibleStore.getState().activeTranslationId
      const items = toQueueItems(data, translationId)
      useQueueStore.setState({ items, activeIndex: null })
      set({ current: data.program, dirty: false, error: null })
      remember(data.program.id)
      // Fill in verse text so preview works before anything is presented.
      await Promise.all(
        items.map(async (item) => {
          try {
            const v = await invoke<Verse | null>("get_verse", {
              translationId,
              bookNumber: item.verse.book_number,
              chapter: item.verse.chapter,
              verse: item.verse.verse,
            })
            if (v?.text) {
              useQueueStore.getState().backfillText(item.id, v.text)
            }
          } catch {
            // Leave text empty; presentVerse refetches on present anyway.
          }
        })
      )
      // Backfill is not an edit.
      set({ dirty: false })
      return true
    } catch (e) {
      set({ error: message(e) })
      return false
    } finally {
      set({ loading: false })
    }
  },

  saveCurrent: async () => {
    const current = get().current
    if (!current) return false
    set({ saving: true })
    try {
      const data = await invoke<ProgramWithItems>("content_replace_items", {
        programId: current.id,
        items: toProgramItems(useQueueStore.getState().items),
      })
      set((s) => ({
        current: data.program,
        dirty: false,
        error: null,
        programs: s.programs.map((p) => (p.id === data.program.id ? data.program : p)),
      }))
      return true
    } catch (e) {
      set({ error: message(e) })
      return false
    } finally {
      set({ saving: false })
    }
  },

  deleteProgram: async (id) => {
    try {
      await invoke("content_delete_program", { id })
      set((s) => ({
        programs: s.programs.filter((p) => p.id !== id),
        ...(s.current?.id === id ? { current: null, dirty: false } : {}),
        error: null,
      }))
      if (get().current === null) remember(null)
      return true
    } catch (e) {
      set({ error: message(e) })
      return false
    }
  },

  closeProgram: () => {
    set({ current: null, dirty: false })
    remember(null)
  },
}))

// Any rundown change while a service is open makes it dirty. Text backfill
// keeps the same item ids and references, so compare the parts that are saved.
let lastSignature = ""
export function rundownSignature(items: QueueItem[]): string {
  return items.map((i) => `${i.kind ?? "verse"}|${i.reference}|${i.verse.book_number}:${i.verse.chapter}:${i.verse.verse}`).join("\n")
}
useQueueStore.subscribe((state) => {
  const sig = rundownSignature(state.items)
  if (sig === lastSignature) return
  lastSignature = sig
  const svc = useServiceStore.getState()
  if (svc.current && !svc.loading && !svc.dirty) {
    useServiceStore.setState({ dirty: true })
  }
})
