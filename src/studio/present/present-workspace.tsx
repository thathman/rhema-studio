import { useCloudConsentStore } from "@/stores/cloud-consent-store"
import { leaveRehearsal } from "@/stores/approval-gate-store"
import { useEffect } from "react"
import { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon, GiftIcon, HandIcon, HeartIcon, ImageIcon, LayoutGridIcon, LayoutPanelLeftIcon, MonitorIcon, RotateCcwIcon, SquareIcon, TriangleAlertIcon, UndoIcon } from "lucide-react"
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
import { ServiceTimer } from "@/studio/present/service-timer"
import { StageMessage } from "@/studio/present/stage-message"
import { LowerThirdControl } from "@/studio/present/lower-third"
import { TickerControl } from "@/studio/present/ticker"
import { ObsChip } from "@/studio/present/obs-chip"
import { SoundChip } from "@/studio/present/sound-chip"
import { CueMenu } from "@/studio/present/cue-menu"
import { useSongStore } from "@/stores/song-store"
import { buildSlides } from "@/lib/lyrics"
import { isSongItem } from "@/types"

/** "Next: Chorus" while a song is live, else the keyboard hint. */
function useNextHint(): string {
  const liveSlide = useBroadcastStore((s) => s.liveSlide)
  const items = useQueueStore((s) => s.items)
  const saved = useSongStore((s) => (liveSlide ? s.songs[liveSlide.songId] : undefined))
  // The song as it went live: what Next steps through.
  const song = liveSlide?.song ?? saved
  if (!liveSlide || !song) return "→ / PgDn"
  const item = items.find((i) => i.id === liveSlide.itemId)
  if (!item || !isSongItem(item)) return "→ / PgDn"
  // The arrangement the song went live with: the one Next steps through.
  const arrangement = liveSlide.arrangementId !== undefined ? liveSlide.arrangementId : item.song.arrangement_id
  const next = buildSlides(song, arrangement, liveSlide.languages ?? item.song.languages)[liveSlide.index + 1]
  return next ? `Next: ${next.sectionLabel}` : "→ / PgDn"
}

