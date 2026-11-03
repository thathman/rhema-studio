import { BookOpenIcon, MicIcon, MonitorCogIcon, SlidersHorizontalIcon, XIcon } from "lucide-react"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { Button } from "@/components/ui/button"
import { EmbeddingWarningBanner } from "@/components/ui/embedding-warning-banner"
import { useBibleStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { ProductionWorkspace } from "@/studio/production/production-workspace"
import { CueMenu } from "@/studio/present/cue-menu"
import { LowerThirdControl } from "@/studio/present/lower-third"
import { SoundChip } from "@/studio/present/sound-chip"
import { StageMessage } from "@/studio/present/stage-message"
import { QuickFind } from "@/studio/present/quick-find"
import { EngageHostControl } from "@/studio/engage/host-control"
import type { LiveToolsTab } from "@/studio/production/production-tab"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type { LiveToolsTab } from "@/studio/production/production-tab"

function ServiceTranslationControl() {
  const service = useServiceStore((state) => state.current)
  const override = useBibleStore((state) => state.overrideServiceTranslations)
  const activeAbbrev = useBibleStore((state) => state.translations.find((translation) => translation.id === state.activeTranslationId)?.abbreviation ?? "active")
  if (!service) return null

  const label = override
    ? `Use saved translations for this service`
    : `Override all service translations with ${activeAbbrev}`

  return (
    <div role="group" aria-label="Service translation override" className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-sunken px-3 py-1.5">
      <span role="status" className="text-[0.6875rem] text-muted-foreground">
        {override ? `Override: ${activeAbbrev}` : "Saved translations"}
      </span>
      <Button
        type="button"
        size="xs"
        variant={override ? "outline" : "ghost"}
        aria-label={label}
        aria-pressed={override}
        title={override
          ? `Service items are shown in ${activeAbbrev}. Use the translation saved with each item.`
          : `Service items are shown in the translation saved with each item. Use ${activeAbbrev} for all service items.`}
        onClick={() => useBibleStore.getState().setOverrideServiceTranslations(!override)}
      >
        {override ? "Use saved translations" : `Override · ${activeAbbrev}`}
      </Button>
    </div>
  )
}

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
            {tab === "production"
              ? "Timing, scenes, cameras, OBS and health tools share this Live state. Preview stays private until an explicit action."
              : tab === "controls"
                ? "Open secondary cues, local sound, lower thirds, Stage messages and Engage when needed."
                : tab === "listening"
                  ? "Review what the microphone heard. Choose Queue, Bible feeds, or Show live when you are ready."
                  : "Find Scripture or a hymn for private Preview. Choosing a result does not change Program."}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close Live tools" title="Close Live tools" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as LiveToolsTab)}
        className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-2"
      >
        <TabsList aria-label="Live tools" className="mt-2 w-full">
          <TabsTrigger value="bible"><BookOpenIcon /> Find &amp; cue</TabsTrigger>
          <TabsTrigger value="listening"><MicIcon /> Listening</TabsTrigger>
          <TabsTrigger value="production"><MonitorCogIcon /> Production tools</TabsTrigger>
          <TabsTrigger value="controls"><SlidersHorizontalIcon /> More controls</TabsTrigger>
        </TabsList>
        <TabsContent value="bible" className="mt-2 min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col gap-2" role="region" aria-label="Find Scripture and songs" data-tour="quick-find">
            <EmbeddingWarningBanner />
            <ServiceTranslationControl />
            <div className="min-h-0 flex-1"><QuickFind mode="present" autoFocus /></div>
          </div>
        </TabsContent>
        <TabsContent value="listening" className="mt-2 min-h-0 flex-1 overflow-hidden">
          <div className="grid h-full min-h-0 grid-rows-2 gap-2 min-[900px]:grid-cols-2 min-[900px]:grid-rows-1">
            <TranscriptPanel />
            <DetectionsPanel />
          </div>
        </TabsContent>
        <TabsContent value="production" className="mt-2 min-h-0 flex-1 overflow-hidden">
          <ProductionWorkspace embedded />
        </TabsContent>
        <TabsContent value="controls" className="mt-2 min-h-0 flex-1 overflow-y-auto">
          <section role="group" aria-label="Secondary Live controls" className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-3">
            <p className="text-xs text-muted-foreground">These controls stay out of the main console until needed. Each shows where its action goes.</p>
            <div className="flex flex-wrap items-center gap-2">
              <CueMenu />
              <SoundChip />
              <LowerThirdControl />
              <StageMessage />
              <EngageHostControl />
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </section>
  )
}
