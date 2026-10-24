import { eventStarts, eventTimes } from "@/lib/journal"
import { clockText } from "@/lib/run-of-show"
import { serviceTiming } from "@/lib/timing-engine"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { monotonicNow } from "@/stores/timer-store"
import { useServiceOffset } from "@/stores/service-offset-store"
import { countdownLine, countdownTarget, countdownTargets, steadyTargets } from "@/lib/countdown"

/**
 * Keeps the stage display's "Ends 10:42 · 5 min late" (issue #196): the run of show's timing
 * engine, looked at again when the rundown, the log or what is live changes, and every 15 s.
 * The stage is sent again only when the line changes. The same timing gives what "time until"
 * clocks count down to (#196 R2), kept beside it and sent on only when a target moves.
 */
let last = ""

export function updateStageFinish() {
  const q = useQueueStore.getState()
  const b = useBroadcastStore.getState()
  const entries = useJournalStore.getState().entries
  const now = Math.max(Date.now(), entries.at(-1)?.at ?? 0)
  const t = serviceTiming({
    items: q.items,
    headers: q.headers,
    firstOnAir: eventStarts(entries),
    onAirMs: eventTimes(entries, Math.max(monotonicNow(), entries.at(-1)?.mono ?? 0)),
    liveItemId: useEventClock.getState().currentId,
    now,
    adjustMinutes: useServiceOffset.getState().minutes,
  })
  const targets = steadyTargets(b.countdowns, countdownTargets(t), now)
  if (JSON.stringify(targets) !== JSON.stringify(b.countdowns)) {
    b.setCountdowns(targets)
    refreshStageCountdown(now)
  }
  const end = t ? new Date(t.expectedEnd) : null
  const finish = t && end ? { time: clockText(end.getHours() * 60 + end.getMinutes()), lateMin: Math.round(t.lateMs / 60_000) } : null
  const key = JSON.stringify(finish)
  if (key === last) return
  last = key
  b.setStageFinish(finish)
}

/** The stage's countdown line, when its design shows one: worked out each second, sent only when its text changes. */
export function refreshStageCountdown(now = Date.now()) {
  const b = useBroadcastStore.getState()
  const to = b.stageStyle.countdown
  const target = to ? countdownTarget(b.countdowns, to) : null
  const line = to && target ? countdownLine(to, target, now) : null
  if (JSON.stringify(line) !== JSON.stringify(b.stageCountdown)) b.setStageCountdown(line)
}

useQueueStore.subscribe((s, prev) => { if (s.items !== prev.items || s.headers !== prev.headers) updateStageFinish() })
useJournalStore.subscribe((s, prev) => { if (s.entries !== prev.entries) updateStageFinish() })
useEventClock.subscribe((s, prev) => { if (s.currentId !== prev.currentId) updateStageFinish() })
useServiceOffset.subscribe((s, prev) => { if (s.minutes !== prev.minutes) updateStageFinish() })
useBroadcastStore.subscribe((s, prev) => { if (s.stageStyle !== prev.stageStyle) refreshStageCountdown() })
setInterval(updateStageFinish, 15_000)
setInterval(() => refreshStageCountdown(), 1_000)
