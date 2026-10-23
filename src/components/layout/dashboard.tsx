import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { LiveOutputPanel } from "@/components/panels/live-output-panel"
import { QueuePanel } from "@/components/panels/queue-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { EmbeddingWarningBanner } from "@/components/ui/embedding-warning-banner"

/**
 * Present → Advanced (stored as "production"): the Standard layout (queue, preview, live) on top and
 * the listening tools (transcript, detections, Bible) underneath. Status,
 * outputs, theme and settings live in the Studio shell and Present's header,
 * so this view has no header of its own. Every panel scrolls inside itself.
 */
export function Dashboard() {
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-background">
      {/* Collapses to nothing when there is nothing to warn about. */}
      <EmbeddingWarningBanner />
      <div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 p-3 *:min-h-0 *:min-w-0">
        <QueuePanel />
        <PreviewPanel />
        <LiveOutputPanel />
        <TranscriptPanel />
        <DetectionsPanel />
        <SearchPanel />
      </div>
    </div>
  )
}
