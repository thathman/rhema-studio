import { validTimeZone } from "@/lib/church-time"
import { timedItems } from "@/lib/run-of-show"
import { eventPlanStarts, eventTimes, serviceFinishedAt } from "@/lib/journal"
import { runOfShowClockRows } from "@/lib/run-of-show"
import type { TimingInput } from "@/lib/timing-engine"
import { runState, type RunState } from "@/lib/timing-state"
import { useEventClock } from "@/stores/event-clock-store"
import { holdSpans, useHold } from "@/stores/hold-store"
import { useJournalStore } from "@/stores/journal-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceOffset } from "@/stores/service-offset-store"
import { useSettingsStore } from "@/stores/settings-store"
import { monotonicNow } from "@/stores/timer-store"
import { useTimingTrust } from "@/stores/timing-trust-store"

/** The church's time zone from Setup (#196 R1.1), or "" for this computer's clock. */
export function churchTimeZone(): string {
  return validTimeZone(useSettingsStore.getState().setup.timeZone)
}

/**
 * The timing engine's snapshot of this service now (#196): one place, so Prepare, Present, the
 * stage, the Live State and every desk work out the same times from the same facts.
 */
export function timingInputNow(now = Date.now()): TimingInput {
  const q = useQueueStore.getState()
  const entries = useJournalStore.getState().entries
  const offset = useServiceOffset.getState()
  const schedule = runOfShowClockRows(q.items, q.headers)
  const trust = useTimingTrust.getState().untrusted
  return {
    // Event plans are the schedule rows; legacy items remain individual rows. Hidden items and
    // skipped phases keep their place but take no planned time (#193).
    items: timedItems(schedule.rows, schedule.headers),
    headers: schedule.headers,
    firstOnAir: eventPlanStarts(entries),
    onAirMs: eventTimes(entries, Math.max(monotonicNow(), entries.at(-1)?.mono ?? 0)),
    liveItemId: useEventClock.getState().currentId,
    now: Math.max(now, entries.at(-1)?.at ?? 0),
    adjustMinutes: offset.minutes,
    offsetMode: offset.mode,
    timeZone: churchTimeZone(),
    holds: holdSpans(),
    untrustedId: trust?.eventId ?? trust?.itemId ?? null,
    finishedAt: serviceFinishedAt(entries),
  }
}

/** The service's run state now (#196 R3.7), from the same facts. */
export function runStateNow(): RunState {
  const entries = useJournalStore.getState().entries
  const u = useTimingTrust.getState().untrusted
  const current = useEventClock.getState().currentId
  return runState({
    begun: entries.some((e) => e.kind === "event" && (e.eventId || e.itemId)),
    held: useHold.getState().hold !== null,
    // Not trusted while that item is still the one happening (or nothing has started since).
    untrusted: !!u && (current === (u.eventId ?? u.itemId) || current === null),
    finished: serviceFinishedAt(entries) !== null,
  })
}
