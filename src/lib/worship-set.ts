import { songQueueItem } from "@/lib/lyrics"
import { findSongByTitle } from "@/lib/song-request"
import { useQueueStore } from "@/stores/queue-store"
import { isSongItem } from "@/types/queue"

/**
 * A Worship desk's change to today's song order (`remote:worship_set`, #410 page 3), on this
 * computer's run of show: move a song, leave it out today (hidden: kept, skipped by Next), sing it
 * again right after itself, or add a library song (by title). The approved plan is not rewritten.
 * Null when done, else why not, for the main desk's toast.
 */
export async function applyWorshipSet(p: Record<string, unknown>): Promise<string | null> {
  const q = useQueueStore.getState()
  const songs = q.items.filter(isSongItem)
  const item = songs.find((i) => i.id === p.item)
  const before = typeof p.before === "string" ? songs.find((i) => i.id === p.before) : undefined
  if (typeof p.before === "string" && !before) return "that place in the song order is gone"
  // Before a song, or after the last song of the set.
  const place = (id: string) => {
    const last = useQueueStore.getState().items.filter(isSongItem).filter((i) => i.id !== id).at(-1)
    const target = before ? { kind: "before" as const, itemId: before.id } : last ? { kind: "after" as const, itemId: last.id } : null
    if (target) useQueueStore.getState().moveItemsToTarget([id], target)
  }
  if (p.op === "insert") {
    if (typeof p.song !== "string" || !p.song.trim()) return "no song was named"
    const found = await findSongByTitle(p.song.slice(0, 120))
    if (!found) return "that song is not in the library"
    const id = useQueueStore.getState().addItem(songQueueItem(found))
    if (!id) return "the song could not be added"
    place(id)
    return null
  }
  if (!item) return "that song is no longer in the service"
  if (p.op === "move") {
    if (before?.id === item.id) return null
    place(item.id)
    return null
  }
  if (p.op === "skip") {
    q.setHidden([item.id], true)
    return null
  }
  if (p.op === "repeat") {
    const id = q.addItem({ ...(JSON.parse(JSON.stringify(item)) as typeof item), id: crypto.randomUUID() })
    if (!id) return "the song could not be repeated"
    useQueueStore.getState().moveItemsToTarget([id], { kind: "after", itemId: item.id })
    return null
  }
  return "that change is not known"
}
