import { elapsedMs, formatMs } from "@/lib/timer"
import { useJournalStore } from "@/stores/journal-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"

/** Reset the service timer, with a line in the service log saying what was wiped (FR-07 "with audit"). */
export function resetTimerLogged(): void {
  const was = elapsedMs(useTimerStore.getState().timer, monotonicNow())
  useTimerStore.getState().reset()
  if (was > 0) useJournalStore.getState().add({ kind: "timing", label: `timer reset (it had run ${formatMs(was)})` })
}
