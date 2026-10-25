import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import type { Program, SongWithSections } from "@/types"
import { useSongStore } from "@/stores/song-store"

/**
 * The approved service's songs (#193): approving a service pins each of its songs at the words it
 * had then. A song edited in the library afterwards is "changed since approval", and Present keeps
 * showing the approved words unless the operator chooses the new ones for this service (or the
 * service is approved again, which pins the new words). Prepare edits the library song as before.
 */
interface SongPinsState {
  /** The open service these pins belong to. */
  programId: string | null
  /** Approved words by song id. */
  pins: Record<string, SongWithSections>
  /** Songs the operator chose to show with the library's newer words in this service. */
  latest: string[]
  setLatest: (songId: string, on: boolean) => void
}

export const useSongPins = create<SongPinsState>((set) => ({
  programId: null,
  pins: {},
  latest: [],
  setLatest: (songId, on) => set((s) => ({ latest: on ? [...new Set([...s.latest, songId])] : s.latest.filter((id) => id !== songId) })),
}))

let loadSeq = 0

/** Load the pins of a service (none for one never approved). A newer load wins. */
export async function loadSongPins(program: Pick<Program, "id" | "approved_revision"> | null): Promise<void> {
  const ticket = ++loadSeq
  // Another service, or this one approved again (which pins the words chosen): no choice of newer words stands.
  if (!program || program.approved_revision === null || program.approved_revision === undefined) {
    useSongPins.setState({ programId: program?.id ?? null, pins: {}, latest: [] })
    return
  }
  let songs: SongWithSections[] = []
  try {
    songs = (await invoke<SongWithSections[] | null>("content_approved_songs", { programId: program.id })) ?? []
  } catch (e) {
    console.warn("[song-pins] approved songs not loaded:", e)
  }
  if (ticket !== loadSeq) return
  useSongPins.setState({ programId: program.id, pins: Object.fromEntries(songs.map((s) => [s.song.id, s])), latest: [] })
}

/** The approved words of a song when they apply (pinned, and the operator has not chosen the new ones). */
export function pinnedSong(songId: string, s: Pick<SongPinsState, "pins" | "latest"> = useSongPins.getState()): SongWithSections | undefined {
  return s.latest.includes(songId) ? undefined : s.pins[songId]
}

/** The words Present uses for a song of this service: the approved ones, else the library's. */
export function serviceSongNow(songId: string): SongWithSections | undefined {
  return pinnedSong(songId) ?? useSongStore.getState().songs[songId]
}

/** Present's song for a song id, as a hook (re-renders when either the pin or the library changes). */
export function useServiceSong(songId: string | null | undefined): SongWithSections | undefined {
  const library = useSongStore((s) => (songId ? s.songs[songId] : undefined))
  const pin = useSongPins((s) => (songId ? pinnedSong(songId, s) : undefined))
  return pin ?? library
}

/**
 * How a song of the approved service stands (#193): "changed" when the library's words are newer
 * than the approved ones (shown with the approved words, unless `usingNew`), else null.
 */
export function useSongApproval(songId: string): { changed: boolean; usingNew: boolean; approvedRevision: number; libraryRevision: number } | null {
  const pin = useSongPins((s) => s.pins[songId])
  const usingNew = useSongPins((s) => s.latest.includes(songId))
  const library = useSongStore((s) => s.songs[songId])
  if (!pin || !library || library.song.revision === pin.song.revision) return null
  return { changed: true, usingNew, approvedRevision: pin.song.revision, libraryRevision: library.song.revision }
}
