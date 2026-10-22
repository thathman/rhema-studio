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
          <p className="text-[0.6875rem] font-extrabold tracking-[0.15em] text-primary uppercase">Plan the whole service</p>
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

      <div className="mx-8 mb-4 shrink-0 rounded-[17px] border border-border bg-card px-4 py-3 shadow-panel max-[1200px]:mx-5">
        <ServiceBar />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)_minmax(16rem,20rem)] gap-4 px-8 pb-6 max-[1280px]:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] max-[1200px]:px-5">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[17px] border border-border bg-card shadow-panel" data-tour="prepare-rundown">
          <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-[0.625rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Order of service</p>
              <h2 className="text-sm font-semibold">{count} {count === 1 ? "item" : "items"}{planned ? ` · ${planned} planned` : ""}</h2>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RundownList mode="prepare" />
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-[17px] border border-border bg-card shadow-panel">
          <ItemEditor />
        </section>

        {/* On a narrower window the preview gives way to the editor (Present shows it too). */}
        <aside className="flex min-h-0 flex-col gap-4 max-[1280px]:hidden">
          <div className="h-64 overflow-hidden rounded-[17px] [&>div]:h-full">
            <PreviewPanel />
          </div>
          <div className="rounded-[17px] border border-border bg-card p-4 text-sm shadow-panel">
            <p className="text-[0.625rem] font-extrabold tracking-[0.12em] text-muted-foreground uppercase">Timing</p>
            <p className="mt-2 text-2xl font-bold tracking-[-0.04em]">{planned || "—"}</p>
            <p className="text-xs text-muted-foreground">{planned ? "planned in total" : "Give items planned minutes (Timing tab) to see the total."}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
