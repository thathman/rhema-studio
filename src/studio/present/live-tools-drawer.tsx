import { BookOpenIcon, Maximize2Icon, MicIcon, Minimize2Icon, MonitorCogIcon, SlidersHorizontalIcon, XIcon } from "lucide-react"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { Button } from "@/components/ui/button"
import { EmbeddingWarningBanner } from "@/components/ui/embedding-warning-banner"
import { useBibleStore, useBroadcastStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { ProductionWorkspace } from "@/studio/production/production-workspace"
import { CueMenu } from "@/studio/present/cue-menu"
import { LowerThirdControl } from "@/studio/present/lower-third"
import { SoundChip } from "@/studio/present/sound-chip"
import { StageMessage } from "@/studio/present/stage-message"
import { QuickFind } from "@/studio/present/quick-find"
import { EngageHostControl } from "@/studio/engage/host-control"
import { liveToolsExpanded, setLiveToolsExpanded, useProductionTab, type LiveToolsTab } from "@/studio/production/production-tab"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

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

/**
 * Live tools: the strip under Program, or a tall panel (#812 F1) for the tools that are whole
 * workspaces (Scenes, OBS, Cameras, Show health, Operators). The tall panel takes height from the
 * Preview/Program row; it never covers Program or Take/Clear. Esc shrinks it, then closes it.
 */
export function LiveToolsDrawer({
  tab,
  onTabChange,
  onClose,
  stripClassName,
}: {
  tab: LiveToolsTab
  onTabChange: (tab: LiveToolsTab) => void
  onClose: () => void
  /** Where the drawer sits in the Live console's grid. */
  stripClassName?: string
}) {
  const isLive = useBroadcastStore((s) => s.isLive)
  const expanded = useProductionTab((s) => liveToolsExpanded(s, tab, isLive))
  return (
    // The tall panel is the same grid row grown (the console grid gives it the height): nothing is
    // covered, so Program and Take/Clear stay visible and reachable.
    <div data-slot="live-tools-frame" data-expanded={expanded} className={cn(stripClassName, expanded && "max-[1200px]:h-[28rem]")}>
      <section
        id="live-tools-panel"
        data-slot="live-tools-panel"
        aria-label="Live tools"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault()
            // First back to the strip, then closed.
            if (expanded) setLiveToolsExpanded(tab, false)
            else onClose()
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
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-pressed={expanded}
              aria-label={expanded ? "Shrink Live tools to the strip" : "Expand Live tools"}
              title={expanded ? "Give Preview and Program their full height again" : "Give these tools most of the console; Preview, Program and Take stay in view, smaller"}
              onClick={() => setLiveToolsExpanded(tab, !expanded)}
            >
              {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Close Live tools" title="Close Live tools" onClick={onClose}>
              <XIcon />
            </Button>
          </div>
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
            <ProductionWorkspace embedded expanded={expanded} />
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
    </div>
  )
}
