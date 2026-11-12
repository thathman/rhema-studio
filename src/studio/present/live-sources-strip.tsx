import { useEffect, useState, type ReactNode } from "react"
import { EyeOffIcon, PauseIcon, PlayIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { BroadcastOutput } from "@/types"
import type { Scene } from "@/types/scene"
import { CLEAR, HIDE_CAMERA, RESTORE, SHOW_CAMERA } from "@/lib/wording"
import { cameraSending, useRouterHealth, watchRouter } from "@/lib/cameras"
import { CONTENT_NAMES } from "@/lib/content-names"
import { activatedLabel, cameraPathOf, followerCount, followsLowerThird, followsTicker, lowerThirdWords, tickerWords, timerWords, type AnySourceId } from "@/lib/live-sources"
import { cameraWords } from "@/lib/show-health"
import { sceneForOutput } from "@/lib/scenes"
import { tickerForScreens, timerForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { CONTENT_TYPES } from "@/types/broadcast"

const ON = "flex items-center gap-1 rounded-full border border-live-pulse/40 bg-live-pulse/10 py-0.5 pr-0.5 pl-2.5 text-[0.6875rem]"
const OFF = "flex items-center gap-1 rounded-full border border-border py-0.5 pr-0.5 pl-2.5 text-[0.6875rem] text-muted-foreground"

const SENDING_WORDS = { sending: "Sending", frozen: "Frozen: nothing arriving", "not-sending": "Not sending", "router-off": "Camera router off" } as const

/**
 * What each live source holds (ADR 0001): the content the feeds follow (Romans 8:28 can stay on the
 * Bible feeds while a hymn is on the projector), whether an output follows it or a scene's box does,
 * the ticker, the lower third, the stage message, the service timer and each camera. Each says who
 * changed it last and when, and has its own scoped action: take off and Restore, pause and resume the
 * timer, hide a camera from scenes and bring it back.
 */
export function LiveSourcesStrip() {
  const [cameraConfirmation, setCameraConfirmation] = useState<{
    id: `camera:${string}`
    name: string
    expectedOn: boolean
    expectedRevision: number | null
    impactSignature: string
    command: "hide" | "restore"
    stale: boolean
  } | null>(null)
  const sources = useBroadcastStore((s) => s.sources)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
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

  // Followed by an output, or by a scene's box (a scene can be taken at any moment).
  const followed = new Set([...outputs.flatMap((o) => o.shows ?? []), ...scenes.flatMap((sc) => sc.layers.flatMap((l) => (l.kind === "feed" ? l.shows ?? [] : [])))])
  const followsContent = CONTENT_TYPES.some((k) => followed.has(k))
  // A source activated on its own (not the program) is listed even when nothing follows it yet.
  const rows = CONTENT_TYPES.filter((k) => sources[k] && (followed.has(k) || (sources[k]!.on && sources[k]!.value !== liveVerse)))
  const tk = stateSources.ticker
  const tickerShown = ticker ?? (tk && !tk.on ? tk.ticker : undefined)
  const timerShown = timer.startedAt !== null || timer.accumulatedMs > 0
  const lt = stateSources.lowerThird
  const stage = stateSources.stage
  if (!followsContent && rows.length === 0 && !tickerShown && !timerShown && !anyCamera && !lt && !stage) return null
  const tickerFeeds = outputs.filter((o) => followsTicker(o) && o.role !== "stage").length
  const ltFeeds = lowerThirdFeeds(outputs, scenes)
  const stageScreens = outputs.filter((o) => o.role === "stage").length
  const openCameraReview = (id: `camera:${string}`, name: string, expectedOn: boolean, expectedRevision: number | undefined, impactSignature: string, command: "hide" | "restore") => {
    setCameraConfirmation({ id, name, expectedOn, expectedRevision: expectedRevision ?? null, impactSignature, command, stale: false })
  }
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
        // On their own or through the scene they show.
        const feeds = followerCount(k, outputs, scenes)
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
      {lt && (
        <Chip on={lt.on} name="Lower third" what={`${lt.on ? "up" : "down"} · ${lowerThirdWords(lt.lowerThird, 40)}`} who={activatedLabel(lt)} extra={`${ltFeeds} ${ltFeeds === 1 ? "feed" : "feeds"}`}>
          <SourceButton id="lowerThird" on={lt.on} disabled={rehearsal || (!lt.on && !lt.lowerThird)} label={`Lower third: ${lowerThirdWords(lt.lowerThird, 40)}`} />
        </Chip>
      )}
      {stage && (
        <Chip on={stage.on} name="Stage message" what={`${stage.on ? "up" : "cleared"} · ${stage.message ?? ""}`} who={activatedLabel(stage)} extra={`${stageScreens} stage ${stageScreens === 1 ? "screen" : "screens"}`}>
          {stage.on ? (
            <IconButton disabled={rehearsal} onClick={() => useBroadcastStore.getState().clearSource("stage")} label={`Clear the stage message: ${stage.message ?? ""}`} title="Clear it from the stage screens (Restore brings it back)"><XIcon /></IconButton>
          ) : (
            <IconButton disabled={rehearsal || !stage.message} onClick={() => useBroadcastStore.getState().restoreSource("stage")} label={`Restore the stage message: ${stage.message ?? ""}`} title="Put the message back on the stage screens"><RotateCcwIcon /></IconButton>
          )}
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
        const id = `camera:${cam.name}` as const
        const x = stateSources[id]
        const held = x?.on === false
        const sending = cameraSending(router, cam.name)
        const impact = cameraSceneImpact(cam.name, scenes, outputs)
        const state = held ? "hidden from scenes" : sending ? SENDING_WORDS[sending] : "checking…"
        const name = cameraWords(cam.label)
        return (
          <Chip key={id} on={!held && sending === "sending"} name={name} what={state} who={x ? activatedLabel(x) : ""} extra={`in ${impact.scenes.length} ${impact.scenes.length === 1 ? "scene" : "scenes"}`}>
            {held ? (
              <IconButton disabled={rehearsal} onClick={() => openCameraReview(id, name, false, x?.revision, impact.signature, "restore")} label={`Review showing ${name} in scenes`} title="Review the scenes and outputs affected before showing this camera again"><RotateCcwIcon /></IconButton>
            ) : (
              <IconButton disabled={rehearsal} onClick={() => openCameraReview(id, name, true, x?.revision, impact.signature, "hide")} label={`Review hiding ${name} from scenes`} title="Review the scenes and outputs affected before hiding this camera"><EyeOffIcon /></IconButton>
            )}
          </Chip>
        )
      })}
      {cameraConfirmation && (() => {
        const current = useBroadcastStore.getState()
        const source = current.stateSources[cameraConfirmation.id]
        const currentImpact = cameraSceneImpact(cameraConfirmation.id.slice("camera:".length), current.scenes, current.outputs)
        const stale = cameraConfirmation.stale
          || current.rehearsal
          || (source?.on !== false) !== cameraConfirmation.expectedOn
          || (source?.revision ?? null) !== cameraConfirmation.expectedRevision
          || currentImpact.signature !== cameraConfirmation.impactSignature
        const affectedScenes = currentImpact.scenes.map((scene) => scene.name)
        const affectedOutputs = currentImpact.outputs.map((output) => `${output.name} (${output.sceneName})`)
        const verb = cameraConfirmation.command === "hide" ? HIDE_CAMERA : SHOW_CAMERA
        return (
          <div role="alertdialog" aria-label={`${verb} ${cameraConfirmation.name} across scenes?`} className="flex min-w-full flex-col gap-2 rounded-md border border-confidence-mid/40 bg-confidence-mid/10 p-3 text-xs sm:min-w-96">
            <p className="font-semibold">Review camera impact</p>
            <p>{cameraConfirmation.command === "hide" ? "This will hide this source in every Rhema scene that uses it." : "This will restore this source in every Rhema scene that uses it."} It does not Take a scene. OBS camera inputs are unchanged.</p>
            <p><span className="font-semibold">Scenes using this camera:</span> {affectedScenes.length ? affectedScenes.join(", ") : "None in the saved scene list."}</p>
            <p><span className="font-semibold">Current output assignments:</span> {affectedOutputs.length ? affectedOutputs.join(", ") : "None."}</p>
            {stale ? <p role="alert" className="font-semibold text-confidence-mid">The source, scene usage, outputs, or rehearsal state changed while you were reviewing. Cancel and open the review again.</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={cameraConfirmation.command === "hide" ? "destructive" : "default"} disabled={rehearsal || stale} onClick={() => {
                const latest = useBroadcastStore.getState()
                const latestSource = latest.stateSources[cameraConfirmation.id]
                const latestImpact = cameraSceneImpact(cameraConfirmation.id.slice("camera:".length), latest.scenes, latest.outputs)
                if (latest.rehearsal || (latestSource?.on !== false) !== cameraConfirmation.expectedOn || (latestSource?.revision ?? null) !== cameraConfirmation.expectedRevision || latestImpact.signature !== cameraConfirmation.impactSignature) {
                  setCameraConfirmation((pending) => pending ? { ...pending, stale: true } : pending)
                  return
                }
                if (cameraConfirmation.command === "hide") latest.clearSource(cameraConfirmation.id)
                else latest.restoreSource(cameraConfirmation.id)
                setCameraConfirmation(null)
              }}>{cameraConfirmation.command === "hide" ? "Hide from all listed scenes" : "Show in all listed scenes"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setCameraConfirmation(null)}>Cancel</Button>
            </div>
          </div>
        )
      })()}
    </div>
  )

}

function cameraSceneImpact(camera: string, scenes: readonly Scene[], outputs: readonly BroadcastOutput[]): { scenes: { id: string; name: string }[]; outputs: { id: string; name: string; sceneName: string }[]; signature: string } {
  const usesCamera = (scene: Scene | undefined): scene is Scene => !!scene?.layers.some((layer) => layer.kind === "camera" && !!layer.cameraUrl && cameraPathOf(layer.cameraUrl) === camera)
  const saved = scenes.filter(usesCamera).map((scene) => ({ id: scene.id, name: scene.name }))
  const assigned = outputs.flatMap((output) => {
    const scene = output.sceneId
      ? output.sceneSnapshot?.id === output.sceneId ? output.sceneSnapshot : scenes.find((item) => item.id === output.sceneId)
      : undefined
    return usesCamera(scene) ? [{ id: output.id, name: output.name, sceneName: scene.name }] : []
  })
  const signature = JSON.stringify({ saved, assigned })
  return { scenes: saved, outputs: assigned, signature }
}

/** Congregation outputs that draw the lower third: over the frame, or in the box of the scene they show. */
function lowerThirdFeeds(outputs: readonly BroadcastOutput[], scenes: readonly Scene[]): number {
  return outputs.filter((o) => {
    if ((o.role ?? "congregation") !== "congregation") return false
    const scene = sceneForOutput(o, scenes)
    return followsLowerThird(o) || !!scene?.layers.some((l) => l.kind === "lowerThird")
  }).length
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
    <IconButton disabled={disabled} onClick={() => b.clearSource(id)} label={`${CLEAR} ${label} from its feeds`} title={`${CLEAR} it from the feeds that follow it (${RESTORE} brings it back)`}><XIcon /></IconButton>
  ) : (
    <IconButton disabled={disabled} onClick={() => b.restoreSource(id)} label={`${RESTORE} ${label} on its feeds`} title={`${RESTORE} it on the feeds that follow it`}><RotateCcwIcon /></IconButton>
  )
}
