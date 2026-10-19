import { useState } from "react"
import { Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PanelHeader } from "@/components/ui/panel-header"
import { useQueueStore } from "@/stores"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { WorkspaceHeader } from "@/studio/ui/status-chip"
import { RundownList } from "@/studio/present/rundown-list"
import { QuickFind } from "@/studio/present/quick-find"

/**
 * Service builder, foundation version: order Bible passages into the rundown.
 * Nothing here can present — Prepare only edits.
 */
export function PrepareWorkspace() {
  const count = useQueueStore((s) => s.items.length)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader title="Prepare" subtitle="Build the service. Nothing here goes live.">
        <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={count === 0}>
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
      </WorkspaceHeader>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)] gap-3 p-3">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <PanelHeader title="Service">
            <span className="text-xs text-muted-foreground">{count} item{count === 1 ? "" : "s"}</span>
          </PanelHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RundownList mode="prepare" />
          </div>
        </section>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
            <Tabs defaultValue="bible" className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border px-3 pt-2">
                <TabsList>
                  <TabsTrigger value="bible">Bible</TabsTrigger>
                  <TabsTrigger value="songs" disabled title="Planned for Milestone 2">Songs</TabsTrigger>
                  <TabsTrigger value="slides" disabled title="Planned for Milestone 2">Slides</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="bible" className="min-h-0 flex-1 overflow-hidden p-3">
                <QuickFind mode="prepare" autoFocus />
              </TabsContent>
            </Tabs>
            <p className="border-t border-border px-3 py-2 text-[0.6875rem] text-muted-foreground">
              Songs, hymn numbers and custom slides arrive with the content library (Milestone 2).
            </p>
          </section>
          <div className="h-48 overflow-hidden [&>div]:h-full">
            <PreviewPanel />
          </div>
        </div>
      </div>
    </div>
  )
}
