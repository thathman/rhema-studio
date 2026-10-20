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
  /** Every song (cached for a minute) for the typo-tolerant fallback. */
  all: () => Promise<SongSummary[]>
  loadHymnbooks: () => Promise<Hymnbook[]>
  create: (input: SongInput) => Promise<SongWithSections>
  update: (id: string, expectedRevision: number, input: SongInput) => Promise<SongWithSections>
  remove: (id: string, expectedRevision: number) => Promise<void>
  upsertHymnbook: (input: HymnbookInput) => Promise<Hymnbook>
  /** Removes the book and its numbers; the songs stay. */
  deleteHymnbook: (id: string) => Promise<void>
}

let searchSeq = 0
let allCache: { at: number; songs: SongSummary[] } | null = null
export const invalidateSongList = () => { allCache = null }

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

  all: async () => {
    if (allCache && Date.now() - allCache.at < 60_000) return allCache.songs
    const songs = await invoke<SongSummary[]>("content_list_songs", { query: null, limit: 1000 })
    allCache = { at: Date.now(), songs }
    return songs
  },

  loadHymnbooks: async () => {
    const hymnbooks = await invoke<Hymnbook[]>("content_list_hymnbooks")
    set({ hymnbooks })
    return hymnbooks
  },

  create: async (input) => {
    invalidateSongList()
    const song = await invoke<SongWithSections>("content_create_song", { input })
    set((s) => ({ songs: { ...s.songs, [song.song.id]: song } }))
    return song
  },

  update: async (id, expectedRevision, input) => {
    invalidateSongList()
    const song = await invoke<SongWithSections>("content_update_song", { id, expectedRevision, input })
    set((s) => ({ songs: { ...s.songs, [id]: song } }))
    return song
  },

  remove: async (id, expectedRevision) => {
    invalidateSongList()
    await invoke("content_delete_song", { id, expectedRevision })
    set((s) => {
      const songs = { ...s.songs }
      delete songs[id]
      return { songs, results: s.results.filter((r) => r.id !== id) }
    })
  },

  deleteHymnbook: async (id) => {
    await invoke("content_delete_hymnbook", { id })
    invalidateSongList()
    await get().loadHymnbooks()
  },

  upsertHymnbook: async (input) => {
    const book = await invoke<Hymnbook>("content_upsert_hymnbook", { input })
    await get().loadHymnbooks()
    return book
  },
}))
