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
import { ServiceBar } from "@/studio/prepare/service-bar"
import { formatMinutes, plannedTotalMs } from "@/lib/service-timing"
import { SongLibrary } from "@/studio/prepare/song-library"
import { HymnBook } from "@/studio/prepare/hymn-book"
import { SlideComposer } from "@/studio/prepare/slide-composer"
import { MediaLibrary } from "@/studio/prepare/media-library"
import { ReusePanel } from "@/studio/prepare/reuse-panel"

/**
 * Service builder: order Bible passages, songs and custom slides into the
 * rundown, and keep the song library. Nothing here can present — Prepare only edits.
 */
export function PrepareWorkspace() {
  const count = useQueueStore((s) => s.items.length)
  const planned = useQueueStore((s) => formatMinutes(plannedTotalMs(s.items)))
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader title="Prepare" subtitle="Build the service. Nothing here goes live.">
        <ServiceBar />
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
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card" data-tour="prepare-rundown">
          <PanelHeader title="Service">
            <span className="text-xs text-muted-foreground">{count} item{count === 1 ? "" : "s"}{planned ? ` · ${planned} planned` : ""}</span>
          </PanelHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RundownList mode="prepare" />
          </div>
        </section>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card" data-tour="prepare-add">
            <Tabs defaultValue="bible" className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border px-3 pt-2">
                <TabsList>
                  <TabsTrigger value="bible">Bible</TabsTrigger>
                  <TabsTrigger value="songs">Songs</TabsTrigger>
                  <TabsTrigger value="hymns">Hymn book</TabsTrigger>
                  <TabsTrigger value="slides">Slides</TabsTrigger>
                  <TabsTrigger value="media">Pictures</TabsTrigger>
                  <TabsTrigger value="reuse">Reuse</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="bible" className="min-h-0 flex-1 overflow-hidden p-3">
                <QuickFind mode="prepare" autoFocus />
              </TabsContent>
              <TabsContent value="songs" className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                <SongLibrary />
              </TabsContent>
              <TabsContent value="hymns" className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                <HymnBook />
              </TabsContent>
              <TabsContent value="slides" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
                <SlideComposer />
              </TabsContent>
              <TabsContent value="media" className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                <MediaLibrary />
              </TabsContent>
              <TabsContent value="reuse" className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                <ReusePanel />
              </TabsContent>
            </Tabs>
          </section>
          <div className="h-72 w-[26rem] overflow-hidden [&>div]:h-full">
            <PreviewPanel />
          </div>
        </div>
      </div>
    </div>
  )
}
