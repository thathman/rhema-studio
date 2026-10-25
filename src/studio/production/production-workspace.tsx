import { offsetWords, useServiceOffset } from "@/stores/service-offset-store"
import { RUN_STATE_WORDS } from "@/lib/timing-state"
import type { SectionTiming } from "@/lib/timing-engine"
import { useTimingTrust } from "@/stores/timing-trust-store"
import { timeText } from "@/lib/church-time"
import { churchTimeZone } from "@/stores/timing-input"
import { useSettingsStore } from "@/stores/settings-store"
import { outputOnAir } from "@/lib/output-on-air"
import { useEffect, useState } from "react"
import { CheckIcon, GlobeIcon, InfoIcon, MonitorIcon, PauseIcon, PlayIcon, RadioIcon, RotateCcwIcon, SettingsIcon, TriangleAlertIcon, TvIcon, VideoIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { elapsedMs, formatMs, isRunning, remainingMs, timerTone } from "@/lib/timer"
import { resetTimerLogged } from "@/lib/timer-reset"
import { openSettings } from "@/lib/settings-dialog"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { useBroadcastStore, type OutputFrame } from "@/stores/broadcast-store"
import { CameraControls } from "@/studio/production/camera-controls"
import { useObsProgramCameras, useScreenPlayback } from "@/studio/production/camera-hooks"
import { playbackWords } from "@/lib/camera-playback"
import { cameraPathOf } from "@/lib/live-sources"
import { attention, cameraHealth, cameraStateWords, cameraWords, capacityAttention, cpuWords, feedSummary, heatWords, memoryWords, ndiRateWords, networkWords, showing, tvCheckWords, useFeedHealthStore, type Attention, type CameraHealth, type HealthLine } from "@/lib/show-health"
import { CAPACITY_KINDS, NDI_60_MIN_CORES, NDI_60_MIN_MEMORY_GB, capacityLimits, capacityUse, physicalCores, suits60fps, useMachineInfo } from "@/lib/capacity"
import { useMachineHealth, type NdiMeasure } from "@/studio/production/use-machine-health"
import { useRouterHealth } from "@/lib/cameras"
import { invoke } from "@tauri-apps/api/core"
import { feedHealthLabel, revokeTv, useFeedHealth } from "@/lib/browser-feeds"
import { hostLostWords, overscanPct, screenPrivacyWords, tvKeyWords, tvSizeWords } from "@/lib/feed-receivers"
import { outputDestination, outputFollows, outputPresentation, outputTransport } from "@/lib/output-summary"
import { congregationProgramName, onlineProgramName } from "@/lib/program-names"
import { useObsStore } from "@/stores/obs-store"
import { recordWords, streamWords } from "@/lib/obs-status"
import { CLAP_LISTEN_MS, TONE_DBFS, TONE_HZ, canChooseToneOutput, clapTest, clapWords, startTestTone } from "@/lib/sound-check"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { safeArea, safeAreaWords } from "@/lib/theme-look"
import type { BroadcastOutput, BroadcastOutputStatus, BroadcastTheme, ReceiverTv, Scene } from "@/types"
import { useJournalStore } from "@/stores/journal-store"
import { useMediaStore } from "@/stores/media-store"
import { useShellStore } from "@/studio/shell-store"
import { useServiceTiming } from "@/studio/use-service-timing"
import { useReadiness } from "@/studio/use-readiness"
import { HoldControl } from "@/studio/present/service-timer"
import { AuxTimersPanel } from "@/studio/present/aux-timers"
import { timeChangeWords, useTimeChange } from "@/stores/time-change-store"
import type { ReadinessCheck } from "@/studio/readiness"
import { SceneComposer } from "@/studio/production/scene-composer"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import { openProductionTab, useProductionTab, type ProductionTab } from "@/studio/production/production-tab"
import { CamerasPanel } from "@/studio/production/cameras-panel"
import { ObsPanel } from "@/studio/production/obs-panel"
import { ReadyMadeFeeds } from "@/studio/production/ready-made-feeds"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"
import { countdownLine, countdownTarget } from "@/lib/countdown"
import { CountdownSelect } from "@/studio/production/countdown-select"

type Tab = ProductionTab
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["timekeeper", "Timekeeper"],
  ["screens", "Screens"],
  ["health", "Show health"],
  // Scenes (the id stays "programs", so saved links and other pages keep working).
  ["programs", "Scenes"],
  ["obs", "OBS"],
  ["cameras", "Cameras"],
  ["operators", "Operators"],
]

// On the church's clock (#196 R1.1).
const hhmm = (ms: number) => timeText(ms, churchTimeZone())

function Card({ title, kicker, badge, children, className }: { title: string; kicker?: string; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card", className)} aria-label={title}>
      <header className="flex items-start justify-between gap-2 border-b border-border bg-surface-elevated px-[15px] py-3">
        <div className="min-w-0">
          {kicker && <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{kicker}</p>}
          <h2 className="text-sm font-bold tracking-[-0.02em]">{title}</h2>
        </div>
        {badge}
      </header>
      <div className="flex min-w-0 flex-col gap-3 p-[15px]">{children}</div>
    </section>
  )
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "live" | "off"; children: React.ReactNode }) {
  const cls = { ok: "bg-tone-green text-tone-green-foreground", warn: "bg-tone-amber text-tone-amber-foreground", live: "bg-tone-rose text-tone-rose-foreground", off: "bg-tone-neutral text-tone-neutral-foreground" }[tone]
  return <span className={cn("shrink-0 rounded-[5px] px-[7px] py-[5px] text-[0.625rem] font-bold tracking-[0.04em] uppercase", cls)}>{children}</span>
}

/**
 * Production control (approved design): the service's timing, screens, cameras and readiness in
 * one place. What is not built yet (the two-program parts, #197, #208) says so rather than offer
 * controls that do nothing.
 */
export function ProductionWorkspace() {
  const requested = useProductionTab((s) => s.requested)
  const [own, setOwn] = useState<Tab>("timekeeper")
  // A page that sent the operator here at a tab (the setup's Join choice) wins until a tab is clicked.
  const tab = requested ?? own
  const setTab = (t: Tab) => {
    useProductionTab.setState({ requested: null })
    setOwn(t)
  }
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-[29px] pt-[26px] pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">One service · production control</p>
            <h1 className="mt-1 text-2xl leading-tight font-bold tracking-[-0.035em]">Production control</h1>
            <p className="mt-1 text-xs text-muted-foreground">The service's timing, screens and readiness in one place. Nothing here takes anything live.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Badge tone="ok">This computer</Badge></div>
        </header>
        <nav role="tablist" aria-label="Production" className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn("-mb-px min-h-11 border-b-[3px] px-3.5 py-2.5 text-[0.6875rem] font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50", tab === id ? "border-primary text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </nav>
        <div role="tabpanel" aria-label={TABS.find(([id]) => id === tab)?.[1]}>
          {tab === "timekeeper" && <Timekeeper />}
          {tab === "screens" && <Screens />}
          {tab === "health" && <Health />}
          {tab === "programs" && <SceneComposer />}
          {tab === "obs" && <ObsPanel />}
          {tab === "cameras" && <CamerasPanel />}
          {tab === "operators" && <OperatorsPanel />}
        </div>
      </div>
    </div>
  )
}

