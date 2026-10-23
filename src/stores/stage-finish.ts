import { eventStarts, eventTimes } from "@/lib/journal"
import { clockText } from "@/lib/run-of-show"
import { serviceTiming } from "@/lib/timing-engine"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { monotonicNow } from "@/stores/timer-store"

/**
 * Keeps the stage display's "Ends 10:42 · 5 min late" (issue #196): the run of show's timing
 * engine, looked at again when the rundown, the log or what is live changes, and every 15 s.
 * The stage is sent again only when the line changes.
 */
let last = ""

export function updateStageFinish() {
  const q = useQueueStore.getState()
  const b = useBroadcastStore.getState()
  const entries = useJournalStore.getState().entries
  const t = serviceTiming({
    items: q.items,
    headers: q.headers,
    firstOnAir: eventStarts(entries),
    onAirMs: eventTimes(entries, Math.max(monotonicNow(), entries.at(-1)?.mono ?? 0)),
    liveItemId: useEventClock.getState().currentId,
    now: Math.max(Date.now(), entries.at(-1)?.at ?? 0),
  })
  const end = t ? new Date(t.expectedEnd) : null
  const finish = t && end ? { time: clockText(end.getHours() * 60 + end.getMinutes()), lateMin: Math.round(t.lateMs / 60_000) } : null
  const key = JSON.stringify(finish)
  if (key === last) return
  last = key
  b.setStageFinish(finish)
}

useQueueStore.subscribe((s, prev) => { if (s.items !== prev.items || s.headers !== prev.headers) updateStageFinish() })
useJournalStore.subscribe((s, prev) => { if (s.entries !== prev.entries) updateStageFinish() })
useEventClock.subscribe((s, prev) => { if (s.currentId !== prev.currentId) updateStageFinish() })
setInterval(updateStageFinish, 15_000)
