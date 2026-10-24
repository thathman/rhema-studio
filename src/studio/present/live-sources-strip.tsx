import { useEffect, type ReactNode } from "react"
import { EyeOffIcon, PauseIcon, PlayIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { cameraSending, useRouterHealth, watchRouter } from "@/lib/cameras"
import { CONTENT_NAMES } from "@/lib/content-names"
import { activatedLabel, cameraPathOf, cameraSourceId, followsTicker, tickerWords, timerWords, type AnySourceId } from "@/lib/live-sources"
import { cameraWords } from "@/lib/show-health"
import { tickerForScreens, timerForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { CONTENT_TYPES } from "@/types/broadcast"

const ON = "flex items-center gap-1 rounded-full border border-live-pulse/40 bg-live-pulse/10 py-0.5 pr-0.5 pl-2.5 text-[0.6875rem]"
const OFF = "flex items-center gap-1 rounded-full border border-border py-0.5 pr-0.5 pl-2.5 text-[0.6875rem] text-muted-foreground"

const SENDING_WORDS = { sending: "Sending", "not-sending": "Not sending", "router-off": "Camera router off" } as const

/**
 * What each live source holds (ADR 0001): the content the feeds follow (Romans 8:28 can stay on the
 * Bible feeds while a hymn is on the projector), the ticker, the service timer and each camera. Each
 * says who changed it last and when, and has its own scoped action: take off and Restore, pause and
 * resume the timer, hide a camera from scenes and bring it back.
 */
export function LiveSourcesStrip() {
  const sources = useBroadcastStore((s) => s.sources)
  const stateSources = useBroadcastStore((s) => s.stateSources)
  const outputs = useBroadcastStore((s) => s.outputs)
  const scenes = useBroadcastStore((s) => s.scenes)
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const autoBibleFeeds = useBroadcastStore((s) => s.autoBibleFeeds)
  const ticker = useBroadcastStore(tickerForScreens)
  const rehearsalReturn = useBroadcastStore((s) => s.rehearsalReturn)
  const appTimer = useTimerStore((s) => s.timer)
  const timer = timerForScreens({ rehearsal, rehearsalReturn }, appTimer)
  // Re-render as the timer moves (its chip counts).
  useTimerStore((s) => s.tick)
  const cameras = useSettingsStore((s) => s.cameras)
  const router = useRouterHealth()
  const anyCamera = cameras.length > 0
  useEffect(() => (anyCamera ? watchRouter() : undefined), [anyCamera])

  const followed = new Set(outputs.flatMap((o) => o.shows ?? []))
  const followsContent = CONTENT_TYPES.some((k) => followed.has(k))
  const rows = CONTENT_TYPES.filter((k) => followed.has(k) && sources[k])
  const tk = stateSources.ticker
  const tickerShown = ticker ?? (tk && !tk.on ? tk.ticker : undefined)
  const timerShown = timer.startedAt !== null || timer.accumulatedMs > 0
  if (!followsContent && !tickerShown && !timerShown && !anyCamera) return null
  const tickerFeeds = outputs.filter((o) => followsTicker(o) && o.role !== "stage").length
  return (
    <div role="group" aria-label="Live sources" className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-3 border-t border-border px-3 py-2.5">
      <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Sources</span>
      {followsContent && rows.length === 0 && <span className="text-[0.6875rem] text-muted-foreground">Nothing live for the feeds yet</span>}
      {autoBibleFeeds && (
        <button type="button" onClick={() => useBroadcastStore.getState().setAutoMode("manual")} title="Auto, Bible feeds only: a verse heard while listening goes to the feeds that follow Bible, never the main screens. Click to turn off." className="touch-hit rounded-full bg-tone-amber px-2 py-0.5 text-[0.6875rem] font-medium text-tone-amber-foreground outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
          Auto: Bible feeds
        </button>
      )}
      {rows.map((k) => {
        const src = sources[k]!
        const feeds = outputs.filter((o) => o.shows?.includes(k)).length
        const who = activatedLabel(src)
        return (
          <Chip key={k} on={src.on} name={CONTENT_NAMES[k]} what={src.value.reference} who={who} extra={`${feeds} ${feeds === 1 ? "feed" : "feeds"}`}>
            <SourceButton id={k} on={src.on} disabled={rehearsal} label={`${CONTENT_NAMES[k]}: ${src.value.reference}`} />
          </Chip>
        )
      })}
      {tickerShown && (
        <Chip on={!!ticker} name="Ticker" what={`${ticker ? (ticker.pausedAt ? "held still" : "running") : "off"} · ${tickerWords(tickerShown, 40)}`} who={tk ? activatedLabel(tk) : ""} extra={`${tickerFeeds} ${tickerFeeds === 1 ? "feed" : "feeds"}`}>
          <SourceButton id="ticker" on={!!ticker} disabled={rehearsal} label={`Ticker: ${tickerWords(tickerShown, 40)}`} />
        </Chip>
      )}
      {timerShown && (
        <Chip on={timer.startedAt !== null} name="Timer" what={`${timer.startedAt !== null ? "running" : "paused"} · ${timerWords(timer, monotonicNow())}`} who={stateSources.timer ? activatedLabel(stateSources.timer) : ""}>
          {timer.startedAt !== null ? (
            <IconButton disabled={rehearsal} onClick={() => useBroadcastStore.getState().clearSource("timer")} label="Pause the service timer" title="Pause the timer (resume carries on from here)"><PauseIcon /></IconButton>
          ) : (
            <IconButton disabled={rehearsal} onClick={() => useBroadcastStore.getState().restoreSource("timer")} label="Resume the service timer" title="Resume the timer from where it stopped"><PlayIcon /></IconButton>
          )}
        </Chip>
      )}
      {cameras.map((cam) => {
        const id = cameraSourceId(cam.name)
        const x = stateSources[id]
        const held = x?.on === false
        const sending = cameraSending(router, cam.name)
        const inScenes = scenes.filter((sc) => sc.layers.some((l) => l.kind === "camera" && !!l.cameraUrl && cameraPathOf(l.cameraUrl) === cam.name)).length
        const state = held ? "hidden from scenes" : sending ? SENDING_WORDS[sending] : "checking…"
        const name = cameraWords(cam.label)
        return (
          <Chip key={id} on={!held && sending === "sending"} name={name} what={state} who={x ? activatedLabel(x) : ""} extra={`in ${inScenes} ${inScenes === 1 ? "scene" : "scenes"}`}>
            {held ? (
              <IconButton disabled={rehearsal} onClick={() => useBroadcastStore.getState().restoreSource(id)} label={`Show ${name} in scenes again`} title="Back in every scene that has it"><RotateCcwIcon /></IconButton>
            ) : (
              <IconButton disabled={rehearsal} onClick={() => useBroadcastStore.getState().clearSource(id)} label={`Hide ${name} from scenes`} title="Every scene with it shows its fallback there instead; the scenes stay as they are"><EyeOffIcon /></IconButton>
            )}
          </Chip>
        )
      })}
    </div>
  )
}

/** One source: its name, what it holds, who and when, and its action. */
function Chip({ on, name, what, who, extra, children }: { on: boolean; name: string; what: string; who: string; extra?: string; children: ReactNode }) {
  return (
    <span title={[name, what, who].filter(Boolean).join(" · ")} className={on ? ON : OFF}>
      <span className="font-semibold">{name}</span>
      <span className="max-w-40 truncate">{what}</span>
      {who && <span className="text-muted-foreground">· {who}</span>}
      {extra && <span className="text-muted-foreground">· {extra}</span>}
      {children}
    </span>
  )
}

/** Small to look at, a 44 px target to press. */
function IconButton({ disabled, onClick, label, title, children }: { disabled: boolean; onClick: () => void; label: string; title: string; children: ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={label} title={title} className="touch-hit flex size-5 items-center justify-center rounded-full hover:bg-muted disabled:opacity-40 [&_svg]:size-3">
      {children}
    </button>
  )
}

/** Take a source off its feeds, or restore it. */
function SourceButton({ id, on, disabled, label }: { id: AnySourceId; on: boolean; disabled: boolean; label: string }) {
  const b = useBroadcastStore.getState()
  return on ? (
    <IconButton disabled={disabled} onClick={() => b.clearSource(id)} label={`Take ${label} off its feeds`} title="Take it off the feeds that follow it (Restore brings it back)"><XIcon /></IconButton>
  ) : (
    <IconButton disabled={disabled} onClick={() => b.restoreSource(id)} label={`Restore ${label} on its feeds`} title="Put it back on the feeds that follow it"><RotateCcwIcon /></IconButton>
  )
}
