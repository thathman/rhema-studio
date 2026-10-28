import { countdownChoices } from "@/lib/countdown"
import { cn } from "@/lib/utils"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { CountdownTo } from "@/types"

/**
 * What a "time until" clock counts down to (#196 R2): the next item, the end of the main service,
 * or an item's "end by" from the run of show. A choice no longer in the run of show stays listed,
 * so it is never changed behind the operator's back.
 */
export function CountdownSelect({ value, onChange, label, off, className }: { value: CountdownTo | undefined; onChange: (to: CountdownTo | undefined) => void; label: string; off?: string; className?: string }) {
  const targets = useBroadcastStore((s) => s.countdowns)
  const choices = countdownChoices(targets)
  const current = value ?? (off ? "" : "next")
  return (
    <select aria-label={label} value={current} onChange={(e) => onChange((e.target.value || undefined) as CountdownTo | undefined)} className={cn("h-8 rounded-md border border-input bg-card px-1.5", className)}>
      {off && <option value="">{off}</option>}
      {choices.filter((c) => !c.group).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      {/* Any item's start, or a group's end (#196 R2.4). */}
      {choices.some((c) => c.group === "start") && <optgroup label="An item starts">{choices.filter((c) => c.group === "start").map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</optgroup>}
      {choices.some((c) => c.group === "groupend") && <optgroup label="A group ends">{choices.filter((c) => c.group === "groupend").map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</optgroup>}
      {current && !choices.some((c) => c.value === current) && <option value={current}>{current.startsWith("start:") ? "An item's start" : current.startsWith("groupend:") ? "A group's end" : "An item's end by"} (not in this run of show)</option>}
    </select>
  )
}
