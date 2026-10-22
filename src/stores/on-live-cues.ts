import { CUE_ACTIONS } from "@/lib/cues"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

/**
 * An item's go-live message and cue (issue #193), run once as the item goes on air for the
 * congregation: not in rehearsal, not again for each slide of a song, a Restore or a return
 * from a quick screen. Nothing here changes what the congregation sees.
 */
let fired: string | null = null

useBroadcastStore.subscribe((s) => {
  // Rehearsal: nothing yet; turning it off with the item still up is when the congregation sees it.
  if (!s.isLive || !s.liveItemId || s.rehearsal || s.liveItemId === fired) return
  fired = s.liveItemId
  const on = useQueueStore.getState().items.find((i) => i.id === s.liveItemId)?.on_live
  if (!on) return
  const message = on.stage_message?.trim()
  if (message) useBroadcastStore.getState().setStageMessage(message)
  if (on.cue) void CUE_ACTIONS[on.cue].run()
})
