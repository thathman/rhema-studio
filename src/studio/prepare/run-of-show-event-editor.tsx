import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import type { OutlineHeader } from "@/lib/run-of-show"
import { useQueueStore } from "@/stores/queue-store"

/** Editable plan metadata for one event. Plan edits never activate content or alter a live screen. */
export function RunOfShowEventEditor({ header }: { header: OutlineHeader }) {
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

  const update = (patch: Partial<NonNullable<OutlineHeader["event"]>>) => {
    const current = useQueueStore.getState().headers.find((candidate) => candidate.id === header.id)
    if (!current?.event) return
    useQueueStore.getState().updateHeader(header.id, {
      event: { ...current.event, ...patch, approval: "draft" },
    })
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
          <Badge variant="outline">{header.event?.approval === "approved" ? "Approved" : "Draft"}</Badge>
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
            useQueueStore.getState().updateHeader(header.id, { name: value, event: { ...header.event!, approval: "draft" } })
          }}
          className="mt-1.5 h-9 text-base font-semibold"
        />
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <section aria-labelledby={`event-plan-${header.id}`} className="space-y-3">
          <div>
            <h3 id={`event-plan-${header.id}`} className="text-sm font-semibold">Event plan</h3>
            <p className="mt-1 text-xs text-muted-foreground">Who is responsible and what this part of the service is for.</p>
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
                event: { ...current.event, approval: "draft" },
              })
            }}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </section>
      </div>
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
