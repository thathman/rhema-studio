import { useRef, useState } from "react"
import { timeText } from "@/lib/church-time"
import { churchTimeZone } from "@/stores/timing-input"
import { Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { RundownList } from "@/studio/present/rundown-list"
import { SaveState, ServiceBar } from "@/studio/prepare/service-bar"
import { formatMinutes, plannedTotalMs } from "@/lib/service-timing"
import { ItemEditor } from "@/studio/prepare/item-editor"
import { RunOfShowEventEditor } from "@/studio/prepare/run-of-show-event-editor"
import { AddItems } from "@/studio/prepare/add-items"
import { AiDrafts } from "@/studio/prepare/ai-drafts"
import { TimingPanel } from "@/studio/prepare/timing-panel"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"
import { RULE_LABEL, defaultPhases, interleave, newPhase, runOfShowClockRows, sectionSummaries, timedItems, type PhaseRole } from "@/lib/run-of-show"
import { CalendarDaysIcon, ClockIcon, EllipsisIcon, FolderPlusIcon, LayersIcon, LayersPlusIcon, MonitorPlayIcon, ZapIcon } from "lucide-react"
import { RundownTools } from "@/studio/prepare/bulk-bar"
import { useBibleStore } from "@/stores"
import type { CueQueueItem } from "@/types"
import { useShellStore } from "@/studio/shell-store"
import { useServiceTiming } from "@/studio/use-service-timing"
import { presentActions } from "@/studio/present-actions"
import { cn } from "@/lib/utils"
import { AddEventPalette, type EventInsertionTarget } from "@/studio/prepare/add-event-palette"
import { toast } from "sonner"

type RundownView = "simple" | "grouped"
const RUNDOWN_VIEW_KEY = "rhema.prepare.rundown-view.v1"

function storedRundownView(): RundownView {
  try { return window.localStorage.getItem(RUNDOWN_VIEW_KEY) === "simple" ? "simple" : "grouped" } catch { return "grouped" }
}

function todayInChurchZone(now = new Date()): { date: string; label: string } {
  const zone = churchTimeZone() || undefined
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    label: new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: zone }).format(now),
  }
}

/**
 * Service builder: the order of service, the selected item's editor and the
 * preview, with the service's details above. Nothing here can present —
 * Prepare only edits; a click previews. It is the one place a service is
 * built (#299): Present runs it, Production routes it, Design styles it.
 */
