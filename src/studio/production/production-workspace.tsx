import { offsetWords, useServiceOffset } from "@/stores/service-offset-store"
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
import { attention, cameraHealth, cameraStateWords, cameraWords, feedSummary, showing, tvCheckWords, useFeedHealthStore, type Attention, type CameraHealth } from "@/lib/show-health"
import { useRouterHealth } from "@/lib/cameras"
import { invoke } from "@tauri-apps/api/core"
import { feedHealthLabel, useFeedHealth } from "@/lib/browser-feeds"
import { outputDestination, outputFollows, outputPresentation, outputTransport } from "@/lib/output-summary"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { safeArea, safeAreaWords } from "@/lib/theme-look"
import type { BroadcastOutput, BroadcastOutputStatus, BroadcastTheme, ReceiverTv, Scene } from "@/types"
import { useJournalStore } from "@/stores/journal-store"
import { useShellStore } from "@/studio/shell-store"
import { useServiceTiming } from "@/studio/use-service-timing"
import { useReadiness } from "@/studio/use-readiness"
import { HoldControl } from "@/studio/present/service-timer"
import { AuxTimersPanel } from "@/studio/present/aux-timers"
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

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

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
  const tone = timerTone(timer, now)
  const shown = timer.durationMs > 0 ? remainingMs(timer, now) : elapsedMs(timer, now)
  const { timing } = useServiceTiming()
  const correct = (minutes: number) => {
    useTimerStore.getState().adjustMinutes(minutes)
    useJournalStore.getState().add({ kind: "timing", label: `timer corrected by ${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} min` })
  }
  const late = timing ? Math.round(timing.lateMs / 60_000) : 0
  return (
    <div className="grid gap-[18px] lg:grid-cols-2">
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
        <HoldControl />
      </Card>
      <Card kicker="Planned vs expected" title="The run of show" badge={<Button size="sm" variant="ghost" onClick={() => useShellStore.getState().setWorkspace("prepare")}>Edit run of show</Button>}>
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
                  {e.state === "live" && <Badge tone="live">Now</Badge>}
                  {e.state === "done" && <span className="text-muted-foreground">done</span>}
                  {e.state === "skipped" && <span className="text-muted-foreground">skipped</span>}
                  {e.state === "upcoming" && off !== 0 && <span className={cn("tabular-nums", off > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>→ {hhmm(e.expectedStart)}</span>}
                  {e.squeezed && <span className="font-semibold text-destructive">cut short</span>}
                </li>
              )
            })}
          </ol>
        )}
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
    <Card kicker="Countdown" title="Time until" badge={prefs.chime ? <Badge tone="ok">Chime on</Badge> : undefined}>
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

/** Every camera Rhema knows, with what the router last said (#213); undefined router: no answer yet. */
function useCameraHealth(): CameraHealth[] {
  const cameras = useSettingsStore((s) => s.cameras)
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const router = useRouterHealth()
  return cameraHealth(cameras, scenes, outputs, status, router.checked ? router.status : undefined)
}

/** What needs attention now: outputs, browser feeds and the cameras of scenes on air. */
function useNeeds(): Attention[] {
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const scenes = useBroadcastStore((s) => s.scenes)
  const feeds = useFeedHealthStore()
  const cameras = useCameraHealth()
  return attention(outputs, status, feeds, { cameras, scenes })
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
          <span className="block text-xs text-muted-foreground">{outputTransport(o)} · {ROLE_NAMES[role]}</span>
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
        {o.type === "ndi" && on && typeof st?.ndiReceivers === "number" && row("Signal", `${st.ndiReceivers} ${st.ndiReceivers === 1 ? "receiver" : "receivers"}`)}
        {o.type === "browser" && on && feedHealthLabel(feed) && row("Signal", <span className={cn(feed?.behind && "text-destructive")}>{feedHealthLabel(feed)}</span>)}
      </dl>
      <div className="mt-auto flex justify-end border-t border-border px-3 py-2">
        <Button size="sm" variant="outline" onClick={() => useShellStore.getState().editOutput(o.id)} aria-label={`Edit ${o.name}`}><SettingsIcon /> Edit output</Button>
      </div>
    </li>
  )
}

const ICON: Record<ReadinessCheck["status"], React.ReactNode> = {
  ok: <CheckIcon className="size-4 text-confidence-high" />,
  warn: <TriangleAlertIcon className="size-4 text-confidence-mid" />,
  info: <InfoIcon className="size-4 text-muted-foreground" />,
}

