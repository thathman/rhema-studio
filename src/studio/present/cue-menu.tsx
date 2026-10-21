import { useState } from "react"
import { ListChecksIcon, PlayIcon, PlusIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { allMacros, CUE_ACTIONS, macroIdFor, MACROS, runSteps, type CueId } from "@/lib/cues"
import { useSettingsStore } from "@/stores/settings-store"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"

const ACTION_IDS = Object.keys(CUE_ACTIONS) as CueId[]

/** Cues: one press runs a few ordinary actions in order; the steps are shown first. The church can add its own (PT-003). */
export function CueMenu() {
  const custom = useSettingsStore((s) => s.customMacros)
  const macros = allMacros(custom)
  const builtIn = new Set(MACROS.map((m) => m.id))
  // Built-ins first, then the church's own, each with its own key and (for customs) Delete,
  // even if a later version reused a custom cue's id for a built-in.
  const rows = macros.map((m, i) => ({ m, custom: i >= MACROS.length }))
  const [adding, setAdding] = useState(false)
  return (
    <Popover onOpenChange={(o) => { if (!o) setAdding(false) }}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" title="Cues: several actions in one press">
          <ListChecksIcon className="size-3.5" /> Cues
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] w-96 overflow-y-auto">
        <ul className="flex flex-col gap-2">
          {rows.map(({ m, custom: isCustom }) => (
            <li key={`${isCustom ? "c" : "b"}-${m.id}`} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{!isCustom ? m.description : builtIn.has(m.id) ? "Your cue · its remote id is now taken by a built-in cue; make it again under a new name" : <>Your cue · remote: <code>/rhema/macro {m.id}</code></>}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isCustom && (
                    <ConfirmDelete label={`Delete ${m.label}`} onConfirm={() => useSettingsStore.getState().setCustomMacros(custom.filter((c) => c.id !== m.id))} />
                  )}
                  <Button size="sm" disabled={m.steps.length === 0} onClick={() => runSteps(m.steps)}><PlayIcon /> Run</Button>
                </div>
              </div>
              <ol className="mt-1 flex flex-wrap gap-1 text-[0.6875rem] text-muted-foreground">
                {m.steps.map((s, i) => <li key={`${s}-${i}`} className="rounded border border-border px-1.5">{i + 1}. {CUE_ACTIONS[s].label}</li>)}
              </ol>
            </li>
          ))}
        </ul>
        {adding ? (
          <NewCue taken={macros.map((m) => m.id)} onDone={() => setAdding(false)} />
        ) : (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setAdding(true)}><PlusIcon /> New cue…</Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function NewCue({ taken, onDone }: { taken: string[]; onDone: () => void }) {
  const [label, setLabel] = useState("")
  const [steps, setSteps] = useState<CueId[]>([])
  const [pick, setPick] = useState<CueId>(ACTION_IDS[0])
  const save = () => {
    const s = useSettingsStore.getState()
    s.setCustomMacros([...s.customMacros, { id: macroIdFor(label, taken), label: label.trim(), steps }])
    onDone()
  }
  return (
    <form className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-xs" onSubmit={(e) => { e.preventDefault(); save() }}>
      <label htmlFor="cue-name" className="text-muted-foreground">Name</label>
      <Input id="cue-name" autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Baptism" maxLength={60} className="h-8 text-xs" />
      <span className="text-muted-foreground">Steps, in order</span>
      {steps.length === 0 ? <p className="text-muted-foreground">None yet.</p> : (
        <ol className="flex flex-col gap-1">
          {steps.map((s, i) => (
            <li key={`${s}-${i}`} className="flex items-center gap-2">
              <span className="flex-1">{i + 1}. {CUE_ACTIONS[s].label}</span>
              <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><XIcon /></Button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-1">
        <select aria-label="Action to add" value={pick} onChange={(e) => setPick(e.target.value as CueId)} className="h-8 flex-1 rounded-md border border-input bg-background px-2">
          {ACTION_IDS.map((id) => <option key={id} value={id}>{CUE_ACTIONS[id].label}</option>)}
        </select>
        <Button type="button" size="sm" variant="outline" disabled={steps.length >= 12} onClick={() => setSteps([...steps, pick])}>Add step</Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!label.trim() || steps.length === 0}>Save cue</Button>
      </div>
      <p className="text-muted-foreground">Saved on this computer. A Stream Deck or OSC controller can run it by its id, shown after saving.</p>
    </form>
  )
}
