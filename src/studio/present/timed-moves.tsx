import { useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { useTimedAdvance } from "@/stores/timed-advance-store"

/** Present's switch for items that move on by themselves, with the time left to the next move. */
export function TimedMoves() {
  const on = useTimedAdvance((s) => s.on)
  const dueAt = useTimedAdvance((s) => s.dueAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!dueAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [dueAt])
  const left = dueAt ? Math.max(0, Math.ceil((dueAt - now) / 1000)) : null
  return (
    <label
      className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground"
      title="Timed moves: items marked in Prepare to move on by themselves go to the next item of their phase after their planned minutes. Off at every start; anything you do to what is live cancels the pending move."
    >
      {left !== null && <span className="font-semibold text-foreground tabular-nums" role="timer" aria-label={`Next item in ${Math.floor(left / 60)} minutes ${left % 60} seconds`}>Next in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>}
      <span>Timed moves</span>
      <Switch checked={on} onCheckedChange={(v) => useTimedAdvance.getState().setOn(v)} aria-label="Timed moves" />
    </label>
  )
}
