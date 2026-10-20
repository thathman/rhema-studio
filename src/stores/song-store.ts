import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import type { Hymnbook, HymnbookInput, SongInput, SongSummary, SongWithSections } from "@/types"

interface SongState {
  /** Loaded songs by id. Presenting reads from here; saves refresh it. */
  songs: Record<string, SongWithSections>
  /** Ids a load found missing (deleted or from another computer's library). */
  missing: string[]
  hymnbooks: Hymnbook[]
  /** Last library search. */
  query: string
  results: SongSummary[]
  searching: boolean
  error: string | null

  /** Load (or return cached) full song. Null when it no longer exists. */
  load: (id: string, opts?: { refresh?: boolean }) => Promise<SongWithSections | null>
  search: (query: string, limit?: number) => Promise<SongSummary[]>
  loadHymnbooks: () => Promise<Hymnbook[]>
  create: (input: SongInput) => Promise<SongWithSections>
  update: (id: string, expectedRevision: number, input: SongInput) => Promise<SongWithSections>
  remove: (id: string, expectedRevision: number) => Promise<void>
  upsertHymnbook: (input: HymnbookInput) => Promise<Hymnbook>
}

let searchSeq = 0

export const useSongStore = create<SongState>((set, get) => ({
  songs: {},
  missing: [],
  hymnbooks: [],
  query: "",
  results: [],
  searching: false,
  error: null,

  load: async (id, opts = {}) => {
    const cached = get().songs[id]
    if (cached && !opts.refresh) return cached
    const song = await invoke<SongWithSections | null>("content_get_song", { id })
    if (song) set((s) => ({ songs: { ...s.songs, [id]: song }, missing: s.missing.filter((m) => m !== id) }))
    else set((s) => {
      const songs = { ...s.songs }
      delete songs[id]
      return { songs, missing: s.missing.includes(id) ? s.missing : [...s.missing, id] }
    })
    return song
  },

  search: async (query, limit = 50) => {
    const ticket = ++searchSeq
    set({ query, searching: true, error: null })
    try {
      const results = await invoke<SongSummary[]>("content_list_songs", { query: query.trim() || null, limit })
      if (ticket === searchSeq) set({ results, searching: false })
      return results
    } catch (e) {
      if (ticket === searchSeq) set({ searching: false, error: e instanceof Error ? e.message : String(e) })
      return []
    }
  },

  loadHymnbooks: async () => {
    const hymnbooks = await invoke<Hymnbook[]>("content_list_hymnbooks")
    set({ hymnbooks })
    return hymnbooks
  },

  create: async (input) => {
    const song = await invoke<SongWithSections>("content_create_song", { input })
    set((s) => ({ songs: { ...s.songs, [song.song.id]: song } }))
    return song
  },

  update: async (id, expectedRevision, input) => {
    const song = await invoke<SongWithSections>("content_update_song", { id, expectedRevision, input })
    set((s) => ({ songs: { ...s.songs, [id]: song } }))
    return song
  },

  remove: async (id, expectedRevision) => {
    await invoke("content_delete_song", { id, expectedRevision })
    set((s) => {
      const songs = { ...s.songs }
      delete songs[id]
      return { songs, results: s.results.filter((r) => r.id !== id) }
    })
  },

  upsertHymnbook: async (input) => {
    const book = await invoke<Hymnbook>("content_upsert_hymnbook", { input })
    await get().loadHymnbooks()
    return book
  },
}))
