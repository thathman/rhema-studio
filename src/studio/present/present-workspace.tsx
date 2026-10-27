import { outputOnAir } from "@/lib/output-on-air"
import { useCloudConsentStore } from "@/stores/cloud-consent-store"
import { leaveRehearsal, showRehearsalLive } from "@/stores/approval-gate-store"
import { useEffect, useState, useSyncExternalStore } from "react"
import { ArrowUpIcon, BookOpenIcon, GiftIcon, HandIcon, HeartIcon, ImageIcon, SquareIcon, TriangleAlertIcon, UndoIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { LiveOutputPanel } from "@/components/panels/live-output-panel"
import { useBibleStore, useBroadcastStore, useQueueStore, useTranscriptStore } from "@/stores"
import { useShellStore } from "@/studio/shell-store"
import { useServiceStore } from "@/stores/service-store"
import { presentActions } from "@/studio/present-actions"
import { keyToPresentAction, shouldIgnoreKeyboard } from "@/studio/present-keys"
import { BigButton } from "@/studio/ui/big-button"
import { StatusChip } from "@/studio/ui/status-chip"
import { TimedMoves } from "@/studio/present/timed-moves"
import { PhaseStrip } from "@/studio/present/phase-strip"
import { RundownList } from "@/studio/present/rundown-list"
import { QuickFind } from "@/studio/present/quick-find"
import { ServiceTimer } from "@/studio/present/service-timer"
import { AuxTimers } from "@/studio/present/aux-timers"
import { StageMessage } from "@/studio/present/stage-message"
import { LowerThirdControl } from "@/studio/present/lower-third"
import { TickerRow } from "@/studio/present/ticker"
import { ObsChip } from "@/studio/present/obs-chip"
import { SoundChip } from "@/studio/present/sound-chip"
import { CueMenu } from "@/studio/present/cue-menu"
import { TransportBar } from "@/studio/present/transport-bar"
import { ScenesStrip } from "@/studio/present/scenes-strip"
import { LiveToolsDrawer, type LiveToolsTab } from "@/studio/present/live-tools-drawer"

export function PresentWorkspace() {
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsTab, setToolsTab] = useState<LiveToolsTab>("bible")
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
  const startsAt = useQueueStore((s) => (s.headers.find((h) => h.type === "phase" && h.role === "main") ?? s.headers.find((h) => h.type === "phase" && h.rule === "manual"))?.starts_at ?? null)
  const onAir = outputs.filter((o) => outputOnAir(o, outputStatus[o.id])).length

  // Register one keyboard map for the whole Live console. shouldIgnoreKeyboard
  // suppresses it while the tools drawer or another modal is open.
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
    <div className="flex h-full flex-col">
      {/* One Live console: Run of show, Preview, Program and Take never change with a view preference. */}
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border px-[22px] pt-3.5 pb-3 [@media(max-height:860px)]:gap-1.5 [@media(max-height:860px)]:pt-2 [@media(max-height:860px)]:pb-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.4375rem] leading-tight font-bold tracking-[-0.04em] [@media(max-height:860px)]:text-lg">Live console</h1>
            <p className="truncate text-[0.6875rem] text-muted-foreground">{service ? `${service.title}${startsAt ? ` · starts ${startsAt}` : ""}` : "What is next in your service"}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusChip
              tone={isLive && liveRef ? (rehearsal ? "warn" : "live") : "off"}
              label={isLive && liveRef ? `${rehearsal ? "REHEARSAL" : "LIVE"} · ${liveRef}` : liveRef ? `Off air · Restore shows ${liveRef}` : rehearsal ? "Rehearsal · nothing live" : "Nothing live"}
              className="max-w-80"
            />
            <StatusChip
              tone={rehearsal ? "warn" : "off"}
              label={rehearsal ? "Rehearsal on" : "Rehearsal off"}
              onClick={() => (rehearsal ? leaveRehearsal() : useBroadcastStore.getState().setRehearsal(true))}
              title={rehearsal ? "Outputs, NDI and the stage screen are frozen. Click to leave rehearsal: they keep showing what they showed before it." : "Practise without touching any screen: outputs, NDI and the stage screen keep what they show now."}
            />
            {rehearsal && (
              <StatusChip
                tone="warn"
                label="Show this live"
                onClick={showRehearsalLive}
                title="Leave rehearsal and put what is up here on the screens (the approval question applies). Scenes taken in rehearsal are not kept."
              />
            )}
            <StatusChip
              tone={onAir > 0 ? "ok" : "warn"}
              label={onAir > 0 ? `${onAir}/${outputs.length} outputs on` : "No output on a screen"}
              onClick={openOutputs}
              title="Open outputs"
            />
          </div>
        </div>
        <div role="toolbar" aria-label="Live tools" className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-tour="live-tools"
            aria-label="Open Bible and listening tools"
            aria-controls="live-tools-panel"
            aria-expanded={toolsOpen}
            title="Search the Bible and review what listening has heard"
            onClick={() => setToolsOpen(true)}
          >
            <BookOpenIcon /> Bible &amp; listening
          </Button>
          <StatusChip tone={listening ? "ok" : "off"} label={listening ? (cloudSpeech ? "Listening (Deepgram)" : "Listening") : "Listening off"} title={listening && cloudSpeech ? "Microphone sound is being sent to Deepgram" : undefined} />
          {listening && autoLive && (
            <StatusChip
              tone="warn"
              label="Auto-live on"
              title="Heard verses can change the Bible source without Take live. Click to turn this off; the Auto control is in the Program panel."
              onClick={() => useBroadcastStore.getState().setAutoLive(false)}
            />
          )}
          <ServiceTimer />
          <AuxTimers />
          <ObsChip />
          <SoundChip />
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
        </div>
        {/* Always present, so screen readers announce changes: what is on air, and warnings about it. */}
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {isLive && liveRef ? `${rehearsal ? "Rehearsal" : "On air"}: ${liveRef}` : "Off air"}
        </span>
        <span role="alert" aria-atomic="true" className="sr-only">{warning ?? ""}</span>
      </header>
      <LiveToolsDrawer open={toolsOpen} onOpenChange={setToolsOpen} tab={toolsTab} onTabChange={setToolsTab} />
      <div className="relative min-h-0 flex-1">
        <LiveConsoleSurface />
      </div>
    </div>
  )
}

