import { invoke } from "@tauri-apps/api/core"
import { songQueueItem } from "@/lib/lyrics"
import { parseTypedReference } from "@/lib/quick-search"
import { findSongByTitle } from "@/lib/song-request"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import type { NoticeAction } from "@/stores/notices-store"
import type { Verse } from "@/types"

/**
 * Queue on an action request (Rhema Comms C2, #251): the verse or the song asked for goes into this
 * computer's run of show for later, where any added item goes (the top, or the section being added
 * to). Nothing is shown and Preview does not change. Null when it was added, else why not.
 */
export async function queueRequest(a: NoticeAction): Promise<string | null> {
  if (a.kind === "song") {
    const song = await findSongByTitle(a.value)
    if (!song) return "that song is not in the library"
    useQueueStore.getState().addItem(songQueueItem(song))
    return null
  }
  if (a.kind !== "bible") return "only a verse or a song can be queued"
  const bible = useBibleStore.getState()
  const ref = parseTypedReference(a.value, bible.books)
  if (!ref) return "that is not a Bible reference"
  const verse = await invoke<Verse | null>("get_verse", { translationId: bible.activeTranslationId ?? 1, bookNumber: ref.book.book_number, chapter: ref.chapter, verse: ref.verse }).catch(() => null)
  if (!verse?.text?.trim()) return "that verse was not found"
  useQueueStore.getState().addItem({ id: crypto.randomUUID(), verse, reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`, confidence: 1, source: "manual", added_at: Date.now() })
  return null
}
