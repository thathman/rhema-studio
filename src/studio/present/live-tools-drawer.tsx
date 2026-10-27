import { BookOpenIcon, MicIcon } from "lucide-react"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { EmbeddingWarningBanner } from "@/components/ui/embedding-warning-banner"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type LiveToolsTab = "bible" | "listening"

export function LiveToolsDrawer({
  open,
  onOpenChange,
  tab,
  onTabChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: LiveToolsTab
  onTabChange: (tab: LiveToolsTab) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent id="live-tools-panel" side="right" className="data-[side=right]:w-[min(48rem,calc(100vw-1rem))] data-[side=right]:max-w-none data-[side=right]:sm:max-w-none gap-0 overflow-hidden p-0">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>Live tools</SheetTitle>
          <SheetDescription>
            Bible search previews verses. Listening results stay here until you choose Queue, Bible feeds, or Show live.
          </SheetDescription>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as LiveToolsTab)}
          className="min-h-0 flex-1 overflow-hidden px-4 pb-4"
        >
          <TabsList aria-label="Bible and listening tools" className="mt-3 w-full">
            <TabsTrigger value="bible"><BookOpenIcon /> Bible search</TabsTrigger>
            <TabsTrigger value="listening"><MicIcon /> Listening</TabsTrigger>
          </TabsList>
          <TabsContent value="bible" className="mt-3 min-h-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col gap-2">
              <EmbeddingWarningBanner />
              <div className="min-h-0 flex-1"><SearchPanel /></div>
            </div>
          </TabsContent>
          <TabsContent value="listening" className="mt-3 min-h-0 overflow-hidden">
            <div className="grid h-full min-h-0 grid-rows-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] gap-3 min-[900px]:grid-cols-2 min-[900px]:grid-rows-1">
              <TranscriptPanel />
              <DetectionsPanel />
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
