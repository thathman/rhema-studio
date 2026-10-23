import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { approvalHolds } from "@/stores/approval-gate-store"
import { useBroadcastStore, useBibleStore } from "@/stores"
import { presentVerse } from "@/hooks/use-broadcast"
import { LiveSourcesStrip } from "@/studio/present/live-sources-strip"

export function LiveOutputPanel() {
  const isLive = useBroadcastStore((s) => s.isLive)
  const autoLive = useBroadcastStore((s) => s.autoLive)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)

  const activeTheme = themes.find((t) => t.id === activeThemeId) ?? themes[0]

  // The live output renders only what was explicitly presented — it no longer
  // follows the preview selection, so detections can't override the operator.
  const verseData = isLive ? liveVerse : null

  // Following a translation change on air lives in useLiveTranslationFollow (mounted once).

  const handleGoLive = (checked: boolean) => {
    if (checked && approvalHolds(() => handleGoLive(true))) return
    useBroadcastStore.getState().setLive(checked)
    // Going live with nothing presented yet: present the current preview
    // verse so the output isn't blank.
    if (checked && !useBroadcastStore.getState().liveVerse) {
      const selected = useBibleStore.getState().selectedVerse
      if (selected) void presentVerse(selected)
    }
  }

  return (
    <div
      data-slot="live-output-panel"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card transition-colors",
        isLive ? "border-live-pulse/60" : "border-border"
      )}
    >
      <PanelHeader title="Live">
        <label
          className="flex items-center gap-2"
          title="Auto: while on air, a verse heard while listening goes live without Take live. While a song, hymn or slide is up it goes only to the feeds that follow Bible and waits in the preview here. Off (the default): heard verses wait in the preview."
        >
          <span className={cn("text-xs font-medium transition-colors", autoLive ? "text-foreground" : "text-muted-foreground")}>
            Auto
          </span>
          <Switch
            aria-label="Auto: heard verses go live by themselves"
            checked={autoLive}
            onCheckedChange={(checked) =>
              useBroadcastStore.getState().setAutoLive(checked)
            }
          />
        </label>
        <span aria-hidden className="mx-2 h-4 w-px bg-border" />
        <label
          className="flex items-center gap-2"
          title={isLive ? "On air: the screens show Live. Switch off to take it off the screens." : "Off air: the screens show nothing. Switch on to show Live (the preview, if nothing was presented yet)."}
        >
          <span className={cn("text-xs font-medium transition-colors", isLive ? "text-destructive" : "text-muted-foreground")}>
            {isLive ? "On air" : "Go live"}
          </span>
          <Switch
            aria-label="Go live: show this on the screens"
            checked={isLive}
            onCheckedChange={handleGoLive}
            className="data-[state=checked]:bg-live-pulse"
          />
        </label>
      </PanelHeader>

      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center p-3 transition-opacity [container-type:size]",
          !isLive && liveVerse && "opacity-40"
        )}
      >
        <div className="relative" style={{ width: `min(100cqw, 100cqh * ${activeTheme.resolution.width / activeTheme.resolution.height})` }}>
          <CanvasVerse theme={activeTheme} verse={verseData} />
          {/* The approved design's empty Program: says so in words rather than a blank screen. */}
          {!isLive && !liveVerse && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md bg-[#16262b] text-center">
              <p className="text-lg font-semibold tracking-[-0.02em] text-[#d6e2df]">Nothing on air</p>
              <p className="text-xs text-[#9fb2b0]">Select an item, then take it live.</p>
            </div>
          )}
        </div>
      </div>
      <LiveSourcesStrip />
    </div>
  )
}
