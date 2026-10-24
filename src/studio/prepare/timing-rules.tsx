import { FlagIcon } from "lucide-react"
import { cleanItemTiming, DEFAULT_WARN_MINUTES } from "@/lib/item-timing"
import { formatDuration } from "@/lib/run-of-show"
import { useQueueStore } from "@/stores"
import type { ItemTiming, QueueItem } from "@/types"
import { DurationInput } from "@/studio/prepare/item-editor-parts"

const WARN_CHOICES = [1, 2, 3, 5, 10]

function setRules(id: string, patch: Partial<ItemTiming>) {
  // A milestone has no minutes: cleared with it, so every total and the plan agree.
  useQueueStore.getState().updateItem(id, (i) => ({ ...i, ...(patch.milestone ? { planned_minutes: null } : {}), timing: cleanItemTiming({ ...(i.timing ?? {}), ...patch }) }))
}

/**
 * An item's timing rules (#196 R1.2/R1.3), under its planned time: a milestone (a moment with no
 * minutes, such as "Livestream begins"), a soft end (it may run on to a longer time before it
 * counts as over) and its own warning (when its timer turns amber and the stage warns). None of
 * them changes a screen.
 */
export function TimingRules({ item }: { item: QueueItem }) {
  const label = "mb-0.5 block text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
  const rules = cleanItemTiming(item.timing)
  const milestone = rules?.milestone === true
  const planned = item.planned_minutes ?? 0
  const soft = rules?.soft_end_minutes
  return (
    <div className="ml-7 space-y-1 border-t border-border/60 py-2 pl-2 text-xs">
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          className="size-4"
          checked={milestone}
          aria-label={`${item.reference} is a milestone`}
          onChange={(e) => setRules(item.id, e.target.checked ? { milestone: true, soft_end_minutes: undefined, warn_minutes: undefined } : { milestone: undefined })}
        />
        <FlagIcon className="size-3.5" aria-hidden />
        A milestone: a moment, with no time of its own
      </label>
      {milestone ? (
        <p className="text-muted-foreground">It takes no minutes{planned ? ` (its ${formatDuration(planned)} planned are not counted)` : ""}: what follows starts as it is reached, and it is marked reached once something after it starts. Countdowns can count to it as the next item.</p>
      ) : (
        <>
          <div className="grid grid-cols-[6.5rem_7rem] gap-2">
            <label className="min-w-0">
              <span className={label} title="The longest it may run before it counts as over">May run to</span>
              <DurationInput
                aria-label={`Soft end for ${item.reference}`}
                minutes={soft ?? null}
                onChange={(m) => setRules(item.id, { soft_end_minutes: m ?? undefined })}
              />
            </label>
            <label className="min-w-0">
              <span className={label}>Warn before end</span>
              <select
                aria-label={`Warning before the end of ${item.reference}`}
                value={rules?.warn_minutes ?? ""}
                onChange={(e) => setRules(item.id, { warn_minutes: e.target.value ? Number(e.target.value) : undefined })}
                className="h-7 w-full rounded-md border border-input bg-card px-1.5"
              >
                <option value="">As usual ({DEFAULT_WARN_MINUTES} min)</option>
                {WARN_CHOICES.map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
          </div>
          <p className="text-muted-foreground">
            {soft && soft > planned
              ? `A soft end: ${planned ? formatDuration(planned) : "its planned time"} is the aim, and it counts as over only after ${formatDuration(soft)}. What follows is still timed from the plan.`
              : soft
                ? "The soft end is not longer than the planned time, so it changes nothing."
                : "Without a soft end it counts as over once its planned time is up."}
            {rules?.warn_minutes ? ` Its timer turns amber, and the stage warns, ${rules.warn_minutes} min before the end.` : ""}
          </p>
        </>
      )}
    </div>
  )
}