function Timekeeper() {
  const timer = useTimerStore((s) => s.timer)
  useTimerStore((s) => s.tick)
  const now = monotonicNow()
  const running = isRunning(timer)
  const { timing, state } = useServiceTiming()
  // The item happening may warn earlier or later than two minutes before its end (#196 R1.3).
  const tone = timerTone(timer, now, timing?.events.find((e) => e.state === "live")?.warnMs)
  const shown = timer.durationMs > 0 ? remainingMs(timer, now) : elapsedMs(timer, now)
  const correct = (minutes: number) => {
    useTimerStore.getState().adjustMinutes(minutes, useSettingsStore.getState().operatorName.trim() || null)
    useJournalStore.getState().add({ kind: "timing", label: `timer corrected by ${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} min` })
  }
  const late = timing ? Math.round(timing.lateMs / 60_000) : 0
  return (
    <div className="grid gap-[18px] lg:grid-cols-2">
      <UntrustedTime />
      <Card kicker="Service clock" title="The service timer" badge={<Badge tone={running ? "ok" : "off"}>{running ? "Running" : "Paused"}</Badge>}>
        <div className="rounded-[10px] bg-[#182c32] px-[22px] py-5 text-[#eef6f0]">
          <p className="text-[0.625rem] font-extrabold tracking-[0.12em] text-[#b8cec6] uppercase">{timer.durationMs > 0 ? "Remaining" : "Elapsed"}</p>
          <p className={cn("font-mono text-[clamp(2.375rem,4.1vw,4rem)] leading-[1.15] font-semibold tracking-[-0.055em] tabular-nums", tone === "over" && "text-[#ff9b9d]", tone === "warn" && "text-[#ffd27a]")} role="timer">{formatMs(shown)}</p>
          <p className="text-xs text-[#b8cec6]">The same timer as Present; the stage display shows it.</p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[["Planned finish", timing ? hhmm(timing.plannedEnd) : "—"], ["Projected", timing ? hhmm(timing.expectedEnd) : "—"], ["Offset", timing ? (late === 0 ? "On time" : `${late > 0 ? "+" : "−"}${Math.abs(late)} min`) : "—"]].map(([k, v]) => (
            <div key={k} className="rounded-md bg-surface-sunken px-2 py-2">
              <dt className="text-[0.625rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">{k}</dt>
              <dd className={cn("text-lg font-bold tabular-nums", k === "Offset" && late > 0 && "text-confidence-mid")}>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => (running ? useTimerStore.getState().pause() : useTimerStore.getState().start())}>{running ? <><PauseIcon /> Pause</> : <><PlayIcon /> Start</>}</Button>
          <Button variant="outline" onClick={() => correct(-1)}>−1 min</Button>
          <Button variant="outline" onClick={() => correct(1)}>+1 min</Button>
          <Button variant="outline" onClick={() => resetTimerLogged()}><RotateCcwIcon /> Reset</Button>
        </div>
        <RunningLate />
        <LastTimeChange />
        <HoldControl />
      </Card>
      <Card kicker="Planned vs expected" title="The run of show" badge={<div className="flex items-center gap-2"><Badge tone={state === "running" ? "ok" : state === "held" || state === "untrusted" ? "warn" : "off"}>{RUN_STATE_WORDS[state]}</Badge><Button size="sm" variant="ghost" onClick={() => useShellStore.getState().setWorkspace("prepare")}>Edit run of show</Button></div>}>
        <EventClockBar />
        {!timing ? (
          <p className="text-xs text-muted-foreground">Give the main service a start time in Prepare to see planned and expected times here.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border text-xs">
            {timing.events.map((e) => {
              const off = Math.round((e.expectedStart - e.plannedStart) / 60_000)
              return (
                <li key={e.id} className="flex items-baseline gap-3 py-1.5">
                  <span className="w-12 shrink-0 font-mono text-muted-foreground tabular-nums">{hhmm(e.plannedStart)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{e.label}</span>
                  {e.milestone && <span className="text-muted-foreground">milestone</span>}
                  {e.untrusted && <span className="font-semibold text-confidence-mid">time not trusted</span>}
                  {e.overrun && e.state === "live" && <span className="font-semibold text-destructive">{e.softEnd !== null ? "past its soft end" : "running over"}</span>}
                  {e.state === "live" && e.heldMs > 0 && <span className="text-muted-foreground tabular-nums">held {formatMs(e.heldMs)}</span>}
                  {e.state === "live" && <Badge tone="live">Now</Badge>}
                  {e.state === "done" && <span className="text-muted-foreground">{e.milestone ? "reached" : "done"}</span>}
                  {e.state === "skipped" && <span className="text-muted-foreground">skipped</span>}
                  {e.state === "upcoming" && off !== 0 && <span className={cn("tabular-nums", off > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>→ {hhmm(e.expectedStart)}</span>}
                  {e.squeezed && <span className="font-semibold text-destructive">cut short</span>}
                </li>
              )
            })}
          </ol>
        )}
        {timing && <SectionFinishes sections={timing.sections} />}
      </Card>
      <CountdownCard />
      <Card kicker="Independent" title="Other timers">
        <AuxTimersPanel />
      </Card>
    </div>
  )
}

const CHIME_MINUTES = [0, 1, 2, 3, 5, 10]

/**
 * Time until the next item or a milestone (#196 R2), the same moment the screens' and stage's
 * countdowns use, and the chime on this computer (off unless turned on; never on the screens).
 */
function CountdownCard() {
  const prefs = useSettingsStore((s) => s.timekeeperCountdown)
  const targets = useBroadcastStore((s) => s.countdowns)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const set = useSettingsStore.getState().setTimekeeperCountdown
  const target = countdownTarget(targets, prefs.to)
  const line = target ? countdownLine(prefs.to, target, now) : null
  return (
    <Card kicker="Countdown" title="Time until" badge={prefs.chime || prefs.overtimeChime ? <Badge tone="ok">Chime on</Badge> : undefined}>
      <label className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">Count down to</span>
        <CountdownSelect label="Count down to" value={prefs.to} onChange={(to) => set({ to: to ?? "next" })} className="min-w-0 flex-1" />
      </label>
      <div className="rounded-[10px] bg-[#182c32] px-[22px] py-4 text-[#eef6f0]">
        <p className="truncate text-[0.625rem] font-extrabold tracking-[0.12em] text-[#b8cec6] uppercase">{line ? line.label : "Nothing to count down to"}</p>
        <p className={cn("font-mono text-[clamp(2rem,3.4vw,3.25rem)] leading-[1.15] font-semibold tracking-[-0.055em] tabular-nums", line?.tone === "over" && "text-[#ff9b9d]", line?.tone === "warn" && "text-[#ffd27a]")} role="timer" aria-label="Time until">{line?.text ?? "—"}</p>
        <p className="text-xs text-[#b8cec6]">{target ? `Expected at ${hhmm(target.at)}; moves as the service runs late or early.` : prefs.to === "next" ? "No next item: the last item is on, or the main service has no start time." : "That milestone is not in this run of show."}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Chime">
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" className="size-4" checked={prefs.chime} onChange={(e) => set({ chime: e.target.checked })} />
          Chime on this computer
        </label>
        <select aria-label="When the chime sounds" value={prefs.chimeMinutes} disabled={!prefs.chime} onChange={(e) => set({ chimeMinutes: Number(e.target.value) })} className="h-7 rounded-md border border-input bg-card px-1.5">
          {CHIME_MINUTES.map((m) => <option key={m} value={m}>{m === 0 ? "At zero only" : `${m} min before, and at zero`}</option>)}
        </select>
        <label className="flex basis-full items-center gap-2 font-semibold">
          <input type="checkbox" className="size-4" checked={!!prefs.overtimeChime} onChange={(e) => set({ overtimeChime: e.target.checked })} />
          Chime when the service timer runs over
        </label>
        <span className="basis-full text-muted-foreground">A short tone here only. The screens, the stage and the online feed never hear it.</span>
      </div>
    </Card>
  )
}

/**
 * Where everything goes (#213 show health; #299 UX15-4 cards): each output as a card with where it
 * goes, what it follows, how it presents it, its look and how its signal is doing; what needs
 * attention first. Editing opens the output's own editor; nothing here takes anything live.
 */
function Screens() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const frames = useBroadcastStore((s) => s.outputFrames)
  const scenes = useBroadcastStore((s) => s.scenes)
  const themes = useBroadcastStore((s) => s.themes)
  const openOutputs = useShellStore((s) => s.openOutputs)
  const needs = useNeeds()
  return (
    <Card kicker="Outputs" title="Screens, NDI senders and browser feeds" badge={<div className="flex flex-wrap justify-end gap-2"><ReadyMadeFeeds /><Button size="sm" onClick={openOutputs}><MonitorIcon /> Open outputs</Button></div>}>
      <NeedsAttention needs={needs} className="mb-2" />
      <ul aria-label="Outputs" className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {outputs.map((o) => <OutputInspector key={o.id} output={o} status={status[o.id]} frame={frames[o.id]} scenes={scenes} themes={themes} />)}
      </ul>
    </Card>
  )
}

/** Every camera Rhema knows, with what the router last said and how each screen plays it (#213); undefined router: no answer yet. */
function useCameraHealth(): CameraHealth[] {
  const cameras = useSettingsStore((s) => s.cameras)
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const controls = useBroadcastStore((s) => s.stateSources)
  const router = useRouterHealth()
  const screens = useScreenPlayback()
  return cameraHealth(cameras, scenes, outputs, status, router.checked ? router.status : undefined, { screens, controls })
}

/** What needs attention now: outputs, browser feeds and the cameras of scenes on air. */
function useNeeds(): Attention[] {
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const scenes = useBroadcastStore((s) => s.scenes)
  const feeds = useFeedHealthStore()
  const cameras = useCameraHealth()
  const screens = useScreenPlayback()
  const use = useCapacity()
  return [...attention(outputs, status, feeds, { cameras, scenes, screens }), ...capacityAttention(use.use, use.limits)]
}

/** What is running against what this computer suits (#243 G13). */
function useCapacity() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const scenes = useBroadcastStore((s) => s.scenes)
  const cameras = useSettingsStore((s) => s.cameras.length)
  const overrides = useSettingsStore((s) => s.capacityLimits)
  const machine = useMachineInfo()
  return { machine, use: capacityUse(outputs, status, scenes, cameras), limits: capacityLimits(machine, overrides) }
}

function NeedsAttention({ needs, className }: { needs: Attention[]; className?: string }) {
  if (needs.length === 0) return null
  return (
    <ul aria-label="Needs attention" className={cn("flex flex-col gap-1", className)}>
      {needs.map((n) => (
        <li key={n.outputId + n.text} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs", n.level === "high" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted text-foreground")}>
          <TriangleAlertIcon className="size-3.5 shrink-0" /> {n.text}
        </li>
      ))}
    </ul>
  )
}

