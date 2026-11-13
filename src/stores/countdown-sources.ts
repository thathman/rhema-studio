import type { ServiceTiming } from "@/lib/timing-engine"
import { itemCounting, itemWarnMs, timerCounting, type CountdownSources } from "@/lib/countdown-display"
import { useAuxTimers } from "@/stores/aux-timers-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"
import { cleanItemTiming } from "@/lib/item-timing"
import { monotonicNow } from "@/stores/timer-store"

/**
 * Keeps what countdown displays can count besides the service timer (Design → Countdown): the
 * extra timers, the item on now and the service start. Sent on only when one of them really
 * changes (started, paused, another item), since the displays count the seconds themselves.
 */
let timing: Pick<CountdownSources, "start"> = { start: null }
let lastTiming: ServiceTiming | null = null
let last = ""

function push() {
  const timers = useAuxTimers.getState().timers
  const current = useQueueStore.getState().items.find((i) => i.id === useEventClock.getState().currentMomentId)
  const warn = itemWarnMs(current)
  // The item on now, counted as its own timer says (#196): down, up or not at all.
  const item = itemCounting(lastTiming, cleanItemTiming(current?.timing)?.timer)
  // The timers as they stand (not as counted now), so a resend happens only on a real change.
  const key = JSON.stringify([timers.map((t) => [t.label, t.timer]), timing, item, warn])
  if (key === last) return
  last = key
  const mono = monotonicNow(), wall = Date.now()
  useBroadcastStore.getState().setCountdownSources({ aux: timers.map((t) => timerCounting(t.label, t.timer, mono, wall)), ...timing, item, ...(warn ? { itemWarnMs: warn } : {}) })
}

/** The run of show's timing, looked at again (stage-finish.ts calls this with what it worked out). */
export function updateCountdownTiming(t: ServiceTiming | null): void {
  lastTiming = t
  timing = { start: t ? t.start : null }
  push()
}

useAuxTimers.subscribe((s, prev) => { if (s.timers !== prev.timers) push() })
useEventClock.subscribe((s, prev) => { if (s.currentId !== prev.currentId || s.currentMomentId !== prev.currentMomentId) push() })
// The item on now's own timer changed in Prepare (#196): counted the new way at once.
useQueueStore.subscribe((s, prev) => { if (s.items !== prev.items) push() })
