import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { approvalHolds } from "@/stores/approval-gate-store"
import { useBroadcastStore, useBibleStore } from "@/stores"
import { autoModeOf, type AutoMode } from "@/stores/broadcast-store"
import { presentVerse } from "@/hooks/use-broadcast"
import { LiveSourcesStrip } from "@/studio/present/live-sources-strip"

export function LiveOutputPanel() {
  const isLive = useBroadcastStore((s) => s.isLive)
  const autoMode = useBroadcastStore(autoModeOf)
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
          title="Auto: On: while on air, a verse heard while listening goes live without Take live (while a song, hymn or slide is up it goes only to the feeds that follow Bible). Bible feeds only: it goes to the feeds that follow Bible and never the main screens. Off (the default): heard verses wait in the preview."
        >
          <span className={cn("text-xs font-medium transition-colors", autoMode !== "manual" ? "text-foreground" : "text-muted-foreground")}>
            Auto
          </span>
          <Select value={autoMode} onValueChange={(v) => useBroadcastStore.getState().setAutoMode(v as AutoMode)}>
            <SelectTrigger size="sm" className="text-xs" aria-label="Auto: where heard verses go by themselves"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Off</SelectItem>
              <SelectItem value="bible">Bible feeds only</SelectItem>
              <SelectItem value="auto">On</SelectItem>
            </SelectContent>
          </Select>
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
          {/* The approved design's empty Program: says so in words rather than a blank screen. On a short
              panel the words get smaller and the hint goes, so they never spill over the sources below. */}
          {!isLive && !liveVerse && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-[#16262b] px-2 text-center">
              <p className="text-lg leading-tight font-semibold tracking-[-0.02em] whitespace-nowrap text-[#d6e2df] [@container(max-height:5.5rem)]:text-sm">Nothing on air</p>
              <p className="text-xs leading-snug text-[#9fb2b0] [@container(max-height:5.5rem)]:hidden">Select an item, then take it live.</p>
            </div>
          )}
        </div>
      </div>
      <LiveSourcesStrip />
    </div>
  )
}
