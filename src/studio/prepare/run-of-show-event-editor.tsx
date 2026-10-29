import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { projectRunOfShowEvents, type OutlineHeader } from "@/lib/run-of-show"
import { eventPlanApprovalState } from "@/lib/approval"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useAddDialog } from "@/studio/prepare/add-target"
import { EventCuesEditor } from "@/studio/prepare/event-cues-editor"
import { RunOfShowEventPreview } from "@/studio/prepare/run-of-show-event-preview"
import { LookAndScene, TakeSteps } from "@/studio/prepare/item-editor-parts"
import type { QueueItem } from "@/types"

type RunOfShowEventTab = "content" | "plan" | "scenes" | "preview" | "signals"

/** Editable plan metadata for one event. Plan edits never activate content or alter a live screen. */
export function RunOfShowEventEditor({
  header,
  onOpenMoment,
  defaultTab = "content",
  focusMomentId,
}: {
  header: OutlineHeader
  onOpenMoment: (item: QueueItem) => void
  defaultTab?: RunOfShowEventTab
  focusMomentId?: string | null
}) {
  const items = useQueueStore((state) => state.items)
  const headers = useQueueStore((state) => state.headers)
  const service = useServiceStore((state) => state.current)
  const serviceDirty = useServiceStore((state) => state.dirty)
  const approval = eventPlanApprovalState(service, serviceDirty)
  const moments = projectRunOfShowEvents(items, headers).find((event) => event.id === header.id)?.moments ?? []
  const [activeTab, setActiveTab] = useState<RunOfShowEventTab>(defaultTab)
  const [durationDraft, setDurationDraft] = useState(header.event?.duration_minutes?.toString() ?? "")
  const draftMinutes = durationDraft.trim() ? Number(durationDraft) : null
  const durationError = draftMinutes !== null && (!Number.isFinite(draftMinutes) || draftMinutes <= 0 || draftMinutes > 600)
    ? "Enter a length greater than 0 and no more than 600 minutes."
    : null

  useEffect(() => {
    const sync = (state: ReturnType<typeof useQueueStore.getState>, previous: ReturnType<typeof useQueueStore.getState>) => {
      const next = state.headers.find((candidate) => candidate.id === header.id)?.event?.duration_minutes
      const before = previous.headers.find((candidate) => candidate.id === header.id)?.event?.duration_minutes
      if (next !== before) setDurationDraft(next?.toString() ?? "")
    }
    return useQueueStore.subscribe(sync)
  }, [header.id])

  useEffect(() => {
    if (activeTab !== "scenes" || !focusMomentId) return
    const target = document.getElementById(`event-scene-moment-${focusMomentId}`)
    target?.scrollIntoView?.({ block: "nearest" })
    target?.focus({ preventScroll: true })
  }, [activeTab, focusMomentId, header.id])

  const update = (patch: Partial<NonNullable<OutlineHeader["event"]>>) => {
    const current = useQueueStore.getState().headers.find((candidate) => candidate.id === header.id)
    if (!current?.event) return
    useQueueStore.getState().updateHeader(header.id, { event: { ...current.event, ...patch } })
  }

  const updateText = (field: "role" | "ownership", value: string) => {
    update({ [field]: value || undefined })
  }

  const updateDuration = (value: string) => {
    setDurationDraft(value)
    if (!value) {
      update({ duration_minutes: undefined })
      return
    }
    const minutes = Number(value)
    if (Number.isFinite(minutes) && minutes > 0 && minutes <= 600) update({ duration_minutes: minutes })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <p className="text-[0.6875rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Run of Show event</p>
          <Badge variant="outline" title="Event status follows approval of the saved service revision. It does not authorize a live Take.">
            {approval === "changed" ? "Changed" : approval === "approved" ? "Approved" : "Draft"}
          </Badge>
        </div>
        <label className="mt-3 block text-xs font-semibold text-muted-foreground" htmlFor={`event-title-${header.id}`}>Event name</label>
        <Input
          id={`event-title-${header.id}`}
          aria-label="Event title"
          value={header.name}
          maxLength={120}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (!value.trim()) return
            useQueueStore.getState().updateHeader(header.id, { name: value, event: header.event! })
          }}
          className="mt-1.5 h-9 text-base font-semibold"
        />
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as RunOfShowEventTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-5 mt-3 grid w-[calc(100%-2.5rem)] grid-cols-5">
          <TabsTrigger value="content" aria-label="Event content">Content</TabsTrigger>
          <TabsTrigger value="plan" aria-label="Event plan">Plan</TabsTrigger>
          <TabsTrigger value="scenes" aria-label="Event scenes">Scenes</TabsTrigger>
          <TabsTrigger value="preview" aria-label="Event preview">Preview</TabsTrigger>
          <TabsTrigger value="signals" aria-label="Event signals">Signals</TabsTrigger>
        </TabsList>
        <TabsContent value="content" aria-label="Event content" className="min-h-0 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Moments in this event</h3>
              <p className="mt-1 text-xs text-muted-foreground">These ordered moments belong to this event. Open one to preview and edit it; only a deliberate Take in Present changes an audience output.</p>
            </div>
            {moments.length > 0 ? (
              <ol aria-label="Event moments" className="space-y-2">
                {moments.map((moment, index) => (
                  <li key={moment.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                    <span className="w-7 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{moment.reference}</span>
                      <span className="block text-xs text-muted-foreground">
                        {moment.kind === "song" ? "Song" : moment.kind === "slide" ? "Slide" : moment.kind === "image" ? "Media" : moment.kind === "cue" ? "Production cue" : "Scripture"}
                        {moment.planned_minutes ? ` · ${moment.planned_minutes} min` : ""}
                      </span>
                    </span>
                    <Button variant="outline" size="sm" aria-label={`Open moment ${index + 1}: ${moment.reference} in editor`} onClick={() => onOpenMoment(moment)}>
                      Open
                    </Button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">This event has no moments yet. Add Scripture, a song, a slide, media, or a production cue.</p>
            )}
            <Button variant="outline" onClick={(event) => useAddDialog.getState().openFor(header.id, event.currentTarget)} aria-label={`Add content to ${header.name}`}>
              Add content to event
            </Button>
          </section>
        </TabsContent>
        <TabsContent value="plan" aria-label="Event plan" className="min-h-0 space-y-5 overflow-y-auto px-5 py-4">
          <section aria-labelledby={`event-plan-${header.id}`} className="space-y-3">
            <div>
              <h3 id={`event-plan-${header.id}`} className="text-sm font-semibold">Event plan</h3>
              <p className="mt-1 text-xs text-muted-foreground">Who is responsible and what this part of the service is for. Approval follows the saved service as a whole; changes need approval again. This status does not authorize a live Take.</p>
            </div>
            <Field label="Event role" id={`event-role-${header.id}`}>
              <Input
                id={`event-role-${header.id}`}
                aria-label="Event role"
                value={header.event?.role ?? ""}
                placeholder="For example, Prayer or Sermon"
                maxLength={60}
                onChange={(event) => updateText("role", event.currentTarget.value)}
              />
            </Field>
            <Field label="Owner or lead" id={`event-owner-${header.id}`}>
              <Input
                id={`event-owner-${header.id}`}
                aria-label="Event owner"
                value={header.event?.ownership ?? ""}
                placeholder="Person or team"
                maxLength={60}
                onChange={(event) => updateText("ownership", event.currentTarget.value)}
              />
            </Field>
          </section>

          <section aria-labelledby={`event-timing-${header.id}`} className="space-y-3">
            <div>
              <h3 id={`event-timing-${header.id}`} className="text-sm font-semibold">Timing</h3>
              <p className="mt-1 text-xs text-muted-foreground">Planning estimate only; this does not start a timer or change what is on screen.</p>
            </div>
            <Field label="Planned length (minutes)" id={`event-duration-${header.id}`}>
              <Input
                id={`event-duration-${header.id}`}
                aria-label="Planned event length in minutes"
                type="number"
                min="0.1"
                max="600"
                step="any"
                inputMode="decimal"
                aria-invalid={!!durationError}
                aria-describedby={`event-duration-help-${header.id}`}
                value={durationDraft}
                onChange={(event) => updateDuration(event.currentTarget.value)}
              />
            </Field>
            <p id={`event-duration-help-${header.id}`} className="text-xs text-muted-foreground">
              {durationError ? <span role="alert" className="text-destructive">{durationError}</span> : "Optional estimate. Leave blank if you do not know the length yet."}
            </p>
          </section>

          <section aria-labelledby={`event-notes-heading-${header.id}`} className="space-y-2">
            <h3 id={`event-notes-heading-${header.id}`} className="text-sm font-semibold">Notes for the team</h3>
            <label className="sr-only" htmlFor={`event-notes-${header.id}`}>Event notes</label>
            <textarea
              id={`event-notes-${header.id}`}
              aria-label="Event notes"
              value={header.notes ?? ""}
              maxLength={2000}
              rows={5}
              onChange={(event) => {
                const current = useQueueStore.getState().headers.find((candidate) => candidate.id === header.id)
                if (!current?.event) return
                useQueueStore.getState().updateHeader(header.id, {
                  notes: event.currentTarget.value || null,
                  event: current.event,
                })
              }}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </section>
        </TabsContent>
        <TabsContent value="scenes" aria-label="Event scenes" className="min-h-0 overflow-y-auto px-5 py-4">
          <section aria-labelledby={`event-scenes-${header.id}`} className="space-y-3">
            <div>
              <h3 id={`event-scenes-${header.id}`} className="text-sm font-semibold">Scenes for this event</h3>
              <p className="mt-1 text-xs text-muted-foreground">Plan only. Choose a scene and audience for each moment. These choices are saved with the service; event timing never takes a scene. A moment's scene runs only when an operator deliberately Takes it.</p>
            </div>
            {moments.length > 0 ? moments.map((moment) => (
              <article
                key={moment.id}
                id={`event-scene-moment-${moment.id}`}
                aria-label={`Scene plan for ${moment.reference}`}
                tabIndex={focusMomentId === moment.id ? -1 : undefined}
                className={`rounded-md border border-border px-3 py-2${focusMomentId === moment.id ? " ring-2 ring-primary/50" : ""}`}
              >
                <h4 className="text-sm font-medium">{moment.reference}</h4>
                <LookAndScene item={moment} eventId={header.id} eventTitle={header.name} />
                <TakeSteps item={moment} />
              </article>
            )) : (
              <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">Add a moment to this event before assigning scenes.</p>
            )}
          </section>
        </TabsContent>
        <TabsContent value="preview" aria-label="Event preview" className="min-h-0 overflow-y-auto px-5 py-4">
          <RunOfShowEventPreview eventTitle={header.name} moments={moments} />
        </TabsContent>
        <TabsContent value="signals" aria-label="Event signals" className="min-h-0 overflow-y-auto px-5 py-4">
          <EventCuesEditor eventId={header.id} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium">{label}</label>
      {children}
    </div>
  )
}
