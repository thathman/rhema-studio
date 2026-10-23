import { remainingMs } from "@/lib/timer"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"

/**
 * Time warnings on the stage (#196 R6): as the running timer reaches the stage look's "minutes
 * left", and as its time is up, one message on the stage display. Each fires once per timer run,
 * only as it is crossed (not when a timer is started already past it), never in rehearsal, and
 * never over a message a person sent. Only the stage message changes: no screen, scene or source.
 */
let fired = new Set<string>()
let run = ""
let ours = ""

export function checkStageWarnings(now = monotonicNow()): void {
  const { timer } = useTimerStore.getState()
  const b = useBroadcastStore.getState()
  // A new run: another length, or reset.
  const key = `${timer.durationMs}`
  if (key !== run || (timer.startedAt === null && timer.accumulatedMs === 0)) { run = key; fired = new Set() }
  if (timer.startedAt === null || timer.durationMs === 0 || b.rehearsal) return
  const left = remainingMs(timer, now)
  const at = b.stageStyle.warnAtMinutes * 60_000
  const due: [string, boolean, string][] = [
    ["left", at > 0 && left <= at && left > at - 60_000, `${b.stageStyle.warnAtMinutes} minute${b.stageStyle.warnAtMinutes === 1 ? "" : "s"} left`],
    ["over", b.stageStyle.warnWhenOver && left <= 0 && left > -60_000, "Time is up"],
  ]
  for (const [id, crossing, text] of due) {
    if (!crossing || fired.has(id)) continue
    fired.add(id)
    if (b.stageMessage && b.stageMessage !== ours) continue
    ours = text
    b.setStageMessage(text)
  }
}

useTimerStore.subscribe((s, p) => { if (s.tick !== p.tick || s.timer !== p.timer) checkStageWarnings() })
