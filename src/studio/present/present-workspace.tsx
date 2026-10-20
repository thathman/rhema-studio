import { useEffect } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  MonitorIcon,
  RotateCcwIcon,
  SquareIcon,
  LayoutGridIcon,
  LayoutPanelLeftIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Dashboard } from "@/components/layout/dashboard"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { LiveOutputPanel } from "@/components/panels/live-output-panel"
import { PanelHeader } from "@/components/ui/panel-header"
import { useBibleStore, useBroadcastStore, useQueueStore, useTranscriptStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { useServiceStore } from "@/stores/service-store"
import { presentActions } from "@/studio/present-actions"
import { keyToPresentAction, shouldIgnoreKeyboard } from "@/studio/present-keys"
import { BigButton } from "@/studio/ui/big-button"
import { StatusChip, WorkspaceHeader } from "@/studio/ui/status-chip"
import { RundownList } from "@/studio/present/rundown-list"
import { QuickFind } from "@/studio/present/quick-find"
import { useSongStore } from "@/stores/song-store"
import { buildSlides } from "@/lib/lyrics"
import { isSongItem } from "@/types"

/** "Next: Chorus" while a song is live, else the keyboard hint. */
function useNextHint(): string {
  const liveSlide = useBroadcastStore((s) => s.liveSlide)
  const items = useQueueStore((s) => s.items)
  const song = useSongStore((s) => (liveSlide ? s.songs[liveSlide.songId] : undefined))
  if (!liveSlide || !song) return "→ / PgDn"
  const item = items.find((i) => i.id === liveSlide.itemId)
  if (!item || !isSongItem(item)) return "→ / PgDn"
  const next = buildSlides(song, item.song.arrangement_id, item.song.languages)[liveSlide.index + 1]
  return next ? `Next: ${next.sectionLabel}` : "→ / PgDn"
}

export function PresentWorkspace() {
  const view = useShellStore((s) => s.presentView)
  const setView = useShellStore((s) => s.setPresentView)
  const openOutputs = useShellStore((s) => s.openOutputs)
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveRef = useBroadcastStore((s) => s.liveVerse?.reference ?? null)
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const listening = useTranscriptStore((s) => s.isTranscribing)
  const service = useServiceStore((s) => s.current)
  const warning = useBroadcastStore((s) => s.presentWarning)
  const override = useBibleStore((s) => s.overrideServiceTranslations)
  const setOverride = useBibleStore((s) => s.setOverrideServiceTranslations)
  const activeAbbrev = useBibleStore((s) => s.translations.find((t) => t.id === s.activeTranslationId)?.abbreviation ?? "active")
  const onAir = outputs.filter((o) => outputStatus[o.id]?.previewOpen || outputStatus[o.id]?.ndiActive).length

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader title="Present" subtitle={service ? `${service.title}${service.service_date ? ` · ${service.service_date}` : ""}` : undefined}>
        <StatusChip
          tone={isLive && liveRef ? "live" : "off"}
          label={isLive && liveRef ? `LIVE · ${liveRef}` : "Nothing live"}
          className="max-w-80"
        />
        <StatusChip
          tone={onAir > 0 ? "ok" : "warn"}
          label={onAir > 0 ? `${onAir}/${outputs.length} outputs on` : "No output on a screen"}
          onClick={openOutputs}
          title="Open outputs"
        />
        <StatusChip tone={listening ? "ok" : "off"} label={listening ? "Listening" : "Listening off"} />
        {service && (
          <StatusChip
            tone={override ? "warn" : "info"}
            label={override ? `Override: ${activeAbbrev}` : "Saved translations"}
            onClick={() => setOverride(!override)}
            title={
              override
                ? `Service items are shown in ${activeAbbrev} instead of the translation they were saved with. Click to use the saved translations.`
                : `Service items are shown in the translation they were saved with. Click to override and use ${activeAbbrev} for everything.`
            }
          />
        )}
        {warning && (
          <StatusChip tone="warn" label={warning} className="max-w-96" title={warning} onClick={() => useBroadcastStore.getState().setPresentWarning(null)} />
        )}
        <div role="group" aria-label="Present view" className="ml-2 flex rounded-md border border-border p-0.5">
          {(["standard", "production"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium capitalize [&_svg]:size-3.5",
                view === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v === "standard" ? <LayoutPanelLeftIcon /> : <LayoutGridIcon />}
              {v}
            </button>
          ))}
        </div>
      </WorkspaceHeader>
      <div className="relative min-h-0 flex-1">
        {view === "standard" ? <StandardView /> : <Dashboard />}
      </div>
    </div>
  )
}

function StandardView() {
  const isLive = useBroadcastStore((s) => s.isLive)
  const hasLiveItem = useBroadcastStore((s) => s.liveVerse !== null)
  const count = useQueueStore((s) => s.items.length)
  const canRestore = !isLive && hasLiveItem
  const nextHint = useNextHint()

  // Keyboard verbs, only in Standard view and never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || shouldIgnoreKeyboard(e.target)) return
      const action = keyToPresentAction(e)
      if (!action) return
      e.preventDefault()
      presentActions[action]()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_minmax(0,14rem)] gap-3 p-3">
      <div className="grid min-h-0 grid-cols-[18rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 max-[1200px]:grid-cols-[16rem_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <PanelHeader title="Service">
            <span className="text-xs text-muted-foreground">{count}</span>
          </PanelHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <RundownList mode="present" />
          </div>
        </section>
        <div className="min-h-0 overflow-hidden max-[1200px]:hidden [&>div]:h-full">
          <PreviewPanel />
        </div>
        <div className="min-h-0 overflow-hidden [&>div]:h-full" data-studio-live>
          <LiveOutputPanel />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3" role="toolbar" aria-label="Presentation controls">
        <BigButton icon={<ChevronLeftIcon />} label="Previous" hint="← / PgUp" onClick={presentActions.prev} disabled={count === 0} />
        <BigButton icon={<ChevronRightIcon />} label="Next" hint={nextHint} onClick={presentActions.next} disabled={count === 0} className="min-w-36" />
        <BigButton icon={<MonitorIcon />} label="Show live" hint="present the preview" tone="live" onClick={presentActions.showLive} className="ml-4 min-w-40" />
        <span className="ml-4 flex gap-2" role="group" aria-label="Continue the reading">
          <BigButton icon={<ChevronsLeftIcon />} label="Verse −" hint="Shift+←" onClick={presentActions.versePrev} disabled={!hasLiveItem} title="Present the verse before the live one" />
          <BigButton icon={<ChevronsRightIcon />} label="Verse +" hint="Shift+→" onClick={presentActions.verseNext} disabled={!hasLiveItem} title="Present the next verse of the live passage" />
        </span>
        <span className="ml-auto flex gap-3">
          <BigButton icon={<SquareIcon />} label="Clear" hint="Esc" tone="danger" onClick={presentActions.clear} disabled={!isLive} />
          <BigButton icon={<RotateCcwIcon />} label="Restore" hint="Shift+Esc" onClick={presentActions.restore} disabled={!canRestore} />
        </span>
      </div>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card p-3">
        <QuickFind mode="present" />
      </section>
    </div>
  )
}
