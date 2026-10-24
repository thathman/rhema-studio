import { PlayIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { clockText, phaseRange } from "@/lib/run-of-show"
import { usePhaseRun } from "@/stores/phase-run-store"
import { useQueueStore } from "@/stores/queue-store"

const at = (ms: number) => { const d = new Date(ms); return clockText(d.getHours() * 60 + d.getMinutes()) }

/**
 * Present's automated phases (approved design): the loops and the warm-up start and stop here;
 * the main service always stays manual. One runs at a time (issue #193).
 */
export function PhaseStrip() {
  const headers = useQueueStore((s) => s.headers)
  const items = useQueueStore((s) => s.items)
  const run = usePhaseRun((s) => s.run)
  const auto = headers.filter((h) => h.type === "phase" && (h.rule === "loop" || h.rule === "auto_once"))
  if (auto.length === 0) return null
  const running = run ? headers.find((h) => h.id === run.headerId) : null
  const range = running ? phaseRange(items.length, headers, running.id) : null
  const index = run?.itemId ? items.findIndex((i) => i.id === run.itemId) : -1
  const where = !run ? "" : run.startsAt ? `starts ${at(run.startsAt)}` : range && index >= range.start ? `${index - range.start + 1} of ${range.end - range.start}` : "starting"
  return (
    <section aria-label="Automated phases" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[#34504b] bg-[#1b3033] px-3.5 py-2.5 [@media(max-height:860px)]:py-1.5">
      <p className="min-w-0 flex-1 text-xs text-[#c3d6cf]">
        <b className="text-xs text-[#eef6f2]">Automated phases</b>
        <span className="block [@media(max-height:860px)]:hidden">Loops repeat and the warm-up runs once; the main service always stays manual.</span>
      </p>
      {/* Small buttons with a 44 px touch area (touch-hit); the wider row gap keeps two rows' areas apart. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-4">
        {auto.map((h) => {
          const range = phaseRange(items.length, headers, h.id)
          const empty = !range || range.end <= range.start
          const on = run?.headerId === h.id
          return on ? (
            <Button key={h.id} size="sm" className="touch-hit bg-[#c3e6d4] text-[#14352f] hover:bg-[#b3dcc7]" onClick={() => usePhaseRun.getState().stop()}>
              <SquareIcon /> Stop {h.name}
            </Button>
          ) : (
            <Button key={h.id} size="sm" variant="outline" className="touch-hit" disabled={empty} onClick={() => usePhaseRun.getState().start(h.id)} title={empty ? "Nothing in this phase yet" : h.rule === "loop" ? "Its items go live in turn and repeat until you stop it or take something else" : "Its items go live in turn, each for its planned minutes, starting when it is due"}>
              <PlayIcon /> Start {h.name}{h.rule === "auto_once" ? " · once" : ""}
            </Button>
          )
        })}
      </div>
      <span role="status" className="text-[0.6875rem] font-semibold whitespace-nowrap text-[#9bcdbb]">
        {running ? `${running.name} running · ${where}` : "Main service manual · safe"}
      </span>
    </section>
  )
}
