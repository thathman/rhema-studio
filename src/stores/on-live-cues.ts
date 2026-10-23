import { CUE_ACTIONS } from "@/lib/cues"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"

/**
 * An item's message and cue (issue #193), run once as its event starts on the event clock
 * (ADR 0001, C03): by default that is when the item goes on air for the congregation, as before;
 * with the clock run on its own, when the timekeeper starts it. Never in rehearsal, never again for
 * a Restore, a slide of the same song or a return from a quick screen.
 */
useEventClock.subscribe((s, prev) => {
  if (!s.currentId || s.currentId === prev.currentId || useBroadcastStore.getState().rehearsal) return
  const on = useQueueStore.getState().items.find((i) => i.id === s.currentId)?.on_live
  if (!on) return
  const message = on.stage_message?.trim()
  if (message) useBroadcastStore.getState().setStageMessage(message)
  if (on.cue) void CUE_ACTIONS[on.cue].run()
})
