import { useEffect, useState } from "react"
import { actualByItem, firstOnAir } from "@/lib/journal"
import { serviceTiming } from "@/lib/timing-engine"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { monotonicNow } from "@/stores/timer-store"

/**
 * The run of show's timing for any view (issue #196): one engine, the same numbers in Prepare
 * and Present. Looks again every 15 s, since the live item's time and what is expected move on.
 */
export function useServiceTiming(adjustMinutes = 0) {
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const entries = useJournalStore((s) => s.entries)
  const liveItemId = useBroadcastStore((s) => (s.isLive ? s.liveItemId : null))
  const [now, setNow] = useState(() => monotonicNow())
  const [wall, setWall] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => { setNow(monotonicNow()); setWall(Date.now()) }, 15_000)
    return () => clearInterval(t)
  }, [])
  const first = firstOnAir(entries)
  const onAir = actualByItem(entries, Math.max(now, entries.at(-1)?.mono ?? 0))
  const timing = serviceTiming({ items, headers, firstOnAir: first, onAirMs: onAir, liveItemId, now: Math.max(wall, entries.at(-1)?.at ?? 0), adjustMinutes })
  return { timing, first, onAir }
}