export function PresentWorkspace() {
  const view = useShellStore((s) => s.presentView)
  const setView = useShellStore((s) => s.setPresentView)
  const openOutputs = useShellStore((s) => s.openOutputs)
  const isLive = useBroadcastStore((s) => s.isLive)
  // Verses carry a reference; quick screens and custom slides may only have lines.
  const liveRef = useBroadcastStore((s) => (s.liveVerse ? s.liveVerse.reference || s.liveVerse.lines?.[0] || "Slide" : null))
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const listening = useTranscriptStore((s) => s.isTranscribing)
  const autoLive = useBroadcastStore((s) => s.autoLive)
  const cloudSpeech = useCloudConsentStore((s) => s.runningProvider === "deepgram")
  const service = useServiceStore((s) => s.current)
  const warning = useBroadcastStore((s) => s.presentWarning)
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const override = useBibleStore((s) => s.overrideServiceTranslations)
  const setOverride = useBibleStore((s) => s.setOverrideServiceTranslations)
  const activeAbbrev = useBibleStore((s) => s.translations.find((t) => t.id === s.activeTranslationId)?.abbreviation ?? "active")
  const onAir = outputs.filter((o) => outputStatus[o.id]?.previewOpen || outputStatus[o.id]?.ndiActive).length

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader title="Present" subtitle={service ? `${service.title}${service.service_date ? ` · ${service.service_date}` : ""}` : undefined}>
        <StatusChip
          tone={isLive && liveRef ? (rehearsal ? "warn" : "live") : "off"}
          label={isLive && liveRef ? `${rehearsal ? "REHEARSAL" : "LIVE"} · ${liveRef}` : liveRef ? `Off air · Restore shows ${liveRef}` : rehearsal ? "Rehearsal · nothing live" : "Nothing live"}
          className="max-w-80"
        />
        <StatusChip
          tone={rehearsal ? "warn" : "off"}
          label={rehearsal ? "Rehearsal on" : "Rehearsal off"}
          onClick={() => (rehearsal ? leaveRehearsal() : useBroadcastStore.getState().setRehearsal(true))}
          title={rehearsal ? "Outputs, NDI and the stage screen are frozen. Click to go back to normal; they will show the current content." : "Practise without touching any screen: outputs, NDI and the stage screen keep what they show now."}
        />
        <StatusChip
          tone={onAir > 0 ? "ok" : "warn"}
          label={onAir > 0 ? `${onAir}/${outputs.length} outputs on` : "No output on a screen"}
          onClick={openOutputs}
          title="Open outputs"
        />
        <StatusChip tone={listening ? "ok" : "off"} label={listening ? (cloudSpeech ? "Listening (Deepgram)" : "Listening") : "Listening off"} title={listening && cloudSpeech ? "Microphone sound is being sent to Deepgram" : undefined} />
        {listening && autoLive && (
          <StatusChip
            tone="warn"
            label="Auto-live on"
            title="Verses heard in the sermon replace what is on screen without Show live. Click to turn off (also the Auto switch on the Live panel in Production view)."
            onClick={() => useBroadcastStore.getState().setAutoLive(false)}
          />
        )}
        <ServiceTimer />
        <ObsChip />
        <SoundChip />
        <TickerControl />
        <LowerThirdControl />
        <StageMessage />
        <CueMenu />
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
        {/* Always present, so screen readers announce changes: what is on air, and warnings about it. */}
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {isLive && liveRef ? `${rehearsal ? "Rehearsal" : "On air"}: ${liveRef}` : "Off air"}
        </span>
        <span role="alert" aria-atomic="true" className="sr-only">{warning ?? ""}</span>
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
  const held = useBroadcastStore((s) => s.heldLive !== null)
  const quickOnAir = useBroadcastStore((s) => s.liveVerse?.quickScreen ?? null)

  // Keyboard verbs, only in Standard view and never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || shouldIgnoreKeyboard(e.target, e.key)) return
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
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card" data-tour="present-rundown">
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

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-lg border border-border bg-card p-3">
        <div className="flex min-h-0 flex-col [&>*]:min-h-0 [&>*]:flex-1" data-tour="quick-find"><QuickFind mode="present" /></div>
        <div className="flex min-h-0 flex-col gap-2 border-l border-border pl-3" role="group" aria-label="Quick screens">
          {/* Back sits in the header so it is never clipped on a short (1366x768) screen; the screens scroll if they must. */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">Quick screens</p>
            <BigButton icon={<UndoIcon />} label="Back" hint="to what was live" disabled={!held} onClick={presentActions.back} className="h-11 min-w-0" />
          </div>
          <div className="-m-1 grid min-h-0 grid-cols-3 content-start gap-2 overflow-y-auto p-1">
            {(["welcome", "stand", "pray", "offering", "technical", "logo", "black"] as const).map((s) => {
              // Calm until pressed: only the screen that is on air turns red, so the row also says what is showing.
              const onAir = isLive && quickOnAir === s
              return (
                <BigButton
                  key={s}
                  icon={QUICK_ICONS[s]}
                  label={{ welcome: "Welcome", stand: "Please stand", pray: "Let us pray", offering: "Offering", technical: "Technical issue", logo: "Logo", black: "Black" }[s]}
                  tone={onAir ? "live" : "neutral"}
                  aria-pressed={onAir}
                  className="h-11 min-w-0 justify-start gap-2 px-3 [&_svg]:!size-4"
                  onClick={() => presentActions.quickScreen(s)}
                />
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}

const QUICK_ICONS = {
  welcome: <HandIcon />,
  stand: <ArrowUpIcon />,
  pray: <HeartIcon />,
  offering: <GiftIcon />,
  technical: <TriangleAlertIcon />,
  logo: <ImageIcon />,
  black: <SquareIcon className="fill-current" />,
} as const

