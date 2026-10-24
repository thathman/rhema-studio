import { useServiceOffset } from "@/stores/service-offset-store"
import { useEffect, useState } from "react"
import { serviceTiming } from "@/lib/timing-engine"
import { useEventClock } from "@/stores/event-clock-store"
import { useHold } from "@/stores/hold-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { runStateNow, timingInputNow } from "@/stores/timing-input"
import { useTimingTrust } from "@/stores/timing-trust-store"

/**
 * The run of show's timing for any view (issue #196): one engine, the same numbers in Prepare
 * and Present. Looks again every 15 s, since the live item's time and what is expected move on,
 * and whenever the rundown, the log, the event, the offset, a hold, the church's time zone or the
 * trust in the running item's time change.
 */
export function useServiceTiming() {
  // Each of these changing means the times are worked out again.
  useServiceOffset((s) => s.minutes)
  useServiceOffset((s) => s.mode)
  useQueueStore((s) => s.items)
  useQueueStore((s) => s.headers)
  useJournalStore((s) => s.entries)
  useEventClock((s) => s.currentId)
  useHold((s) => s.hold)
  useTimingTrust((s) => s.untrusted)
  useSettingsStore((s) => s.setup.timeZone)
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  const input = timingInputNow()
  const timing = serviceTiming(input)
  return { timing, first: input.firstOnAir, onAir: input.onAirMs, zone: input.timeZone ?? "", state: runStateNow() }
}
