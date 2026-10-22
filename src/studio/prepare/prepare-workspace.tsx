import { useState } from "react"
import { Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { RundownList } from "@/studio/present/rundown-list"
import { ServiceBar } from "@/studio/prepare/service-bar"
import { formatMinutes, plannedTotalMs } from "@/lib/service-timing"
import { ItemEditor } from "@/studio/prepare/item-editor"
import { AddItems } from "@/studio/prepare/add-items"
import { TimingPanel } from "@/studio/prepare/timing-panel"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"
import { RULE_LABEL, defaultPhases, sectionSummaries, type PhaseRole } from "@/lib/run-of-show"
import { CalendarDaysIcon, FolderPlusIcon, LayersIcon, MonitorPlayIcon } from "lucide-react"
import { useShellStore } from "@/studio/shell-store"
import { useServiceTiming } from "@/studio/use-service-timing"
import { cn } from "@/lib/utils"

/**
 * Service builder: the order of service, the selected item's editor and the
 * preview, with the service's details above. Nothing here can present —
 * Prepare only edits; a click previews.
 */
export function PrepareWorkspace() {
  const count = useQueueStore((s) => s.items.length)
  const planned = useQueueStore((s) => formatMinutes(plannedTotalMs(s.items)))
  const service = useServiceStore((s) => s.current)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const weekday = service?.service_date ? new Date(`${service.service_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-8 pt-6 pb-3 max-[1200px]:px-5">
        <div className="min-w-0">
          <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Plan the whole experience</p>
          <h1 className="mt-1 truncate text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">{weekday ? `${weekday} run of show.` : "Your run of show."}</h1>
          <p className="mt-1 text-xs text-muted-foreground">Service sections, timing, content, signals and team instructions — one coherent timeline. Nothing here goes live.</p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" disabled={count === 0}>
                <Trash2Icon /> Clear service
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="mb-3 text-sm">Remove all {count} items from the service?</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>Keep</Button>
                <Button variant="destructive" size="sm" onClick={() => { useQueueStore.getState().clearQueue(); setConfirmOpen(false) }}>
                  Clear
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <AddItems />
          <Button onClick={() => useShellStore.getState().setWorkspace("present")} disabled={count === 0}><MonitorPlayIcon /> Present service</Button>
        </div>
      </header>

      <EventOverview />

      <PhaseStrip />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)_minmax(16rem,20rem)] gap-4 px-8 pb-6 max-[1280px]:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] max-[1200px]:px-5">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-panel" data-tour="prepare-rundown">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-[0.6875rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Order of service</p>
              <h2 className="text-sm font-semibold">{count} {count === 1 ? "item" : "items"}{planned ? ` · ${planned} planned` : ""}</h2>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RundownList mode="prepare" />
          </div>
          <RundownFooter />
        </section>

        <section className="min-h-0 overflow-hidden rounded-lg border border-border bg-card shadow-panel">
          <ItemEditor />
        </section>

        {/* The show scheduler (approved design); on a narrower window it gives way to the editor. */}
        <aside className="flex min-h-0 flex-col max-[1280px]:hidden">
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
    <div role="list" aria-label="Phases" className="mx-8 mb-4 grid shrink-0 auto-cols-fr grid-flow-col gap-3 max-[1200px]:mx-5">
      {phases.map((p) => (
        <button
          key={p.id}
          type="button"
          role="listitem"
          onClick={() => document.querySelector(`[aria-label="Phase: ${CSS.escape(p.name)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
          className="flex min-h-[5.25rem] min-w-0 items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span aria-hidden className={cn("mt-0.5 size-4 shrink-0 rounded-full", DOT[p.role ?? "custom"])} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.8125rem] font-bold">{p.name}</span>
            <span className="mt-1.5 block text-[0.6875rem] text-muted-foreground">{p.rule ? RULE_LABEL[p.rule].says : "Its own rule not set"}</span>
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
  const addGroup = () => {
    const at = sel?.index ?? 0
    useQueueStore.getState().setHeaders([...useQueueStore.getState().headers, { id: crypto.randomUUID(), type: "group", name: "New group", at }])
  }
  return (
    <div className="flex flex-wrap gap-2 border-t border-border p-2.5">
      {!hasPhases && (
        <Button size="sm" variant="soft" onClick={() => useQueueStore.getState().setHeaders([...defaultPhases(count), ...useQueueStore.getState().headers])} title="Pre-service loop, warm-up, main service and post-service loop; what is here goes into the main service">
          <LayersIcon /> Organise into phases
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={addGroup} title={sel ? `A group starting at ${sel.item.reference}` : "A group at the top"}>
        <FolderPlusIcon /> Group
      </Button>
    </div>
  )
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

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
    ["Planned service", mainMinutes ? `${mainMinutes} min` : "—"],
    ["Warm-up", warm ? `${sums[warm.id]?.minutes ?? 0} min` : "—"],
    ["Projected finish", timing ? hhmm(timing.expectedEnd) : "—"],
  ]
  return (
    <section aria-label="The event" className="mx-8 mb-4 shrink-0 rounded-lg border border-border bg-card max-[1200px]:mx-5">
      <div className="flex flex-wrap items-center gap-4 px-[15px] py-2.5">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground [&_svg]:size-4"><CalendarDaysIcon /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{service ? service.title : "Unsaved service"}</p>
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
      <div className="border-t border-border px-[15px] py-2.5">
        <ServiceBar />
      </div>
    </section>
  )
}
