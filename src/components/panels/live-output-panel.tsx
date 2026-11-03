import { PauseIcon, PlayIcon } from "lucide-react"
import type { ReactNode } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { Button } from "@/components/ui/button"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFeedHealth } from "@/lib/browser-feeds"
import { cn } from "@/lib/utils"
import { useBroadcastStore } from "@/stores"
import { autoModeOf, type AutoMode } from "@/stores/broadcast-store"
import { outputOnAir } from "@/lib/output-on-air"
import { forOutputLanguage } from "@/lib/output-language"
import { LiveSourcesStrip } from "@/studio/present/live-sources-strip"
import { StatusChip } from "@/studio/ui/status-chip"
import type { BroadcastOutput, BroadcastOutputStatus } from "@/types"

/**
 * What the screens show. The transport is the only ordinary place to Take or
 * Clear live; this panel reports Program status and offers its scoped controls.
 */
export function LiveOutputPanel({ outputId, sceneTakeAction }: { outputId?: string | null; sceneTakeAction?: ReactNode } = {}) {
  const isLive = useBroadcastStore((s) => s.isLive)
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const autoMode = useBroadcastStore(autoModeOf)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)
  const outputs = useBroadcastStore((s) => s.outputs)
  const congregationOutputs = outputs.filter((output) => (output.role ?? "congregation") === "congregation")
  const output = congregationOutputs.find((candidate) => candidate.id === outputId) ?? congregationOutputs[0]
  const status = useBroadcastStore((s) => (output ? s.outputStatus[output.id] : undefined))
  const outputLive = output ? outputOnAir(output, status) : false
  const feed = useFeedHealth(output?.id ?? "", !!output && output.type === "browser" && outputLive)

  const outputContent = liveVerse?.content ?? "bible"
  const outputThemeId = output?.themeFor?.[outputContent] ?? output?.themeId ?? activeThemeId
  const activeTheme = themes.find((t) => t.id === outputThemeId) ?? themes.find((t) => t.id === activeThemeId) ?? themes[0]

  // The live output renders only what was explicitly presented — it no longer
  // follows the preview selection, so detections can't override the operator.
  const verseData = isLive ? forOutputLanguage(liveVerse, output?.language ?? "both") : null
  // A video item on air can be paused and resumed on every screen (MD-002, #36).
  const video = isLive && liveVerse?.content === "picture" ? liveVerse.video : undefined
  const delivery = programDelivery(output, status, isLive, rehearsal, feed)

  // Following a translation change on air lives in useLiveTranslationFollow (mounted once).

  return (
    <div
      data-slot="live-output-panel"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card transition-colors",
        isLive ? "border-live-pulse/60" : "border-border"
      )}
    >
      <PanelHeader title="Program">
        {video && (
          <>
            <Button
              size="xs"
              variant="outline"
              aria-pressed={!!video.paused}
              title={video.paused ? `Carry on playing ${video.name} from where it stopped` : `Hold ${video.name} on this frame on every screen, NDI and feed`}
              onClick={() => useBroadcastStore.getState().setVideoPaused(!video.paused)}
            >
              {video.paused ? <PlayIcon /> : <PauseIcon />}
              {video.paused ? "Resume video" : "Pause video"}
            </Button>
            <span aria-hidden className="mx-2 h-4 w-px bg-border" />
          </>
        )}
        <label
          className="flex items-center gap-2"
          title="Auto: On: while on air, a verse heard while listening goes live without Take source live (while a song, hymn or slide is up it goes only to the feeds that follow Bible). Bible feeds only: it goes to the feeds that follow Bible and never the main screens. Off (the default): heard verses wait in the preview."
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
        <StatusChip
          tone={!isLive ? "off" : rehearsal ? "warn" : "live"}
          label={!isLive ? "Off air" : rehearsal ? "Rehearsal" : "On air"}
          title={!isLive ? "Nothing is on the screens. Take runs the selected Preview action; Restore brings back what was cleared." : rehearsal ? "Rehearsal: the screens keep what they showed before it." : "On air: the screens show Live. Clear takes it down."}
          className="h-7 px-2.5"
        />
      </PanelHeader>

      {/* Keep the selected output's named scene action at the top of Program, above the picture. It
          remains visible when the screen preview is short and stays distinct from source Take. */}
      {sceneTakeAction}
      <div
        data-slot="live-picture"
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
      <div
        className="flex min-h-9 shrink-0 items-center gap-2 border-t border-border px-3 py-1.5"
        data-program-delivery-state={delivery.label}
      >
        <span title={output?.name} className="max-w-28 shrink-0 truncate text-[0.6875rem] font-semibold text-foreground">{output?.name ?? "No output"}</span>
        <StatusChip tone={delivery.tone} label={delivery.label} title={delivery.detail} className="h-6 shrink-0 px-2 text-[0.6875rem]" />
        <p role="status" aria-live="polite" aria-atomic="true" className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
          <span className="sr-only">{delivery.label}. </span>{delivery.detail}
        </p>
      </div>
      <LiveSourcesStrip />
    </div>
  )
}

