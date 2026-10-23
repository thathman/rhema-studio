import { outputOnAir } from "@/lib/output-on-air"
import { useState } from "react"
import { CheckIcon, GlobeIcon, InfoIcon, MonitorIcon, PauseIcon, PlayIcon, RadioIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { elapsedMs, formatMs, isRunning, remainingMs, timerTone } from "@/lib/timer"
import { resetTimerLogged } from "@/lib/timer-reset"
import { openSettings } from "@/lib/settings-dialog"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { useBroadcastStore, type OutputFrame } from "@/stores/broadcast-store"
import { attention, showing, useFeedHealthStore } from "@/lib/show-health"
import { feedHealthLabel, useFeedHealth } from "@/lib/browser-feeds"
import { CONTENT_NAMES } from "@/lib/content-names"
import type { BroadcastOutput, BroadcastOutputStatus, Scene } from "@/types"
import { useJournalStore } from "@/stores/journal-store"
import { useShellStore } from "@/studio/shell-store"
import { useServiceTiming } from "@/studio/use-service-timing"
import { useReadiness } from "@/studio/use-readiness"
import { HoldControl } from "@/studio/present/service-timer"
import { AuxTimersPanel } from "@/studio/present/aux-timers"
import type { ReadinessCheck } from "@/studio/readiness"
import { SceneComposer } from "@/studio/production/scene-composer"
import { OperatorsPanel } from "@/studio/production/operators-panel"
import { useEventClock } from "@/stores/event-clock-store"
import { useQueueStore } from "@/stores/queue-store"

type Tab = "timekeeper" | "screens" | "health" | "programs" | "cameras" | "operators"
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ["timekeeper", "Timekeeper"],
  ["screens", "Screens"],
  ["health", "Show health"],
  ["programs", "Programs"],
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
 * Production control (approved design): the service's timing, screens and readiness in one place.
 * What is built is here; the two-program, camera and multi-operator parts are planned (issues #197,
 * #208, #209) and say so rather than offer controls that do nothing.
 */
export function ProductionWorkspace() {
  const [tab, setTab] = useState<Tab>("timekeeper")
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-[29px] pt-[26px] pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">One service · production control</p>
            <h1 className="mt-1 text-2xl leading-tight font-bold tracking-[-0.035em]">Production control</h1>
            <p className="mt-1 text-xs text-muted-foreground">The service's timing, screens and readiness in one place. Nothing here takes anything live.</p>
          </div>
          <div className="flex flex-wrap gap-2"><Badge tone="ok">This computer</Badge><Badge tone="off">Cameras: planned</Badge></div>
        </header>
        <nav role="tablist" aria-label="Production" className="flex flex-wrap gap-1 border-b border-border">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn("-mb-px border-b-[3px] px-3 py-2.5 text-[0.6875rem] font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50", tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
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
          {tab === "cameras" && <Planned title="Cameras on the church network" issue={209} text="Phone or IP cameras on the church's own network, one stream per angle, shared by OBS and Rhema without the internet. Today OBS handles the cameras; Rhema's graphics go to OBS over NDI." />}
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
          <p className="text-[0.6875rem] text-[#b8cec6]">The same timer as Present; the stage display shows it.</p>
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
                  {e.state === "upcoming" && off !== 0 && <span className={cn("tabular-nums", off > 0 ? "font-semibold text-confidence-mid" : "text-muted-foreground")}>→ {hhmm(e.expectedStart)}</span>}
                  {e.squeezed && <span className="font-semibold text-destructive">cut short</span>}
                </li>
              )
            })}
          </ol>
        )}
      </Card>
      <Card kicker="Independent" title="Other timers" className="lg:col-span-2">
        <AuxTimersPanel />
      </Card>
    </div>
  )
}

/**
 * Where everything goes (#213 show health): each output with what it is, what it shows now, what
 * it follows and how its signal is doing; what needs attention first.
 */
function Screens() {
  const outputs = useBroadcastStore((s) => s.outputs)
  const status = useBroadcastStore((s) => s.outputStatus)
  const frames = useBroadcastStore((s) => s.outputFrames)
  const scenes = useBroadcastStore((s) => s.scenes)
  const feeds = useFeedHealthStore()
  const openOutputs = useShellStore((s) => s.openOutputs)
  const needs = attention(outputs, status, feeds)
  return (
    <Card kicker="Outputs" title="Screens, NDI senders and browser feeds" badge={<Button size="sm" onClick={openOutputs}><MonitorIcon /> Open outputs</Button>}>
      {needs.length > 0 && (
        <ul aria-label="Needs attention" className="mb-2 flex flex-col gap-1">
          {needs.map((n) => (
            <li key={n.outputId + n.text} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs", n.level === "high" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted text-foreground")}>
              <TriangleAlertIcon className="size-3.5 shrink-0" /> {n.text}
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {outputs.map((o) => <ScreenRow key={o.id} output={o} status={status[o.id]} frame={frames[o.id]} scenes={scenes} />)}
      </ul>
    </Card>
  )
}

function ScreenRow({ output: o, status: st, frame, scenes }: { output: BroadcastOutput; status: BroadcastOutputStatus | undefined; frame: OutputFrame | undefined; scenes: Scene[] }) {
  const on = outputOnAir(o, st)
  const feed = useFeedHealth(o.id, o.type === "browser" && on)
  const kind = o.type === "ndi" ? `NDI · ${o.ndi.sourceName}` : o.type === "browser" ? "Browser feed" : o.windowed ? "In a window" : "Display"
  const follows = o.shows?.length ? `follows ${o.shows.map((k) => CONTENT_NAMES[k]).join(", ")}` : null
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 text-xs">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground [&_svg]:size-4">{o.type === "browser" ? <GlobeIcon /> : o.type === "ndi" ? <RadioIcon /> : <MonitorIcon />}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{o.name}</span>
        <span className="block text-muted-foreground">{kind} · {o.role ?? "congregation"}{follows ? ` · ${follows}` : ""}{o.ticker ? " · ticker" : ""}{o.lowerThirds ? " · lower thirds" : ""}</span>
        <span className="block truncate">Showing: {showing(o, frame, scenes, on)}</span>
      </span>
      {st?.ndiError ? <Badge tone="warn">{st.ndiError}</Badge> : <Badge tone={on ? "ok" : "off"}>{on ? "On" : "Off"}</Badge>}
      {o.type === "ndi" && on && typeof st?.ndiReceivers === "number" && <span className="text-muted-foreground">{st.ndiReceivers} {st.ndiReceivers === 1 ? "receiver" : "receivers"}</span>}
      {o.type === "browser" && on && feedHealthLabel(feed) && <span className={cn(feed?.behind ? "text-destructive" : "text-muted-foreground")}>{feedHealthLabel(feed)}</span>}
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
  const fix = (c: ReadinessCheck) => (c.fix === "outputs" ? openOutputs() : c.fix === "prepare" ? setWorkspace("prepare") : openSettings("diagnostics"))
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

function Planned({ title, issue, text }: { title: string; issue: number; text: string }) {
  return (
    <Card kicker="Planned" title={title} badge={<Badge tone="off">Not built yet</Badge>}>
      <p className="max-w-3xl text-xs text-muted-foreground">{text}</p>
      <p className="text-xs">Planned in issue #{issue}. Nothing on this tab controls anything yet.</p>
    </Card>
  )
}
