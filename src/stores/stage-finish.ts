import { clockAt } from "@/lib/church-time"
import { serviceTiming } from "@/lib/timing-engine"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceOffset } from "@/stores/service-offset-store"
import { useHold } from "@/stores/hold-store"
import { useSettingsStore } from "@/stores/settings-store"
import { timingInputNow } from "@/stores/timing-input"
import { useTimingTrust } from "@/stores/timing-trust-store"
import { countdownLine, countdownTarget, countdownTargets, steadyTargets } from "@/lib/countdown"
import { updateCountdownTiming } from "@/stores/countdown-sources"

/**
 * Keeps the stage display's "Ends 10:42 · 5 min late" (issue #196): the run of show's timing
 * engine, looked at again when the rundown, the log or what is live changes, and every 15 s.
 * The stage is sent again only when the line changes. The same timing gives what "time until"
 * clocks count down to (#196 R2), kept beside it and sent on only when a target moves.
 */
let last = ""

export function updateStageFinish() {
  const b = useBroadcastStore.getState()
  const input = timingInputNow()
  const now = input.now
  const t = serviceTiming(input)
  // The countdown display's "item on now" and "service start" (Design → Countdown).
  updateCountdownTiming(t)
  const targets = steadyTargets(b.countdowns, countdownTargets(t, input.timeZone), now)
  if (JSON.stringify(targets) !== JSON.stringify(b.countdowns)) {
    b.setCountdowns(targets)
    refreshStageCountdown(now)
  }
  // On the church's clock (#196 R1.1).
  const finish = t ? { time: clockAt(t.expectedEnd, input.timeZone), lateMin: Math.round(t.lateMs / 60_000) } : null
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
useServiceOffset.subscribe((s, prev) => { if (s.minutes !== prev.minutes || s.mode !== prev.mode) updateStageFinish() })
useHold.subscribe((s, prev) => { if (s.hold !== prev.hold) updateStageFinish() })
useTimingTrust.subscribe((s, prev) => { if (s.untrusted !== prev.untrusted) updateStageFinish() })
useSettingsStore.subscribe((s, prev) => { if (s.setup.timeZone !== prev.setup.timeZone) updateStageFinish() })
useBroadcastStore.subscribe((s, prev) => { if (s.stageStyle !== prev.stageStyle) refreshStageCountdown() })
setInterval(updateStageFinish, 15_000)
setInterval(() => refreshStageCountdown(), 1_000)
