import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { allMacros, CUE_ACTIONS, cueImpact, runSteps, type CueId } from "@/lib/cues"
import type { RunOfShowEventCue } from "@/lib/run-of-show"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useJoin } from "@/stores/join-store"
import { useQueueStore } from "@/stores/queue-store"

const knownCue = (step: string): step is CueId => Object.prototype.hasOwnProperty.call(CUE_ACTIONS, step)

function canRunFromHost(eventId: string): boolean {
  return useEventClock.getState().currentId === eventId
    && !useBroadcastStore.getState().rehearsal
    && useJoin.getState().status === "off"
}

/** Event cue snapshots are manual only; elapsed event time never runs one. */
export function EventCuesEditor({ eventId }: { eventId: string }) {
  const currentEventId = useEventClock((state) => state.currentId)
  return <EventCuesEditorSession key={`${eventId}:${currentEventId ?? ""}`} eventId={eventId} />
}

function EventCuesEditorSession({ eventId }: { eventId: string }) {
  const header = useQueueStore((state) => state.headers.find((candidate) => candidate.id === eventId))
  const currentEventId = useEventClock((state) => state.currentId)
  const rehearsal = useBroadcastStore((state) => state.rehearsal)
  const joinStatus = useJoin((state) => state.status)
  const [macroId, setMacroId] = useState("")
  const [armedCueId, setArmedCueId] = useState<string | null>(null)
  const [review, setReview] = useState<{ cueId: string; steps: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const cues = header?.event?.cues ?? []
  const macros = allMacros()
  const selectedMacro = macros.find((macro) => macro.id === macroId) ?? macros[0]
  const hostMayRun = currentEventId === eventId && !rehearsal && joinStatus === "off"

  const writeCues = (next: RunOfShowEventCue[]) => {
    const current = useQueueStore.getState().headers.find((candidate) => candidate.id === eventId)
    if (!current?.event) return
    useQueueStore.getState().updateHeader(eventId, {
      event: { ...current.event, cues: next.length ? next : undefined },
    })
  }

  const addCue = () => {
    if (!selectedMacro || cues.length >= 12) return
    writeCues([...cues, {
      id: crypto.randomUUID(),
      name: selectedMacro.label,
      trigger: "manual",
      steps: [...selectedMacro.steps],
    }])
  }

  const confirmCue = header?.event?.cues?.find((cue) => cue.id === review?.cueId)
  const confirmSteps = confirmCue?.steps.filter(knownCue) ?? []
  const hasUnknownSteps = !!confirmCue && confirmSteps.length !== confirmCue.steps.length
  const impacts = cueImpact(confirmSteps)

  const runConfirmedCue = async () => {
    const freshHeader = useQueueStore.getState().headers.find((candidate) => candidate.id === eventId)
    const freshCue = freshHeader?.event?.cues?.find((cue) => cue.id === review?.cueId)
    if (!review || !freshCue || armedCueId !== freshCue.id || !canRunFromHost(eventId)) {
      setError("This event is no longer active on the main desk. Review the cue again when it is current.")
      return
    }
    if (JSON.stringify(freshCue.steps) !== JSON.stringify(review.steps)) {
      setError("This cue changed after you reviewed it. Close this window and review it again.")
      return
    }
    const steps = freshCue.steps.filter(knownCue)
    if (steps.length !== freshCue.steps.length || steps.length === 0) {
      setError("This cue contains an action this build cannot run. Remove it and add a current cue.")
      return
    }

    setRunning(true)
    setError(null)
    await runSteps(steps)
    setRunning(false)
    setReview(null)
    setArmedCueId(null)
  }

  return (
    <section aria-labelledby={`event-signals-${eventId}`} className="space-y-3">
      <div>
        <h3 id={`event-signals-${eventId}`} className="text-sm font-semibold">Event cues</h3>
        <p className="mt-1 text-xs text-muted-foreground">Manual only. A cue never runs because the event starts, its timer advances, or its planned length ends. When this event is current, the main desk must arm the cue and confirm its effects before it runs.</p>
      </div>

      {cues.length > 0 ? (
        <ul aria-label={`Cues for ${header?.name ?? "event"}`} className="space-y-2">
          {cues.map((cue) => {
            const steps = cue.steps.filter(knownCue)
            const unavailable = steps.length !== cue.steps.length || steps.length === 0
            const armed = armedCueId === cue.id
            return (
              <li key={cue.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{cue.name}</span>
                  <Button
                    size="sm"
                    variant={armed ? "soft" : "outline"}
                    aria-label={`${armed ? "Disarm" : "Arm"} cue: ${cue.name}`}
                    disabled={!hostMayRun}
                    onClick={() => { setError(null); setArmedCueId(armed ? null : cue.id) }}
                  >
                    {armed ? "Armed · disarm" : "Arm"}
                  </Button>
                  <Button
                    size="sm"
                    aria-label={`Review cue: ${cue.name}`}
                    disabled={!armed || !hostMayRun || unavailable}
                    onClick={() => { setError(null); setReview({ cueId: cue.id, steps: [...cue.steps] }) }}
                  >
                    Review and run
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove event cue: ${cue.name}`} onClick={() => writeCues(cues.filter((entry) => entry.id !== cue.id))}>
                    Remove
                  </Button>
                </div>
                <ol className="flex flex-wrap gap-1 text-[0.6875rem] text-muted-foreground" aria-label={`Steps in ${cue.name}`}>
                  {cue.steps.map((step, index) => <li key={`${step}-${index}`} className="rounded border border-border px-1.5">{index + 1}. {knownCue(step) ? CUE_ACTIONS[step].label : "Unavailable action"}</li>)}
                </ol>
                {unavailable && <p role="status" className="text-xs text-confidence-mid">This cue includes an action this build cannot run. It is kept in the saved plan.</p>}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">No event cues yet. Add a saved cue as a snapshot for this event.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`event-cue-choice-${eventId}`} className="sr-only">Cue to add to this event</label>
        <select
          id={`event-cue-choice-${eventId}`}
          aria-label="Cue to add to this event"
          value={selectedMacro?.id ?? ""}
          onChange={(event) => setMacroId(event.currentTarget.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
        >
          {macros.map((macro, index) => <option key={`${index}-${macro.id}`} value={macro.id}>{macro.label}</option>)}
        </select>
        <Button size="sm" variant="outline" aria-label={`Add cue to ${header?.name ?? "event"}`} disabled={!selectedMacro || cues.length >= 12} onClick={addCue}>Add cue snapshot</Button>
      </div>
      {!hostMayRun && <p role="status" className="text-xs text-muted-foreground">To run an event cue, start this event and use the main Rhema Studio computer. Joined desks and rehearsal cannot run it.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      <Dialog open={review !== null} onOpenChange={(open) => { if (!open && !running) setReview(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run {confirmCue?.name ?? "event cue"}?</DialogTitle>
            <DialogDescription>This action runs now on the main production. The existing approval gate still protects any unapproved public scene.</DialogDescription>
          </DialogHeader>
          {confirmCue && (
            <div className="space-y-2">
              <ol className="space-y-1 text-xs" aria-label="Actions that will run">
                {confirmCue.steps.map((step, index) => <li key={`${step}-${index}`}>{index + 1}. {knownCue(step) ? CUE_ACTIONS[step].label : "Unavailable action"}</li>)}
              </ol>
              {impacts.length > 0 && <p className="text-xs text-muted-foreground">It may: {impacts.join(" · ")}</p>}
            </div>
          )}
          {!hostMayRun && <p role="alert" className="text-xs text-destructive">This event is no longer active on the main desk.</p>}
          <DialogFooter>
            <Button variant="outline" disabled={running} onClick={() => setReview(null)}>Cancel</Button>
            <Button aria-label="Run event cue now" disabled={running || !hostMayRun || !confirmCue || hasUnknownSteps || confirmSteps.length === 0} onClick={() => void runConfirmedCue()}>
              {running ? "Running…" : "Run cue now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
