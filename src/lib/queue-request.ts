import { invoke } from "@tauri-apps/api/core"
import { songQueueItem } from "@/lib/lyrics"
import { parseTypedReference } from "@/lib/quick-search"
import { findSongByTitle } from "@/lib/song-request"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import type { NoticeAction } from "@/stores/notices-store"
import type { QueueItem, Verse } from "@/types"

/**
 * Queue on an action request (Rhema Comms C2, #251): the verse or the song asked for goes into this
 * computer's run of show for later: into the event the desk named (#409), else where any added item
 * goes (the top, or the section being added to). Nothing is shown and Preview does not change. Null
 * when it was added, else why not.
 */
export async function queueRequest(a: NoticeAction, event?: string | null): Promise<string | null> {
  // An event the desk chose that the plan no longer has: said so, never put somewhere else (#409).
  if (event && !useQueueStore.getState().headers.some((h) => h.id === event && h.event)) return "that event is no longer in the plan"
  if (a.kind === "song") {
    const song = await findSongByTitle(a.value)
    if (!song) return "that song is not in the library"
    addInto(songQueueItem(song), event)
    return null
  }
  if (a.kind !== "bible") return "only a verse or a song can be queued"
  const bible = useBibleStore.getState()
  const ref = parseTypedReference(a.value, bible.books)
  if (!ref) return "that is not a Bible reference"
  const verse = await invoke<Verse | null>("get_verse", { translationId: bible.activeTranslationId ?? 1, bookNumber: ref.book.book_number, chapter: ref.chapter, verse: ref.verse }).catch(() => null)
  if (!verse?.text?.trim()) return "that verse was not found"
  addInto({ id: crypto.randomUUID(), verse, reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`, confidence: 1, source: "manual", added_at: Date.now() }, event)
  return null
}

/**
 * Into the plan's event a desk named (#409), at its end; none named: where the main desk adds an
 * item. The main desk's own choice of section is left as it was.
 */
function addInto(item: QueueItem, event?: string | null) {
  const q = useQueueStore.getState()
  const target = event && q.headers.some((h) => h.id === event && h.event) ? event : null
  if (!target) return void q.addItem(item)
  const before = q.addTarget
  q.setAddTarget(target)
  try {
    useQueueStore.getState().addItem(item, "end")
  } finally {
    useQueueStore.getState().setAddTarget(before)
  }
}