export function PrepareWorkspace() {
  const count = useQueueStore((s) => s.items.length)
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const phaseCount = headers.filter((header) => header.type === "phase").length
  const orderRows = runOfShowClockRows(items, headers).rows
  const eventCount = orderRows.filter((row) => row.kind === "event").length
  const looseItemCount = orderRows.filter((row) => row.kind === "item").length
  const orderCountLabel = eventCount > 0
    ? `${eventCount} ${eventCount === 1 ? "event" : "events"}${looseItemCount > 0 ? ` · ${looseItemCount} ${looseItemCount === 1 ? "item" : "items"}` : ""}`
    : `${count} ${count === 1 ? "item" : "items"}`
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const selectedEvent = headers.find((header) => header.id === selectedEventId && header.event)
  const selectedItem = useSelectedItem()
  const [rundownView, setRundownView] = useState<RundownView>(storedRundownView)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const draftCreationInProgress = useRef(false)
  // Hidden items and a skipped phase take no planned time (#193).
  const planned = useQueueStore((s) => formatMinutes(plannedTotalMs(timedItems(s.items, s.headers))))
  const service = useServiceStore((s) => s.current)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [removePhasesOpen, setRemovePhasesOpen] = useState(false)
  // On a narrower window the timing column folds away; this brings it back over the editor.
  const [timingOpen, setTimingOpen] = useState(false)
  const weekday = service?.service_date ? new Date(`${service.service_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }) : null
  const eventTarget: EventInsertionTarget = selectedEvent
    ? { kind: "section", headerId: selectedEvent.id }
    : selectedItem
      ? { kind: "row", itemId: selectedItem.item.id }
      : { kind: "end" }
  const selectAddedItem = (itemId: string) => {
    setSelectedEventId(null)
    const queue = useQueueStore.getState()
    const selectedIndex = queue.items.findIndex((item) => item.id === itemId)
    if (selectedIndex < 0) return
    let phaseId: string | null = null
    let eventId: string | null = null
    let groupId: string | null = null
    const ancestors: string[] = []
    for (const row of interleave(queue.items, queue.headers)) {
      if ("header" in row) {
        if (row.header.type === "phase") { phaseId = row.header.id; eventId = null; groupId = null }
        else if (row.header.event) { eventId = row.header.id; groupId = null }
        else groupId = row.header.id
      } else if (row.index === selectedIndex) {
        if (phaseId) ancestors.push(phaseId)
        if (eventId) ancestors.push(eventId)
        if (groupId) ancestors.push(groupId)
        break
      }
    }
    if (ancestors.some((id) => collapsedSections.has(id))) {
      setCollapsedSections((current) => {
        const next = new Set(current)
        ancestors.forEach((id) => next.delete(id))
        return next.size === current.size ? current : next
      })
    }
  }
  const toggleCollapsedSection = (id: string) => setCollapsedSections((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const changeRundownView = (view: RundownView) => {
    setRundownView(view)
    try { window.localStorage.setItem(RUNDOWN_VIEW_KEY, view) } catch { /* This view choice is optional when storage is unavailable. */ }
  }
  const onEventCreated = async (id: string) => {
    setSelectedEventId(id)
    if (useServiceStore.getState().current || draftCreationInProgress.current) return
    draftCreationInProgress.current = true
    setCreatingDraft(true)
    const queueHeaders = useQueueStore.getState().headers
    const selectedHeaderIndex = queueHeaders.findIndex((header) => header.id === id)
    const today = todayInChurchZone()
    const title = `Service draft — ${today.label}`
    try {
      const result = await useServiceStore.getState().createFromRundown(title, today.date)
      // Creating a service gives every row a fresh ID. Its order is unchanged, so keep the new event selected.
      const savedId = useQueueStore.getState().headers[selectedHeaderIndex]?.id
      if (savedId) setSelectedEventId(savedId)
      if (result === "created") toast.success("Local service draft created", { description: `${title} is saved on this computer.` })
      else toast.error("Local service draft needs attention", { description: useServiceStore.getState().error ?? "The draft could not be saved. Your work is still on screen." })
    } catch (error) {
      toast.error("Local service draft could not be created", { description: error instanceof Error ? error.message : String(error) })
    } finally {
      draftCreationInProgress.current = false
      setCreatingDraft(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-8 pt-6 pb-3 max-[1200px]:px-5 [@media(max-height:860px)]:pt-3 [@media(max-height:860px)]:pb-2">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Plan the whole experience</p>
          <h1 className="mt-1 truncate text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">{weekday ? `${weekday} run of show.` : "Your run of show."}</h1>
          <p className="mt-1 text-xs text-muted-foreground">Service sections, timing, content, signals and team instructions — one coherent timeline. Nothing here goes live.</p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" disabled={count === 0 && headers.length === 0}>
                <Trash2Icon /> Clear service
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="mb-3 text-sm">Clear the whole service order? This removes {orderCountLabel} and its phase settings.</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>Keep</Button>
                <Button variant="destructive" size="sm" onClick={() => { useQueueStore.getState().clearQueue(); setConfirmOpen(false) }}>
                  Clear
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <AiDrafts />
          <AddItems onSelectAddedItem={selectAddedItem} />
          <Button
            variant="outline"
            className="hidden max-[1280px]:inline-flex"
            aria-expanded={timingOpen}
            aria-controls="prepare-timing"
            onClick={() => setTimingOpen((o) => !o)}
          >
            <ClockIcon /> Timing
          </Button>
          <Button
            onClick={() => useShellStore.getState().setWorkspace("present")}
            disabled={count === 0}
            title="Open this same service in the live console. Nothing goes live until you press Take live there."
          >
            <MonitorPlayIcon /> Present service
          </Button>
        </div>
      </header>

      <EventOverview />

      {rundownView === "grouped" && <PhaseStrip />}

      <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)_minmax(16rem,20rem)] gap-4 px-8 pb-6 max-[1280px]:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] max-[1200px]:px-5">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-panel" data-tour="prepare-rundown">
          <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[0.6875rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Order of service</p>
                <h2 className="text-sm font-semibold">{orderCountLabel}{planned ? ` · ${planned} planned in all` : ""}</h2>
              </div>
              <RundownTools />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div role="group" aria-label="Running order view" className="flex items-center rounded-md border border-border p-0.5">
                <Button type="button" size="xs" variant={rundownView === "simple" ? "secondary" : "ghost"} aria-pressed={rundownView === "simple"} onClick={() => changeRundownView("simple")}>Simple list</Button>
                <Button type="button" size="xs" variant={rundownView === "grouped" ? "secondary" : "ghost"} aria-pressed={rundownView === "grouped"} onClick={() => changeRundownView("grouped")}>Grouped by phase</Button>
              </div>
              <div className="flex items-center gap-1.5">
                {phaseCount > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="xs" variant="ghost" aria-label="Phase options"><EllipsisIcon /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" onSelect={() => setRemovePhasesOpen(true)}>Remove phases…</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <AddEventPalette target={eventTarget} onCreated={onEventCreated} disabled={creatingDraft} label="Add Event" ariaLabel="Add event" />
              </div>
            </div>
          </div>
          {phaseCount > 0 && (
            <Dialog open={removePhasesOpen} onOpenChange={setRemovePhasesOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Remove all phases?</DialogTitle>
                  <DialogDescription>
                    This removes phase timing, loop rules, skipped status and phase-level assignments. Events, groups and content stay in their current order. Use Undo in the rundown toolbar to restore the exact phase setup; nothing goes live.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRemovePhasesOpen(false)}>Keep phases</Button>
                  <Button variant="destructive" onClick={() => {
                    useQueueStore.getState().removePhases()
                    setRemovePhasesOpen(false)
                    toast.success("Phases removed", { description: "Events and content remain in the rundown. Use Undo to restore the phase setup." })
                  }}>Remove phases</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RundownList mode="prepare" selectedEventId={selectedEvent?.id ?? null} onSelectEvent={setSelectedEventId} groupedByPhase={rundownView === "grouped"} onEventCreated={onEventCreated} eventsDisabled={creatingDraft} collapsedIds={collapsedSections} onToggleSection={toggleCollapsedSection} />
          </div>
          <RundownFooter />
        </section>

        <section className="min-h-0 overflow-hidden rounded-lg border border-border bg-card shadow-panel">
          {selectedEvent ? (
            <RunOfShowEventEditor
              header={selectedEvent}
              onOpenMoment={(item) => {
                setSelectedEventId(null)
                presentActions.previewItem(item)
              }}
            />
          ) : <ItemEditor />}
        </section>

        {/* The show scheduler (approved design); on a narrower window it gives way to the editor, and Timing opens it over it. */}
        <aside
          id="prepare-timing"
          aria-label="Timing"
          className={cn(
            "flex min-h-0 flex-col",
            timingOpen
              ? "max-[1280px]:absolute max-[1280px]:top-0 max-[1280px]:right-8 max-[1200px]:right-5 max-[1280px]:bottom-6 max-[1280px]:z-10 max-[1280px]:w-80 max-[1280px]:max-w-[calc(100%-2.5rem)] max-[1280px]:rounded-lg max-[1280px]:shadow-lg"
              : "max-[1280px]:hidden",
          )}
        >
          <TimingPanel />
        </aside>
      </div>
    </div>
  )
}

const DOT: Record<PhaseRole, string> = { pre: "bg-tone-blue-foreground", warmup: "bg-tone-amber-foreground", main: "bg-tone-green-foreground", post: "bg-tone-neutral-foreground", custom: "bg-tone-accent-foreground" }

/** The event's phases at a glance: how each runs and its minutes; a click finds it in the order of service. */
function PhaseStrip() {
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const phases = headers.filter((h) => h.type === "phase")
  if (phases.length === 0) return null
  const sums = sectionSummaries(items, headers)
  return (
    <div role="list" aria-label="Phases" className="mx-8 mb-4 [@media(max-height:860px)]:mb-2.5 grid shrink-0 auto-cols-fr grid-flow-col gap-3 max-[1200px]:mx-5">
      {phases.map((p) => (
        <button
          key={p.id}
          type="button"
          role="listitem"
          onClick={() => document.querySelector(`[aria-label="Phase: ${CSS.escape(p.name)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
          className="flex min-h-[5.25rem] min-w-0 items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left [@media(max-height:860px)]:min-h-0 [@media(max-height:860px)]:items-center [@media(max-height:860px)]:py-2 outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span aria-hidden className={cn("mt-0.5 size-4 shrink-0 rounded-full [@media(max-height:860px)]:mt-0 [@media(max-height:860px)]:size-3", DOT[p.role ?? "custom"])} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.8125rem] font-bold">{p.name}</span>
            <span className="mt-1.5 block text-[0.6875rem] text-muted-foreground [@media(max-height:860px)]:hidden">{p.rule ? RULE_LABEL[p.rule].says : "Its own rule not set"}</span>
          </span>
          <span className="shrink-0 text-xs font-extrabold text-muted-foreground tabular-nums">{p.rule === "loop" ? "↻" : `${sums[p.id]?.minutes ?? 0}m`}</span>
        </button>
      ))}
    </div>
  )
}

