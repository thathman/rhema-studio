import { useServiceOffset } from "@/stores/service-offset-store"
import { useEffect, useState } from "react"
import { eventStarts, eventTimes } from "@/lib/journal"
import { serviceTiming } from "@/lib/timing-engine"
import { useEventClock } from "@/stores/event-clock-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { monotonicNow } from "@/stores/timer-store"

/**
 * The run of show's timing for any view (issue #196): one engine, the same numbers in Prepare
 * and Present. Looks again every 15 s, since the live item's time and what is expected move on.
 */
export function useServiceTiming() {
  // The shared running-late offset (#196): the same everywhere.
  const adjustMinutes = useServiceOffset((s) => s.minutes)
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const entries = useJournalStore((s) => s.entries)
  // The event happening now, from the event clock (C03), not whatever is on the screens.
  const liveItemId = useEventClock((s) => s.currentId)
  const [now, setNow] = useState(() => monotonicNow())
  const [wall, setWall] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => { setNow(monotonicNow()); setWall(Date.now()) }, 15_000)
    return () => clearInterval(t)
  }, [])
  const first = eventStarts(entries)
  const onAir = eventTimes(entries, Math.max(now, entries.at(-1)?.mono ?? 0))
  const timing = serviceTiming({ items, headers, firstOnAir: first, onAirMs: onAir, liveItemId, now: Math.max(wall, entries.at(-1)?.at ?? 0), adjustMinutes })
  return { timing, first, onAir }
}
