import { useState } from "react"
import { Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { RundownList } from "@/studio/present/rundown-list"
import { ServiceBar } from "@/studio/prepare/service-bar"
import { formatMinutes, plannedTotalMs } from "@/lib/service-timing"
import { ItemEditor } from "@/studio/prepare/item-editor"
import { AddItems } from "@/studio/prepare/add-items"
import { TimingPanel } from "@/studio/prepare/timing-panel"
import { useSelectedItem } from "@/studio/prepare/use-selected-item"
import { RULE_LABEL, defaultPhases, sectionSummaries, type PhaseRole } from "@/lib/run-of-show"
import { FolderPlusIcon, LayersIcon } from "lucide-react"
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-8 pt-6 pb-3 max-[1200px]:px-5">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-bold tracking-[0.12em] text-muted-foreground uppercase">Plan the whole service</p>
          <h1 className="mt-1 truncate text-[1.75rem] leading-tight font-bold tracking-[-0.04em]">{service ? service.title : "Your service."}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Order, content and timing in one place. Nothing here goes live.</p>
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
        </div>
      </header>

      <div className="mx-8 mb-4 shrink-0 rounded-xl border border-border bg-card px-4 py-3 shadow-panel max-[1200px]:mx-5">
        <ServiceBar />
      </div>

      <PhaseStrip />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)_minmax(16rem,20rem)] gap-4 px-8 pb-6 max-[1280px]:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] max-[1200px]:px-5">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-panel" data-tour="prepare-rundown">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-[0.625rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Order of service</p>
              <h2 className="text-sm font-semibold">{count} {count === 1 ? "item" : "items"}{planned ? ` · ${planned} planned` : ""}</h2>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RundownList mode="prepare" />
          </div>
          <RundownFooter />
        </section>

        <section className="min-h-0 overflow-hidden rounded-xl border border-border bg-card shadow-panel">
          <ItemEditor />
        </section>

        {/* On a narrower window the preview gives way to the editor (Present shows it too). */}
        <aside className="flex min-h-0 flex-col gap-4 max-[1280px]:hidden">
          <div className="h-56 shrink-0 overflow-hidden rounded-xl [&>div]:h-full">
            <PreviewPanel />
          </div>
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
          className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left shadow-panel outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[p.role ?? "custom"])} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{p.name}</span>
            <span className="block truncate text-[0.6875rem] text-muted-foreground">{p.rule ? RULE_LABEL[p.rule].says : "Its own rule not set"}</span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{p.rule === "loop" ? "↻" : `${sums[p.id]?.minutes ?? 0}m`}</span>
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