function programDelivery(
  output: BroadcastOutput | undefined,
  status: BroadcastOutputStatus | undefined,
  isLive: boolean,
  rehearsal: boolean,
  feed: ReturnType<typeof useFeedHealth>,
): { label: string; tone: "ok" | "warn" | "off" | "info"; detail: string } {
  if (!output) return { label: "No output", tone: "warn", detail: "Add a congregation output to see its Program state." }
  if (rehearsal) return { label: "Rehearsal", tone: "warn", detail: "Public Program stays on the frame shown before practice." }
  if (!isLive) return { label: "Off air", tone: "off", detail: "Host Program is off air." }

  if (output.type === "browser") {
    if (!status?.feedActive) return { label: "Not sending", tone: "warn", detail: "Host is not sending to this browser feed." }
    if (!feed) return { label: "Checking", tone: "info", detail: "Feed is publishing; checking for a receiver." }
    if (feed.watching === 0) return { label: "No receiver", tone: "warn", detail: "Feed is publishing; no receiver is connected." }
    const pages = `${feed.watching} browser ${feed.watching === 1 ? "page" : "pages"}`
    const televisions = Object.values(feed.tvs ?? {}).reduce((total, count) => total + count, 0)
    const tvs = televisions > 0 ? ` · ${televisions} Google ${televisions === 1 ? "TV" : "TVs"}` : ""
    if (feed.behind) return { label: "Behind", tone: "warn", detail: `${pages} connected; the latest Program frame is not confirmed${tvs}.` }
    if (feed.current) return { label: "Receiver confirmed", tone: "ok", detail: `${pages} showing the latest Program frame${tvs}.` }
    return { label: "Waiting", tone: "info", detail: `${pages} connected; waiting for a draw acknowledgement${tvs}.` }
  }

  if (output.type === "ndi") {
    if (status?.ndiError) return { label: "NDI error", tone: "warn", detail: `NDI sender error · ${status.ndiError}` }
    if (!status?.ndiActive) return { label: "NDI stopped", tone: "warn", detail: "NDI sender is stopped." }
    if (typeof status.ndiReceivers === "number" && status.ndiReceivers > 0) {
      return { label: "NDI active", tone: "info", detail: `${status.ndiReceivers} ${status.ndiReceivers === 1 ? "receiver" : "receivers"} connected; frame acknowledgement is unavailable.` }
    }
    return { label: "NDI active", tone: "info", detail: "No receiver connection is reported." }
  }

  return status?.previewOpen
    ? { label: "Window open", tone: "info", detail: "Host output window is open; local displays do not report receiver acknowledgement." }
    : { label: "Window closed", tone: "warn", detail: "Host output window is closed; local displays do not report receiver acknowledgement." }
}
