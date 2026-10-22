import { PlayIcon, SquareIcon } from "lucide-react"
import { clockText, phaseRange, type OutlineHeader } from "@/lib/run-of-show"
import { usePhaseRun } from "@/stores/phase-run-store"
import { useQueueStore } from "@/stores/queue-store"

const at = (ms: number) => { const d = new Date(ms); return clockText(d.getHours() * 60 + d.getMinutes()) }

/** Start or stop a loop or run-once phase in Present; shows where it is while it runs. */
export function PhaseRunButton({ header }: { header: OutlineHeader }) {
  const run = usePhaseRun((s) => (s.run?.headerId === header.id ? s.run : null))
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  if (header.type !== "phase" || (header.rule !== "loop" && header.rule !== "auto_once")) return null
  const range = phaseRange(items.length, headers, header.id)
  const count = range ? range.end - range.start : 0
  const button = "inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-current/30 hover:bg-current/10 disabled:opacity-40"
  if (!run) {
    const verb = header.rule === "loop" ? "Start loop" : "Run once"
    return (
      <button
        type="button"
        className={button}
        disabled={count === 0}
        onClick={() => usePhaseRun.getState().start(header.id)}
        aria-label={`${verb}: ${header.name}`}
        title={header.rule === "loop" ? `${verb}: its items go live in turn and repeat until you stop it or take something else` : `${verb}: its items go live in turn, each for its planned minutes${header.role === "warmup" ? ", starting when the warm-up is due" : ""}`}
      >
        <PlayIcon className="size-3" />
      </button>
    )
  }
  const index = run.itemId ? items.findIndex((i) => i.id === run.itemId) : -1
  const where = run.startsAt ? `Starts ${at(run.startsAt)}` : range && index >= range.start ? `${index - range.start + 1} of ${count}` : "Starting"
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 tracking-normal normal-case" role="status">
      <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden />
      <span className="font-semibold tabular-nums">{where}</span>
      <button type="button" className={button} onClick={() => usePhaseRun.getState().stop()} aria-label={`Stop ${header.name}`} title="Stop: what is on air stays; nothing else goes up by itself">
        <SquareIcon className="size-2.5" />
      </button>
    </span>
  )
}
