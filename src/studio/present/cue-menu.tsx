import { ListChecksIcon, PlayIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CUE_ACTIONS, MACROS, runMacro } from "@/lib/cues"

/** Cues: one press runs a few ordinary actions in order; the steps are shown first. */
export function CueMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" title="Cues: several actions in one press">
          <ListChecksIcon className="size-3.5" /> Cues
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <ul className="flex flex-col gap-2">
          {MACROS.map((m) => (
            <li key={m.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                </div>
                <Button size="sm" onClick={() => runMacro(m.id)}><PlayIcon /> Run</Button>
              </div>
              <ol className="mt-1 flex flex-wrap gap-1 text-[0.6875rem] text-muted-foreground">
                {m.steps.map((s, i) => <li key={`${s}-${i}`} className="rounded border border-border px-1.5">{i + 1}. {CUE_ACTIONS[s].label}</li>)}
              </ol>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
