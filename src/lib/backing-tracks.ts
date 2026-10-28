import type { QueueItem, SongQueueItem } from "@/types"
import { isSongItem } from "@/types"

/**
 * The song a backing track would be for (FR-06 "per-song track
 * association"): the song on air, else the rundown item the operator is on.
 * Playing is always a deliberate click; nothing starts by itself.
 */
export function currentSong(items: QueueItem[], liveItemId: string | null, activeIndex: number | null): SongQueueItem | null {
  const live = liveItemId ? items.find((i) => i.id === liveItemId) : undefined
  if (live && isSongItem(live)) return live
  const active = activeIndex !== null ? items[activeIndex] : undefined
  return active && isSongItem(active) ? active : null
}