/** Under the order of service: organise it into phases, or put a group above the selected item. */
function RundownFooter() {
  const count = useQueueStore((s) => s.items.length)
  const hasPhases = useQueueStore((s) => s.headers.some((h) => h.type === "phase"))
  const sel = useSelectedItem()
  const [organisePhasesOpen, setOrganisePhasesOpen] = useState(false)
  const addGroup = () => {
    const at = sel?.index ?? 0
    useQueueStore.getState().setHeaders([...useQueueStore.getState().headers, { id: crypto.randomUUID(), type: "group", name: "New group", at }])
  }
  // A church-named phase (#193): before the selected item, else at the end; rename it from its menu.
  const addPhase = () => {
    const at = sel?.index ?? count
    useQueueStore.getState().setHeaders([...useQueueStore.getState().headers, newPhase(at)])
  }
  // A cue-only moment (#193): shows nothing; it fires its cues (an OBS marker to begin with) when taken.
  const addCue = () => {
    const item: CueQueueItem = { id: crypto.randomUUID(), kind: "cue", reference: "New cue", confidence: 1, source: "manual", added_at: Date.now(), cues: [{ on: "live", do: "obs.mark" }] }
    useQueueStore.getState().addItem(item)
    useBibleStore.getState().selectSlide({ item, index: 0 })
  }
  return (
    <div className="flex flex-wrap gap-2 border-t border-border p-2.5">
      {!hasPhases && (
        <Button size="sm" variant="soft" onClick={() => setOrganisePhasesOpen(true)} title="Add phase structure around the current running order">
          <LayersIcon /> Organise into phases
        </Button>
      )}
      <Dialog open={organisePhasesOpen} onOpenChange={setOrganisePhasesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organise this service into phases?</DialogTitle>
            <DialogDescription>
              Adds Pre-service loop, Warm-up, Main service and Post-service loop. Existing items keep their IDs and order and are placed in Main service. This only changes the plan; it does not start a phase or change an output. Use Undo to restore the previous rundown.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrganisePhasesOpen(false)}>Keep current list</Button>
            <Button onClick={() => {
              const queue = useQueueStore.getState()
              if (queue.headers.some((header) => header.type === "phase")) {
                setOrganisePhasesOpen(false)
                toast.info("Phases are already set", { description: "Use the running order view buttons to show or hide them." })
                return
              }
              queue.setHeaders([...defaultPhases(queue.items.length), ...queue.headers])
              setOrganisePhasesOpen(false)
              toast.success("Phases added", { description: "Your items are in Main service. Use Undo to restore the previous rundown." })
            }}>Add phases</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant="outline" onClick={addGroup} title={sel ? `A group starting at ${sel.item.reference}` : "A group at the top"}>
        <FolderPlusIcon /> Group
      </Button>
      {hasPhases && (
        <Button size="sm" variant="outline" onClick={addPhase} title={sel ? `A phase of your own starting at ${sel.item.reference}` : "A phase of your own at the end"}>
          <LayersPlusIcon /> Phase
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={addCue} title="A moment that shows nothing and fires its cues, e.g. an OBS recording marker">
        <ZapIcon /> Cue
      </Button>
    </div>
  )
}

const hhmm = (ms: number) => timeText(ms, churchTimeZone())

/** The event at a glance (approved design): what and when, how long, and when it should end; the service controls under it. */
function EventOverview() {
  const service = useServiceStore((s) => s.current)
  const items = useQueueStore((s) => s.items)
  const headers = useQueueStore((s) => s.headers)
  const { timing } = useServiceTiming()
  const sums = sectionSummaries(items, headers)
  const main = headers.find((h) => h.type === "phase" && h.role === "main") ?? headers.find((h) => h.type === "phase" && h.rule === "manual")
  const warm = headers.find((h) => h.type === "phase" && h.role === "warmup")
  const mainMinutes = main ? sums[main.id]?.minutes ?? 0 : Math.round(plannedTotalMs(items) / 60_000)
  const date = service?.service_date ? new Date(`${service.service_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : null
  const stats: Array<[string, string]> = [
    // Says what it counts: the main service alone when there is one, else the whole plan.
    [main ? "Main service" : "Planned in all", formatMinutes(mainMinutes * 60_000) || "—"],
    ["Warm-up", warm ? formatMinutes((sums[warm.id]?.minutes ?? 0) * 60_000) || "0 min" : "—"],
    ["Projected finish", timing ? hhmm(timing.expectedEnd) : "—"],
  ]
  return (
    <section aria-label="The event" className="mx-8 mb-4 [@media(max-height:860px)]:mb-2.5 shrink-0 rounded-lg border border-border bg-card max-[1200px]:mx-5">
      <div className="flex flex-wrap items-center gap-4 px-[15px] py-2.5 [@media(max-height:860px)]:py-1.5">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground [&_svg]:size-4"><CalendarDaysIcon /></span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-base font-semibold">{service ? service.title : items.length ? "Items not saved as a service" : "No service open"}</p>
            <SaveState />
          </div>
          <p className="truncate text-xs text-muted-foreground">{[date, main?.starts_at ? `${main.starts_at} start` : null].filter(Boolean).join(" · ") || "Give it a date and a start time to plan its times"}</p>
        </div>
        <dl className="flex items-stretch">
          {stats.map(([label, value]) => (
            <div key={label} className="border-l border-border px-4">
              <dt className="text-[0.6875rem] font-semibold text-muted-foreground">{label}</dt>
              <dd className="text-lg font-bold tracking-[-0.03em] tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="border-t border-border px-[15px] py-2.5 [@media(max-height:860px)]:py-1.5">
        <ServiceBar />
      </div>
    </section>
  )
}