function Health() {
  const { ready, checks, openOutputs, setWorkspace } = useReadiness()
  const needs = useNeeds()
  const fix = (c: ReadinessCheck) => (c.fix === "outputs" ? openOutputs() : c.fix === "prepare" ? setWorkspace("prepare") : c.fix === "cameras" ? openProductionTab("cameras") : openSettings("diagnostics"))
  return (
    <div className="flex flex-col gap-[18px]">
      <NeedsAttention needs={needs} />
      <Preflight ready={ready} checks={checks} fix={fix} />
      <div className="grid gap-[18px] lg:grid-cols-2">
        <CamerasHealth />
        <FeedsHealth />
      </div>
    </div>
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
 * Each camera as the camera router sees it (#213): not running, not sending, or sending (what and
 * to how many), and the scenes and screens that use it. Real router answers only.
 */
function CamerasHealth() {
  const cams = useCameraHealth()
  const ours = cams.filter((c) => c.state !== "elsewhere")
  const sending = ours.filter((c) => c.state === "sending").length
  return (
    <Card kicker="Signal" title="Cameras" badge={ours.length > 0 && <Badge tone={sending === ours.length ? "ok" : "warn"}>{sending} of {ours.length} sending</Badge>}>
      {cams.length === 0 ? (
        <p className="text-xs text-muted-foreground">No cameras yet. Add a phone or camera for each angle in Production → Cameras.</p>
      ) : (
        <ul aria-label="Camera signals" className="flex flex-col divide-y divide-border">
          {cams.map((c) => {
            const bad = c.state === "not-sending" || c.state === "router-off"
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
 * the Google TVs it was sent to, each of which can be asked what it shows (Rhema Receiver 1.1).
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
                {(o.tvs ?? []).length > 0 && (
                  <ul aria-label={`Google TVs showing ${o.name}`} className="ml-7 flex flex-col gap-1">
                    {o.tvs!.map((tv) => <TvRow key={tv.address} output={o} tv={tv} />)}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">A screen counts once its page shows the feed; Show on a Google TV (in the feed's output settings) adds the TV here.</p>
    </Card>
  )
}

function TvRow({ output, tv }: { output: BroadcastOutput; tv: ReceiverTv }) {
  const outputs = useBroadcastStore((s) => s.outputs)
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const ask = async () => {
    setBusy(true)
    try {
      const reply = await invoke<{ name: string; feed: string | null; problem: string | null }>("tv_status", { address: tv.address })
      setCheck(tvCheckWords(reply, output.id, outputs))
    } catch (e) {
      setCheck({ ok: false, text: String(e) })
    } finally {
      setBusy(false)
    }
  }
  const forget = () => useBroadcastStore.getState().updateOutput(output.id, { tvs: (output.tvs ?? []).filter((t) => t.address !== tv.address) })
  return (
    <li className="flex flex-wrap items-center gap-2">
      <TvIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="font-medium">{tv.name || "Google TV"}</span>
        <span className="text-muted-foreground"> · {tv.address} · sent {hhmm(tv.sentAt)}</span>
      </span>
      <span className="flex-1" />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void ask()} aria-label={`Check ${tv.name || tv.address}`}>Check TV</Button>
      <Button size="sm" variant="ghost" onClick={forget} aria-label={`Forget ${tv.name || tv.address}`}>Forget</Button>
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
        <span className="text-muted-foreground">{mode === "screens" ? "Each item's event starts when it goes on air; you can also move it on here." : "Events start only from here; showing content does not move the clock."} The screens never change from here.</span>
      </div>
    </div>
  )
}

/** The service's shared running-late offset (#196): the same one Prepare and a Timekeeper desk move. */
function RunningLate() {
  const { minutes, by } = useServiceOffset()
  const me = useSettingsStore((s) => s.operatorName.trim()) || "Main desk"
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Running late or early">
      <span className="font-semibold">Running</span>
      <Button size="sm" variant="outline" onClick={() => useServiceOffset.getState().adjust(-5, me)}>−5 min</Button>
      <Button size="sm" variant="outline" onClick={() => useServiceOffset.getState().adjust(5, me)}>+5 min</Button>
      {minutes !== 0 && <Button size="sm" variant="ghost" onClick={() => useServiceOffset.getState().reset(me)}>On schedule</Button>}
      <span className="text-muted-foreground" role="status">{offsetWords(minutes)}{minutes !== 0 && by ? ` (${by})` : ""}; moves only what is expected, not the plan or the screens.</span>
    </div>
  )
}
