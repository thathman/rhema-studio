import { remoteActions } from "@/lib/remote-actions"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"

/**
 * The Standard view's verb set. Thin wrappers over `remoteActions` so the big
 * buttons, the keyboard and OSC/HTTP all do the same thing.
 *
 * Next/Previous/Show live are deliberate operator verbs, so they also put the
 * output on air; Clear takes it off air but keeps the last item for Restore.
 */
export const presentActions = {
  next: () => {
    if (useQueueStore.getState().items.length === 0) return
    useBroadcastStore.getState().setLive(true)
    remoteActions.queueNext()
  },
  prev: () => {
    if (useQueueStore.getState().items.length === 0) return
    useBroadcastStore.getState().setLive(true)
    remoteActions.queuePrev()
  },
  /** Present whatever is in Preview. Marks it active in the rundown when it is there. */
  showLive: () => {
    const selected = useBibleStore.getState().selectedVerse
    if (!selected) return
    const idx = useQueueStore
      .getState()
      .findDuplicate(selected.book_number, selected.chapter, selected.verse)
    if (idx !== -1) useQueueStore.getState().setActive(idx)
    useBroadcastStore.getState().setLive(true)
    remoteActions.sendToLive()
  },
  clear: () => remoteActions.toggleOnAir(false),
  restore: () => {
    if (presentActions.canRestore()) remoteActions.toggleOnAir(true)
  },
  canRestore: () => {
    const s = useBroadcastStore.getState()
    return !s.isLive && s.liveVerse !== null
  },
}