const ROLE_NAMES = { congregation: "Congregation", stage: "Stage", signage: "Signage" } as const
const LANGUAGE_NAMES = { both: "Both languages, as prepared", first: "First language only", second: "Second language only" } as const
const SAMPLE_VERSE = { reference: "John 3:16", segments: [{ text: "For God so loved the world" }] }


function OutputInspector({ output: o, status: st, frame, scenes, themes }: { output: BroadcastOutput; status: BroadcastOutputStatus | undefined; frame: OutputFrame | undefined; scenes: Scene[]; themes: BroadcastTheme[] }) {
  const on = outputOnAir(o, st)
  const feed = useFeedHealth(o.id, o.type === "browser" && on)
  const role = o.role ?? "congregation"
  const theme = themes.find((t) => t.id === o.themeId)
  const ownLooks = Object.values(o.themeFor ?? {}).filter(Boolean).length
  const row = (label: string, value: React.ReactNode) => (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  )
  return (
    <li aria-label={o.name} className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border px-3 py-2.5">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground [&_svg]:size-4">{o.type === "browser" ? <GlobeIcon /> : o.type === "ndi" ? <RadioIcon /> : <MonitorIcon />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{o.name}</span>
          <span className="block text-xs text-muted-foreground">{outputTransport(o)} · {role === "congregation" ? congregationProgramName([o]) : ROLE_NAMES[role]}</span>
        </span>
        {st?.ndiError ? <Badge tone="warn">{st.ndiError}</Badge> : <Badge tone={on ? "ok" : "off"}>{on ? "On" : "Off"}</Badge>}
      </div>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-2.5 text-xs">
        {row("Goes to", <span className="break-words">{outputDestination(o)}</span>)}
        {row("Follows", outputFollows(o, theme))}
        {row("Presentation", outputPresentation(o, scenes, theme))}
        {role === "congregation" && row("Language", LANGUAGE_NAMES[o.language ?? "both"])}
        {role !== "stage" && row("Look", (
          <span className="flex items-center gap-2">
            {theme && (
              <span className="relative w-16 shrink-0 overflow-hidden rounded-[3px] border border-border bg-[#1d2327]">
                <CanvasVerse theme={theme} verse={SAMPLE_VERSE} className="w-full" />
                {/* The safe area, outlined. */}
                <span aria-hidden data-testid="safe-area-outline" className="pointer-events-none absolute border border-dashed border-white/50" style={{ left: `${safeArea(theme).left}%`, right: `${safeArea(theme).right}%`, top: `${safeArea(theme).top}%`, bottom: `${safeArea(theme).bottom}%` }} />
              </span>
            )}
            <span className="min-w-0">{theme?.name ?? "A look that is no longer saved"}{ownLooks > 0 && <span className="block text-muted-foreground">+ {ownLooks} content-specific {ownLooks === 1 ? "look" : "looks"}</span>}</span>
          </span>
        ))}
        {role !== "stage" && theme && row("Safe area", <span title="The space its look keeps clear at the screen's edges, so nothing is cut off. Change it in Design → the look → Composition → Safe area.">{safeAreaWords(theme)} <span className="text-muted-foreground">(its look)</span></span>)}
        {row("Now", <span className="block truncate">{showing(o, frame, scenes, on)}</span>)}
        {role === "congregation" && <CameraFollowsObs output={o} scenes={scenes} row={row} />}
        {o.type === "ndi" && on && typeof st?.ndiReceivers === "number" && row("Signal", `${st.ndiReceivers} ${st.ndiReceivers === 1 ? "receiver" : "receivers"}`)}
        {o.type === "browser" && on && feedHealthLabel(feed) && row("Signal", <span className={cn(feed?.behind && "text-destructive")}>{feedHealthLabel(feed)}</span>)}
        {o.type === "browser" && row("TVs", (o.tvs ?? []).length > 0 ? <TvList output={o} /> : <span className="text-muted-foreground">None yet: Edit output → Show on a Google TV. {hostLostWords(o.hostLost)}.</span>)}
      </dl>
      <div className="mt-auto flex justify-end border-t border-border px-3 py-2">
        <Button size="sm" variant="outline" onClick={() => useShellStore.getState().editOutput(o.id)} aria-label={`Edit ${o.name}`}><SettingsIcon /> Edit output</Button>
      </div>
    </li>
  )
}

/**
 * "Camera follows OBS" (#208 D3): the camera this output's scene plays is the one on OBS's program
 * now, so the room sees the same angle as the stream. Information only; nothing is changed.
 */
function CameraFollowsObs({ output, scenes, row }: { output: BroadcastOutput; scenes: Scene[]; row: (label: string, value: React.ReactNode) => React.ReactNode }) {
  const router = useRouterHealth()
  const onObs = useObsProgramCameras(router.status)
  const cameras = useSettingsStore((s) => s.cameras)
  const scene = output.sceneId ? scenes.find((s) => s.id === output.sceneId) : undefined
  const names = [...new Set((scene?.layers ?? []).filter((l) => l.kind === "camera" && l.visible && l.cameraUrl).map((l) => cameraPathOf(l.cameraUrl!)).filter((n): n is string => !!n))]
  if (names.length === 0) return null
  const same = names.filter((n) => onObs.has(n))
  const label = (n: string) => cameras.find((c) => c.name === n)?.label ?? n
  return row("Camera", same.length > 0 ? <span><Badge tone="off">Camera follows OBS</Badge> <span className="text-muted-foreground">{same.map(label).join(", ")} is on OBS's program too</span></span> : <span className="text-muted-foreground">{names.map(label).join(", ")}{onObs.size > 0 ? " · not the camera on OBS's program" : ""}</span>)
}

const ICON: Record<ReadinessCheck["status"], React.ReactNode> = {
  ok: <CheckIcon className="size-4 text-confidence-high" />,
  warn: <TriangleAlertIcon className="size-4 text-confidence-mid" />,
  info: <InfoIcon className="size-4 text-muted-foreground" />,
}

function Health() {
  const { ready, checks, openOutputs, setWorkspace } = useReadiness()
  const needs = useNeeds()
  const fix = (c: ReadinessCheck) => (c.fix === "outputs" ? openOutputs() : c.fix === "prepare" ? setWorkspace("prepare") : c.fix === "cameras" ? openProductionTab("cameras") : c.fix === "obs" ? openProductionTab("obs") : openSettings("diagnostics"))
  const live = useMachineHealth()
  return (
    <div className="flex flex-col gap-[18px]">
      <NeedsAttention needs={needs} />
      <Preflight ready={ready} checks={checks} fix={fix} />
      <div className="grid gap-[18px] lg:grid-cols-2">
        <ComputerHealth health={live.health} failed={live.failed} />
        <CapacityHealth />
        <NdiHealth ndi={live.ndi} />
        <ObsHealth />
        <CamerasHealth />
        <FeedsHealth />
        <SoundCheck />
      </div>
    </div>
  )
}

const LINE_TONE = { ok: "text-foreground", warn: "font-semibold text-confidence-mid", off: "text-muted-foreground" } as const

function HealthRow({ label, lines }: { label: string; lines: HealthLine[] }) {
  return (
    <li aria-label={label} className="flex items-start gap-3 py-2.5 text-xs">
      <span className="w-24 shrink-0 font-semibold">{label}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        {lines.map((l) => <span key={l.text} className={LINE_TONE[l.tone]}>{l.text}</span>)}
      </span>
    </li>
  )
}

/**
 * This computer now (#243 G13, AC.5): CPU load, memory, heat and network, read every few seconds
 * while Show health is open. Heat is what macOS on Intel reports; elsewhere it says it is not reported.
 */
function ComputerHealth({ health, failed }: { health: ReturnType<typeof useMachineHealth>["health"]; failed: boolean }) {
  const busy = !!health && [cpuWords(health), memoryWords(health), heatWords(health), ...networkWords(health)].some((l) => l.tone === "warn")
  return (
    <Card kicker="This computer" title="Load, memory, heat and network" badge={health && <Badge tone={busy ? "warn" : "ok"}>{busy ? "Check" : "Fine"}</Badge>}>
      {!health ? (
        <p className="text-xs text-muted-foreground">{failed ? "This computer's figures cannot be read here (Rhema Studio's desktop app reads them)." : "Reading…"}</p>
      ) : (
        <ul aria-label="This computer" className="flex flex-col divide-y divide-border">
          <HealthRow label="CPU load" lines={[cpuWords(health)]} />
          <HealthRow label="Memory" lines={[memoryWords(health)]} />
          <HealthRow label="Heat" lines={[heatWords(health)]} />
          <HealthRow label="Network" lines={networkWords(health)} />
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Updated every few seconds while this page is open. Nothing here is sent anywhere.</p>
    </Card>
  )
}

/** How much is running against what this computer suits (#243 G13): soft limits, changed in Settings → Outputs. */
function CapacityHealth() {
  const { machine, use, limits } = useCapacity()
  const over = CAPACITY_KINDS.some(({ kind }) => use[kind] > limits[kind])
  return (
    <Card kicker="Capacity" title="What this computer is running" badge={<Badge tone={over ? "warn" : "ok"}>{over ? "More than it suits" : "Within its limits"}</Badge>}>
      <ul aria-label="Capacity" className="flex flex-col divide-y divide-border">
        {CAPACITY_KINDS.map(({ kind, label }) => (
          <li key={kind} aria-label={label} className="flex items-center gap-3 py-2 text-xs">
            <span className="min-w-0 flex-1">{label}</span>
            <span className={use[kind] > limits[kind] ? LINE_TONE.warn : "tabular-nums"}>{use[kind]} of about {limits[kind]}</span>
          </li>
        ))}
        <li aria-label="60 fps NDI" className="flex items-center gap-3 py-2 text-xs">
          <span className="min-w-0 flex-1">60 fps NDI</span>
          <span className="text-muted-foreground">{suits60fps(machine) ? "Suits this computer" : `Asks first (below ${NDI_60_MIN_CORES} cores and ${NDI_60_MIN_MEMORY_GB} GB)`}</span>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        {machine.known ? `Worked out from this computer (${physicalCores(machine)} cores, ${Math.round(machine.memoryTotalMb / 1024)} GB).` : "This computer's size is not known here: these are a small laptop's."} Going past a limit only warns: screens may drop frames.
      </p>
      <div><Button size="sm" variant="outline" onClick={() => openSettings("screens")}><SettingsIcon /> Change limits</Button></div>
    </Card>
  )
}

/** Each NDI sender on: the frames a second it really sends and who watches (#246 C15), apart from whether it is on. */
function NdiHealth({ ndi }: { ndi: Record<string, NdiMeasure> }) {
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const on = outputs.filter((o) => o.type === "ndi" && outputOnAir(o, status[o.id]))
  return (
    <Card kicker="Signal" title="NDI senders">
      {on.length === 0 ? (
        <p className="text-xs text-muted-foreground">No NDI sender is on.</p>
      ) : (
        <ul aria-label="NDI signals" className="flex flex-col divide-y divide-border">
          {on.map((o) => {
            const m = ndi[o.id]
            const line = ndiRateWords(m?.rate ?? null, m?.fps ?? 0, m?.receivers ?? null)
            return (
              <li key={o.id} aria-label={o.name} className="flex items-start gap-3 py-2.5 text-xs">
                <RadioIcon aria-hidden className="mt-px size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 font-semibold">{o.name}</span>
                <span className={LINE_TONE[line.tone]}>{m ? line.text : "Measuring…"}</span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Frames really sent in the last few seconds. A still picture is sent only when it changes, so a low figure then is normal; while video or a ticker moves it should be near the frame rate.</p>
    </Card>
  )
}

function Preflight({ ready, checks, fix }: { ready: boolean; checks: ReadinessCheck[]; fix: (c: ReadinessCheck) => void }) {
  return (
    <Card kicker="Before the service" title="Sunday preflight" badge={<Badge tone={ready ? "ok" : "warn"}>{ready ? "Ready" : "Attention needed"}</Badge>}>
      <ul className="flex flex-col divide-y divide-border">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-3 py-2.5 text-xs">
            <span className="mt-px shrink-0">{ICON[c.status]}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{c.label}</span>
              {c.detail && <span className="block text-muted-foreground">{c.detail}</span>}
            </span>
            {c.fix && c.status !== "ok" && <Button size="sm" variant="soft" onClick={() => fix(c)}>{c.fixLabel ?? "Fix"}</Button>}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * Online (OBS) (#213 "check OBS online output separately", #208): the online program as OBS reports
 * it, apart from the congregation's: connected or not, its program scene, the church camera on it,
 * the stream and the recording. Information only; OBS is changed on the OBS tab.
 */
function ObsHealth() {
  const enabled = useSettingsStore((s) => s.obs.enabled)
  const status = useObsStore((s) => s.status)
  const error = useObsStore((s) => s.error)
  const program = useObsStore((s) => s.program)
  const video = useObsStore((s) => s.video)
  const stream = useObsStore((s) => s.stream)
  const record = useObsStore((s) => s.recordOutput)
  const cameras = useSettingsStore((s) => s.cameras)
  const router = useRouterHealth()
  const onObs = useObsProgramCameras(router.status)
  const connected = status === "connected"
  const s = streamWords(connected ? stream : null)
  const r = recordWords(connected ? record : null)
  const tone = (t: string) => (t === "live" ? "ok" : t) as HealthLine["tone"]
  const camNames = [...onObs].map((n) => cameraWords(cameras.find((c) => c.name === n)?.label ?? n))
  return (
    <Card kicker="Online (OBS)" title={onlineProgramName(connected ? video : null)} badge={<Badge tone={!enabled ? "off" : connected ? (stream?.active ? "live" : "ok") : "warn"}>{!enabled ? "Off" : connected ? (stream?.active ? "Streaming" : "Connected") : status === "connecting" ? "Connecting" : "Not connected"}</Badge>}>
      {!enabled ? (
        <p className="text-xs text-muted-foreground">OBS is not connected. It is optional: connect it in Settings → Remote control to see the online program here.</p>
      ) : !connected ? (
        <p className="text-xs text-confidence-mid">{status === "connecting" ? "Connecting to OBS…" : `Not connected${error ? `: ${error}` : ""}. Rhema Studio keeps trying every 15 seconds.`}</p>
      ) : (
        <ul aria-label="Online (OBS)" className="flex flex-col divide-y divide-border">
          <HealthRow label="Scene" lines={[{ text: program ?? "Not reported", tone: program ? "ok" : "off" }]} />
          <HealthRow label="Camera" lines={[camNames.length ? { text: `${camNames.join(", ")} on OBS's program`, tone: "ok" } : { text: "No church camera found on OBS's program", tone: "off" }]} />
          <HealthRow label="Stream" lines={[{ text: s.text, tone: tone(s.tone) }]} />
          <HealthRow label="Recording" lines={[{ text: r.text, tone: tone(r.tone) }]} />
        </ul>
      )}
      <div><Button size="sm" variant="outline" onClick={() => openProductionTab("obs")}><RadioIcon /> Open OBS</Button></div>
    </Card>
  )
}

/**
 * Sound checks (#213 rehearsal test): a 1 kHz tone at −18 dBFS on a chosen output until Stop, and a
 * clap test that listens on the microphone for a few seconds. Only when pressed; nothing is kept.
 */
function SoundCheck() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [output, setOutput] = useState("")
  const [tone, setTone] = useState<{ stop: () => void; where: string } | null>(null)
  const [toneError, setToneError] = useState<string | null>(null)
  const [clap, setClap] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const choose = canChooseToneOutput()
  const talkInput = useSettingsStore((s) => s.talkInputId)
  useEffect(() => {
    let live = true
    void navigator.mediaDevices?.enumerateDevices?.().then((d) => { if (live) setDevices(d) }).catch(() => {})
    return () => { live = false }
  }, [])
  // Leaving the page stops the tone.
  useEffect(() => () => tone?.stop(), [tone])
  const outputs = devices.filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default")
  const play = async () => {
    setToneError(null)
    try {
      const t = await startTestTone(output)
      setTone({ stop: t.stop, where: t.where === "chosen" ? outputs.find((d) => d.deviceId === output)?.label || "the chosen output" : "this computer's sound output" })
    } catch (e) {
      setToneError(e instanceof Error ? e.message : String(e))
    }
  }
  const stopTone = () => {
    tone?.stop()
    setTone(null)
  }
  const listen = async () => {
    setListening(true)
    setClap(null)
    try {
      setClap(clapWords(await clapTest(talkInput)))
    } catch (e) {
      setClap(`The microphone could not be opened: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setListening(false)
    }
  }
  return (
    <Card kicker="Before the service" title="Sound check" badge={tone && <Badge tone="live">Tone playing</Badge>}>
      <div className="flex flex-col gap-2 text-xs">
        <p className="font-semibold">Test tone · {TONE_HZ / 1000} kHz at {TONE_DBFS} dBFS</p>
        <div className="flex flex-wrap items-center gap-2">
          {choose && outputs.length > 0 && (
            <select aria-label="Test tone output" value={output} disabled={!!tone} onChange={(e) => setOutput(e.target.value)} className="h-8 max-w-56 rounded-md border border-input bg-card px-1.5">
              <option value="">This computer's sound output</option>
              {outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Sound output"}</option>)}
            </select>
          )}
          {tone ? <Button size="sm" variant="destructive" onClick={stopTone}><PauseIcon /> Stop tone</Button> : <Button size="sm" variant="outline" onClick={() => void play()}><PlayIcon /> Play test tone</Button>}
        </div>
        {tone && <p role="status">Playing on {tone.where} until you press Stop tone.</p>}
        {toneError && <p role="status" className="font-semibold text-confidence-mid">The tone could not play: {toneError}</p>}
        <p className="text-muted-foreground">{choose ? "" : "This computer plays the tone on its sound output (it cannot choose another here). "}Turn the sound desk's fader down first: line-up level is loud through a PA.</p>
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs">
        <p className="font-semibold">Clap test</p>
        <div><Button size="sm" variant="outline" disabled={listening} onClick={() => void listen()}>{listening ? `Listening for ${CLAP_LISTEN_MS / 1000} s… clap now` : "Listen for a clap"}</Button></div>
        {clap && <p role="status">{clap}</p>}
        <p className="text-muted-foreground">Listens on the talk microphone (or the system's) for a few seconds, only when pressed. Nothing is recorded or sent.</p>
      </div>
    </Card>
  )
}

/**
 * Each camera as the camera router sees it (#213): not running, not sending, or sending (what and
 * to how many), and the scenes and screens that use it. Real router answers only.
 */
function CamerasHealth() {
  const cams = useCameraHealth()
  const sources = useSettingsStore((s) => s.cameras)
  const router = useRouterHealth()
  const onObs = useObsProgramCameras(router.status)
  const ours = cams.filter((c) => c.state !== "elsewhere")
  const sending = ours.filter((c) => c.state === "sending").length
  return (
    <Card kicker="Signal" title="Cameras" badge={ours.length > 0 && <Badge tone={sending === ours.length ? "ok" : "warn"}>{sending} of {ours.length} sending</Badge>}>
      {cams.length === 0 ? (
        <p className="text-xs text-muted-foreground">No cameras yet. Add a phone or camera for each angle in Production → Cameras.</p>
      ) : (
        <ul aria-label="Camera signals" className="flex flex-col divide-y divide-border">
          {cams.map((c) => {
            const bad = c.state === "not-sending" || c.state === "router-off" || c.state === "frozen"
            const source = sources.find((s) => s.name === c.key)
            return (
              <li key={c.key} aria-label={c.label} className="flex items-start gap-3 py-2.5 text-xs">
                <VideoIcon aria-hidden className={cn("mt-px size-4 shrink-0", c.state === "sending" ? "text-confidence-high" : bad && c.onAir.length > 0 ? "text-destructive" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{cameraWords(c.label)}</span>
                  <span className={cn("block", bad && c.onAir.length > 0 ? "font-semibold text-destructive" : bad ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>{cameraStateWords(c)}</span>
                  <span className="block text-muted-foreground">
                    {c.scenes.length === 0 ? "Not in a scene yet" : `In ${c.scenes.join(", ")}`}
                    {c.onAir.length > 0 ? ` · on air on ${c.onAir.join(", ")}` : c.assigned.length > 0 ? ` · set on ${c.assigned.join(", ")}` : ""}
                  </span>
                  {(c.onBackup || c.held || onObs.has(c.key)) && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.onBackup && <Badge tone="warn">On backup: {c.onBackup}</Badge>}
                      {c.held && <Badge tone="warn">Frozen by you</Badge>}
                      {onObs.has(c.key) && <Badge tone="off">On OBS's program</Badge>}
                    </span>
                  )}
                  {(c.screens ?? []).length > 0 && (
                    <ul aria-label={`${c.label} on each screen`} className="mt-1 flex flex-col">
                      {c.screens!.map((s) => {
                        const w = playbackWords(s)
                        return <li key={`${s.outputId}|${s.where}`} className={cn(w.tone === "warn" ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>{s.where}: {w.text}</li>
                      })}
                    </ul>
                  )}
                  {source && <span className="mt-1.5 block"><CameraControls cam={source} /></span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div><Button size="sm" variant="outline" onClick={() => openProductionTab("cameras")}><VideoIcon /> Open Cameras</Button></div>
    </Card>
  )
}

/**
 * Each browser feed and the screens watching it (#213): how many pages drew the latest frame, and
 * the Google TVs it was sent to, each of which can be asked what it shows (Rhema Studio Receiver 1.1).
 */
function FeedsHealth() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const feeds = useFeedHealthStore()
  const browser = outputs.filter((o) => o.type === "browser")
  return (
    <Card kicker="Signal" title="Browser feeds and Google TVs">
      {browser.length === 0 ? (
        <p className="text-xs text-muted-foreground">No browser feeds. Add one in Outputs (Browser Feed) or with Ready-made feeds on the Screens tab.</p>
      ) : (
        <ul aria-label="Feed signals" className="flex flex-col divide-y divide-border">
          {browser.map((o) => {
            const on = outputOnAir(o, status[o.id])
            const sum = feedSummary(feeds[o.id], on)
            return (
              <li key={o.id} aria-label={o.name} className="flex flex-col gap-1.5 py-2.5 text-xs">
                <span className="flex items-start gap-3">
                  <GlobeIcon aria-hidden className="mt-px size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 font-semibold">{o.name}</span>
                  <span className={cn(sum.tone === "warn" ? "font-semibold text-confidence-mid" : sum.tone === "ok" ? "text-foreground" : "text-muted-foreground")}>{sum.text}</span>
                </span>
                <FeedPlayback output={o} />
                {(o.tvs ?? []).length > 0 && <div className="ml-7"><TvList output={o} /></div>}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">A screen counts once its page shows the feed; Show on a Google TV (in the feed's output settings) adds the TV here.</p>
    </Card>
  )
}

/** How each page of a feed (a Google TV, OBS Browser Source) plays the scene's cameras, as it measured (#213). */
function FeedPlayback({ output }: { output: BroadcastOutput }) {
  const cameras = useSettingsStore((s) => s.cameras)
  const screens = useScreenPlayback().filter((s) => s.outputId === output.id && !s.where.endsWith("(this computer)"))
  if (screens.length === 0) return null
  return (
    <ul aria-label={`Cameras on ${output.name}'s screens`} className="ml-7 flex flex-col gap-0.5">
      {screens.map((s) => {
        const w = playbackWords(s)
        const name = cameraWords(cameras.find((c) => c.name === s.camera)?.label ?? (s.camera || "A"))
        return <li key={`${s.where}|${s.camera}`} className={cn(w.tone === "warn" ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>{s.where}: {name.charAt(0).toLowerCase() + name.slice(1)} {w.text}</li>
      })}
    </ul>
  )
}

/**
 * A browser feed's paired TVs (#198): each one's display size, whether its link is its own or the
 * feed's shared one, the feed's rule for a lost host, whether its page follows the feed now, and
 * Check TV / Revoke. Revoking a TV with its own key cuts that TV at once; the others carry on.
 */
export function TvList({ output }: { output: BroadcastOutput }) {
  const tvs = output.tvs ?? []
  const health = useFeedHealthStore((s) => s[output.id])
  const assets = useMediaStore((s) => s.assets)
  if (tvs.length === 0) return null
  const picture = output.hostLost?.mediaId ? assets.find((a) => a.id === output.hostLost?.mediaId)?.name : undefined
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground">{screenPrivacyWords(output)} · {hostLostWords(output.hostLost, picture)}{output.overscan ? ` · ${overscanPct(output.overscan)}% kept clear at each edge` : ""}</span>
      <ul aria-label={`TVs showing ${output.name}`} className="flex flex-col gap-1">
        {tvs.map((tv) => <TvRow key={tv.address} output={output} tv={tv} watching={tv.token && health ? (health.tvs?.[tv.address] ?? 0) : undefined} />)}
      </ul>
    </div>
  )
}

function TvRow({ output, tv, watching }: { output: BroadcastOutput; tv: ReceiverTv; watching?: number }) {
  const outputs = useBroadcastStore((s) => s.outputs)
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const ask = async () => {
    setBusy(true)
    try {
      const reply = await invoke<{ name: string; feed: string | null; problem: string | null; width?: number; height?: number }>("tv_status", { address: tv.address })
      setCheck(tvCheckWords(reply, output.id, outputs))
      // Its display's size, kept for the list (Rhema Studio Receiver 1.5 says it).
      if (reply.width && reply.height && (reply.width !== tv.width || reply.height !== tv.height)) {
        const o = useBroadcastStore.getState().outputs.find((x) => x.id === output.id)
        if (o) useBroadcastStore.getState().updateOutput(o.id, { tvs: (o.tvs ?? []).map((t) => (t.address === tv.address ? { ...t, width: reply.width, height: reply.height } : t)) })
      }
    } catch (e) {
      setCheck({ ok: false, text: String(e) })
    } finally {
      setBusy(false)
    }
  }
  const forget = () => useBroadcastStore.getState().updateOutput(output.id, { tvs: (output.tvs ?? []).filter((t) => t.address !== tv.address) })
  const label = tv.name || tv.address
  return (
    <li className="flex flex-wrap items-center gap-2">
      <TvIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="font-medium">{tv.name || "Google TV"}</span>
        <span className="text-muted-foreground"> · {tv.address} · sent {hhmm(tv.sentAt)} · {tvSizeWords(tv)}</span>
        <span className="block text-muted-foreground">{tvKeyWords(tv)}{watching !== undefined ? (watching > 0 ? " · following the feed now" : " · not connected now") : ""}</span>
      </span>
      <span className="flex-1" />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void ask()} aria-label={`Check ${label}`}>Check TV</Button>
      {tv.token ? (
        confirm ? (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="destructive" onClick={() => { setConfirm(false); void revokeTv(output.id, tv.address) }} aria-label={`Confirm revoke ${label}`}>Revoke now</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label={`Revoke ${label}`} title="Its link stops working at once and its screen goes back to its code; the other screens carry on">Revoke</Button>
        )
      ) : (
        <Button size="sm" variant="ghost" onClick={forget} aria-label={`Forget ${label}`} title="Takes it off this list only: it keeps the feed's shared link until the feed gets a new link">Forget</Button>
      )}
      {check && <span role="status" className={cn("basis-full pl-5.5", check.ok ? "text-confidence-high" : "text-confidence-mid")}>{check.text}</span>}
    </li>
  )
}

/**
 * The event clock (ADR 0001, C03): which event is happening, apart from what the screens show. It
 * follows the screens by default; the timekeeper can run it instead, starting each event without
 * changing any screen.
 */
function EventClockBar() {
  const mode = useEventClock((s) => s.mode)
  const currentId = useEventClock((s) => s.currentId)
  const items = useQueueStore((s) => s.items)
  const current = items.find((i) => i.id === currentId)
  const at = current ? items.indexOf(current) : -1
  const next = items[at + 1]
  return (
    <div role="group" aria-label="Event clock" className="mb-3 flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Now: {current ? current.reference : "no event yet"}</span>
        <span className="flex-1" />
        <select aria-label="What starts each event" value={mode} onChange={(e) => useEventClock.getState().setMode(e.target.value as "screens" | "own")} className="h-7 rounded-md border border-input bg-card px-1.5">
          <option value="screens">Follows the screens</option>
          <option value="own">I start each event</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={at <= 0} onClick={() => useEventClock.getState().previous()}>Back one</Button>
        <Button size="sm" disabled={!next} onClick={() => useEventClock.getState().next()}>{next ? `Start ${next.reference}` : "Last event"}</Button>
        <FinishService />
        <span className="text-muted-foreground">{mode === "screens" ? "Each item's event starts when it goes on air; you can also move it on here." : "Events start only from here; showing content does not move the clock."} The screens never change from here.</span>
      </div>
    </div>
  )
}

/** The service's shared running-late offset (#196): the same one Prepare and a Timekeeper desk move. */
function RunningLate() {
  const { minutes, by, mode } = useServiceOffset()
  const me = useSettingsStore((s) => s.operatorName.trim()) || "Main desk"
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Running late or early">
      <span className="font-semibold">Running</span>
      <Button size="sm" variant="outline" onClick={() => useServiceOffset.getState().adjust(-5, me)}>−5 min</Button>
      <Button size="sm" variant="outline" onClick={() => useServiceOffset.getState().adjust(5, me)}>+5 min</Button>
      {minutes !== 0 && <Button size="sm" variant="ghost" onClick={() => useServiceOffset.getState().reset(me)}>On schedule</Button>}
      {/* How the delay reaches what is to come (#196 R3.4). */}
      <select aria-label="How the delay reaches what is to come" value={mode} onChange={(e) => useServiceOffset.getState().setMode(e.target.value === "push" ? "push" : "absorb", me)} className="h-7 rounded-md border border-input bg-card px-1.5">
        <option value="absorb">Pauses take it up</option>
        <option value="push">Push everything</option>
      </select>
      <span className="text-muted-foreground" role="status">{offsetWords(minutes)}{minutes !== 0 && by ? ` (${by})` : ""}; {mode === "push" ? "every item still to come moves by it, pauses and fixed starts too" : "pauses take it up first and fixed starts keep their time"}. It moves only what is expected, not the plan or the screens.</span>
    </div>
  )
}

/** Who last changed the time, what and when (#196 R2.9): the same line a joined Timekeeper desk shows. */
function LastTimeChange() {
  const last = useTimeChange((s) => s.last)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  if (!last) return null
  return <p className="text-xs text-muted-foreground" role="status" aria-label="Last change to the time">Last change: {timeChangeWords(last, now, (ms) => timeText(ms, churchTimeZone()))}</p>
}

/** Finish the service (#196 R3.7): the event clock stops, and whatever never started counts as skipped. Nothing on a screen changes. */
function FinishService() {
  const { state } = useServiceTiming()
  const [armed, setArmed] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const me = useSettingsStore((s) => s.operatorName.trim()) || undefined
  if (state === "finished") return <span className="font-semibold text-muted-foreground">Service finished</span>
  return (
    <>
      <Button size="sm" variant={armed ? "default" : "outline"} disabled={state === "idle"} onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        setRefused(useEventClock.getState().finish(me))
      }} onBlur={() => setArmed(false)}>{armed ? "Finish now" : "Finish service"}</Button>
      {refused && <span className="text-muted-foreground" role="status">{refused}</span>}
    </>
  )
}

/**
 * After Rhema closed unexpectedly (#196 R3.8): the item that was running has a known start but
 * not a known run time. Until the operator says the time is right or starts it again, it says so
 * here and wherever its time shows; nothing is put on a screen.
 */
function UntrustedTime() {
  const untrusted = useTimingTrust((s) => s.untrusted)
  const me = useSettingsStore((s) => s.operatorName.trim()) || undefined
  if (!untrusted) return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-confidence-mid/50 bg-confidence-mid/10 px-3 py-2 text-xs lg:col-span-2">
      <TriangleAlertIcon className="size-4 text-confidence-mid" aria-hidden />
      <span className="min-w-0 flex-1">
        <b>{untrusted.label}: its elapsed time can't be trusted.</b> Rhema Studio closed unexpectedly while it was running (last saved {hhmm(untrusted.lastSeen)}, started again {hhmm(untrusted.restartedAt)}). Its start is in the service log; how long it has run since is not known. Check it, then say so or start it again.
      </span>
      <Button size="sm" variant="outline" onClick={() => useTimingTrust.getState().confirm(me)}><CheckIcon /> The time is right</Button>
      <Button size="sm" onClick={() => useEventClock.getState().retake(untrusted.itemId)}>Start it again now</Button>
    </div>
  )
}

/** When each phase and each group of the main service is planned and expected to finish (#196 R1.5). */
function SectionFinishes({ sections }: { sections: SectionTiming[] }) {
  const shown = sections.filter((x) => x.plannedEnd !== null || x.expectedEnd !== null || x.loop)
  if (shown.length < 2) return null
  return (
    <div className="mt-3 border-t border-border pt-2 text-xs">
      <p className="mb-1 text-[0.625rem] font-bold tracking-[0.06em] text-muted-foreground uppercase">Finishes</p>
      <ul className="flex flex-col gap-0.5" aria-label="When each phase and group finishes">
        {shown.map((x) => {
          const late = x.plannedEnd !== null && x.expectedEnd !== null ? Math.round((x.expectedEnd - x.plannedEnd) / 60_000) : 0
          return (
            <li key={x.id} className={cn("flex items-baseline gap-2", x.type === "group" && "pl-3", x.state === "done" && "text-muted-foreground")}>
              <span className={cn("min-w-0 flex-1 truncate", x.type === "phase" && "font-semibold")}>{x.name}</span>
              {x.loop && x.expectedEnd === null ? (
                <span className="text-muted-foreground">loops until stopped</span>
              ) : (
                <>
                  <span className="font-mono tabular-nums text-muted-foreground">{x.plannedEnd !== null ? hhmm(x.plannedEnd) : "—"}</span>
                  <span className={cn("w-24 text-right tabular-nums", late > 0 && x.state !== "done" && "font-semibold text-confidence-mid")}>{x.state === "done" ? "done" : x.expectedEnd !== null ? `→ ${hhmm(x.expectedEnd)}${late ? ` (${late > 0 ? "+" : "−"}${Math.abs(late)})` : ""}` : ""}</span>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
