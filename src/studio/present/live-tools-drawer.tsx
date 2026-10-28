import { BookOpenIcon, MicIcon, XIcon } from "lucide-react"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { Button } from "@/components/ui/button"
import { EmbeddingWarningBanner } from "@/components/ui/embedding-warning-banner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type LiveToolsTab = "bible" | "listening"

export function LiveToolsDrawer({
  tab,
  onTabChange,
  onClose,
}: {
  tab: LiveToolsTab
  onTabChange: (tab: LiveToolsTab) => void
  onClose: () => void
}) {
  return (
    <section
      id="live-tools-panel"
      data-slot="live-tools-panel"
      aria-label="Live tools"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault()
          onClose()
        }
      }}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">Live tools</h2>
          <p className="text-xs text-muted-foreground">
            Bible search previews verses. Listening results stay here until you choose Queue, Bible feeds, or Show live.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close Bible and listening tools" title="Close Live tools" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as LiveToolsTab)}
        className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-2"
      >
        <TabsList aria-label="Bible and listening tools" className="mt-2 w-full">
          <TabsTrigger value="bible"><BookOpenIcon /> Bible search</TabsTrigger>
          <TabsTrigger value="listening"><MicIcon /> Listening</TabsTrigger>
        </TabsList>
        <TabsContent value="bible" className="mt-2 min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col gap-2">
            <EmbeddingWarningBanner />
            <div className="min-h-0 flex-1"><SearchPanel /></div>
          </div>
        </TabsContent>
        <TabsContent value="listening" className="mt-2 min-h-0 flex-1 overflow-hidden">
          <div className="grid h-full min-h-0 grid-rows-2 gap-2 min-[900px]:grid-cols-2 min-[900px]:grid-rows-1">
            <TranscriptPanel />
            <DetectionsPanel />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