/** Below this width the console has no room for the Preview panel: a one-line Preview sits over the transport. */
const NARROW_PRESENT_QUERY = "(max-width: 1199.98px)"
function subscribeNarrow(onChange: () => void): () => void {
  const mq = typeof window.matchMedia === "function" ? window.matchMedia(NARROW_PRESENT_QUERY) : null
  mq?.addEventListener?.("change", onChange)
  return () => mq?.removeEventListener?.("change", onChange)
}
const isNarrow = () => typeof window.matchMedia === "function" && window.matchMedia(NARROW_PRESENT_QUERY).matches

function LiveConsoleSurface() {
  // One Preview at a time (the panel also follows translation changes): full when it fits, else the line.
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false)
  const isLive = useBroadcastStore((s) => s.isLive)
  const count = useQueueStore((s) => s.items.length)
  const hasTimedItems = useQueueStore((s) => s.items.some((i) => i.auto_advance))
  const held = useBroadcastStore((s) => s.heldLive !== null)
  const quickOnAir = useBroadcastStore((s) => s.liveVerse?.quickScreen ?? null)
  const service = useServiceStore((s) => s.current)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 max-[1200px]:gap-2 max-[1200px]:p-3 [@media(max-height:860px)]:gap-2 [@media(max-height:860px)]:pt-2.5">
    <PhaseStrip />
    <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(6rem,1fr)_auto_minmax(0,15rem)] [@media(max-height:860px)]:grid-rows-[minmax(6rem,1fr)_auto_minmax(0,14.5rem)] gap-3 max-[1200px]:grid-cols-[13rem_minmax(0,1fr)] max-[1200px]:gap-2">
      <section className="row-span-3 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-sunken" data-tour="present-rundown">
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">Running order</h2>
            <p className="truncate text-xs text-muted-foreground">{service ? `${service.title}${service.service_date ? ` · ${service.service_date}` : ""}` : "What is next in your service"}</p>
          </div>
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{count} {count === 1 ? "item" : "items"}</span>
        </div>
        {hasTimedItems && (
          <div className="flex justify-end border-b border-border px-4 py-1.5">
            <TimedMoves />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <RundownList mode="present" />
        </div>
      </section>
      {/* On a wide window these sit in the grid itself; on a narrow one (1024×600 and up) they share one
          column that scrolls when it must, so nothing in it is ever drawn over another part. */}
      <div className="contents max-[1200px]:row-span-3 max-[1200px]:flex max-[1200px]:min-h-0 max-[1200px]:flex-col max-[1200px]:gap-2 max-[1200px]:overflow-y-auto">
      {!narrow && (
        <div className="min-h-0 overflow-hidden rounded-xl [&>div]:h-full">
          <PreviewPanel />
        </div>
      )}
      {/* Live, with the congregation scenes under it: a scene Take changes a screen's layout, not what is live.
          Opening the scenes on a short window scrolls this column instead of covering the transport. */}
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto max-[1200px]:min-h-fit max-[1200px]:flex-1 max-[1200px]:overflow-visible">
        {/* Never shorter than a readable picture with its sources, however many lines they take: the open
            scenes scroll under it instead. */}
        <div className="min-h-min flex-1 overflow-hidden rounded-xl [&_[data-slot=live-picture]]:min-h-24 [&>div]:h-full" data-studio-live>
          <LiveOutputPanel />
        </div>
        <ScenesStrip />
      </div>

      {/* What Take live will put up, right over it, when the window is too narrow for the Preview panel. */}
      {narrow && <div className="shrink-0"><PreviewPanel compact /></div>}
      <TransportBar className="col-span-2 max-[1200px]:shrink-0" />

      <div className="col-span-2 grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 max-[1200px]:h-[14.5rem] max-[1200px]:shrink-0">
        <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-4" data-tour="quick-find">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Find &amp; cue anything</h2>
            <p className="text-xs text-muted-foreground">A reference, a hymn number, or a few words</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1"><QuickFind mode="present" /></div>
        </section>
        <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-4" role="group" aria-label="Quick screens">
          {/* Back sits in the header so it is never clipped on a short (1366x768) screen; the screens scroll if they must. */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">One-touch moments</h2>
              <p className="text-xs text-muted-foreground">Temporary screens, with safe return</p>
            </div>
            <BigButton icon={<UndoIcon />} label="Back" hint="to what was live" disabled={!held} onClick={presentActions.back} className="h-11 min-w-0" />
          </div>
          {/* Four across, two rows: on a small window the icons give way so every screen stays in view. */}
          <div className="-m-1 grid min-h-0 grid-cols-4 content-start gap-2 overflow-y-auto p-1 max-[1200px]:gap-1.5">
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
                  className="h-11 min-w-0 justify-start gap-1.5 px-2.5 text-[0.8125rem] leading-tight max-[1200px]:justify-center max-[1200px]:px-1.5 max-[1200px]:text-xs max-[1200px]:[&>span:first-child]:hidden [&_svg]:!size-4"
                  onClick={() => presentActions.quickScreen(s)}
                />
              )
            })}
          </div>
          <TickerRow />
        </section>
      </div>
      </div>
    </div>
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

