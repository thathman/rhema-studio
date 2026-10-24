import { presentSlide } from "@/hooks/use-broadcast"
import { songQueueItem } from "@/lib/lyrics"
import { actingAs, currentActor } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { useSongStore } from "@/stores/song-store"
import type { SongSummary } from "@/types"

/**
 * A song or hymn asked for by title (Rhema Comms C2): found in this computer's library (songs and
 * the hymn book) and shown from its first slide, or put in Preview only. The main desk runs it for
 * its own requests and for a joined desk's (song_show / song_preview).
 */

/** The song or hymn in the library with exactly this title (any case), or null. */
export async function findSongByTitle(title: string): Promise<SongSummary | null> {
  const want = title.trim().toLowerCase()
  if (!want) return null
  const found = await useSongStore.getState().lookup(title.trim(), 50).catch(() => [] as SongSummary[])
  return found.find((s) => s.title.trim().toLowerCase() === want) ?? null
}

/** Why a song asked for did not go up, by how presenting it ended. */
const NOT_SHOWN: Record<string, string> = {
  empty: "it has no lyrics to show",
  held_for_approval: "it is waiting for approval",
  superseded: "something else was shown first",
}

/** Show the song or hymn with this title, or put it in Preview only: null when done, else why not. */
export async function songRequest(title: string, mode: "show" | "preview"): Promise<string | null> {
  // Who asked (a joined desk's request is theirs), taken now: it is only known while its handler runs.
  const by = currentActor()
  const song = await findSongByTitle(title)
  if (!song) return "that song is not in the library"
  // Not a rundown item: a song asked for on the spot, like one found with Quick find.
  const item = songQueueItem(song, `notice-${song.id}`)
  if (mode === "preview") {
    useBibleStore.getState().selectSlide({ item, index: 0 })
    void useSongStore.getState().load(song.id).catch(() => {})
    return null
  }
  const outcome = await actingAs(by, () => presentSlide(item, 0, { goLive: true })).catch(() => "empty" as const)
  return outcome === "presented" ? null : NOT_SHOWN[outcome] ?? "it was not shown"
}
