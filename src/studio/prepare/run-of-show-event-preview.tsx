import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { drawScene } from "@/lib/scene-renderer"
import { cameraLabelOf } from "@/lib/cameras"
import { feedFrame } from "@/lib/live-sources"
import { overlayFor } from "@/lib/lower-third-style"
import { sceneClock, sceneFrame } from "@/lib/scenes"
import { parseTakeStep, type ParsedTakeStep } from "@/lib/item-intent"
import { loadThemeImage, themeImageCache } from "@/lib/theme-image-cache"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { tickerForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { presentActions } from "@/studio/present-actions"
import { PreviewPanel } from "@/components/panels/preview-panel"
import type { BroadcastOutput, QueueItem, Scene } from "@/types"

/** A read-only event preview: the planned scene and audience, plus the selected moment's content. */
export function RunOfShowEventPreview({ eventTitle, moments }: { eventTitle: string; moments: QueueItem[] }) {
  const allOutputs = useBroadcastStore((state) => state.outputs)
  const outputs = allOutputs.filter((output) => (output.role ?? "congregation") === "congregation")
  const scenes = useBroadcastStore((state) => state.scenes)
  const [momentId, setMomentId] = useState(moments[0]?.id ?? "")
  const [outputId, setOutputId] = useState(() => {
    const steps = moments[0] ? plannedSceneSteps(moments[0]) : []
    const scoped = steps.find((step) => step.outputId && outputs.some((output) => output.id === step.outputId))
    return scoped?.outputId ?? outputs[0]?.id ?? ""
  })
  const moment = moments.find((item) => item.id === momentId) ?? moments[0]
  const output = outputs.find((item) => item.id === outputId) ?? outputs[0]
  const sceneSelection = moment && output ? sceneForOutput(moment, output) : null
  const sceneId = sceneSelection?.sceneId
  const scene = scenes.find((candidate) => candidate.id === sceneId)
  const lastPreviewedMoment = useRef<QueueItem | null>(null)

  const previewMoment = useCallback((item: QueueItem) => {
    if (lastPreviewedMoment.current === item) return
    lastPreviewedMoment.current = item
    presentActions.previewItem(item)
  }, [])

  // Set the operator's private Preview before the first paint; changing moments does this in the
  // select handler below so the content card never flashes the previous item.
  useLayoutEffect(() => {
    if (moment) previewMoment(moment)
  }, [moment, previewMoment])

  if (!moments.length) {
    return <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Add a moment to {eventTitle} before previewing this event.</p>
  }

  return (
    <div className="space-y-4" aria-label="Event preview content">
      <section className="space-y-3" aria-labelledby="event-preview-heading">
        <div>
          <h3 id="event-preview-heading" className="text-sm font-semibold">Preview {eventTitle}</h3>
          <p className="mt-1 text-xs text-muted-foreground">Choose a moment and audience to inspect the scene layout. Preview only; an operator still has to Take in Present.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            <span>Event moment</span>
            <select
              aria-label="Preview event moment"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={moment?.id ?? ""}
              onChange={(event) => {
                const next = moments.find((item) => item.id === event.currentTarget.value)
                if (next) previewMoment(next)
                setMomentId(event.currentTarget.value)
                const nextSteps = next ? plannedSceneSteps(next) : []
                if (!nextSteps.some((step) => step.outputId === null)) {
                  const scoped = nextSteps.find((step) => step.outputId && outputs.some((screen) => screen.id === step.outputId))
                  if (scoped?.outputId) setOutputId(scoped.outputId)
                }
              }}
            >
              {moments.map((item) => <option key={item.id} value={item.id}>{item.reference}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span>Audience screen</span>
            <select
              aria-label="Preview audience screen"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={output?.id ?? ""}
              onChange={(event) => setOutputId(event.currentTarget.value)}
              disabled={outputs.length < 2}
            >
              {outputs.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
            </select>
          </label>
        </div>

        {sceneSelection?.source === "current" && (
          <p className="text-xs text-muted-foreground">This screen keeps its current scene for this moment.</p>
        )}
        {scene && output ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold">{scene.name} · {output.name}</p>
              {sceneSelection?.source === "current" && <span className="text-[0.6875rem] text-muted-foreground">Current scene</span>}
              {sceneSelection?.source === "item" && <span className="text-[0.6875rem] text-muted-foreground">Item look</span>}
            </div>
            <EventSceneCanvas scene={scene} output={output} />
            <p className="text-xs text-muted-foreground">Congregation preview only. Live-source layers show values active now. OBS stays independent in Production, and stage screens keep their private layouts. Neither preview changes an audience output.</p>
          </div>
        ) : output ? (
          <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
            {sceneId ? "The planned scene is not available on this computer." : `No scene is planned for ${output.name}; its full-screen content look is shown below.`}
          </p>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">No congregation screen is configured yet. The moment content preview is still available below.</p>
        )}
      </section>

      <section className="space-y-2" aria-label="Selected moment content preview">
        <p className="text-xs font-semibold">Moment content · {moment?.reference}</p>
        <div className="h-56 overflow-hidden rounded-lg [&>div]:h-full">
          <PreviewPanel itemLook />
        </div>
      </section>
    </div>
  )
}

function plannedSceneSteps(item: QueueItem): Extract<ParsedTakeStep, { kind: "scene" }>[] {
  // Iterate the saved field directly: takeSteps canonicalizes scene actions, while newer saved
  // items may contain a shared scene and multiple output-specific overrides.
  if (!Array.isArray(item.on_take)) return []
  return item.on_take.flatMap((raw) => {
    if (typeof raw !== "string") return []
    const step = parseTakeStep(raw)
    return step?.kind === "scene" ? [step] : []
  })
}

function sceneForOutput(item: QueueItem, output: BroadcastOutput): { sceneId: string | undefined; source: "screen" | "shared" | "item" | "current" } {
  const steps = plannedSceneSteps(item)
  const screenScene = steps.find((step) => step.outputId === output.id)
  if (screenScene) return { sceneId: screenScene.sceneId, source: "screen" }
  const sharedScene = steps.find((step) => step.outputId === null)
  if (sharedScene) return { sceneId: sharedScene.sceneId, source: "shared" }
  if (item.scene_id) return { sceneId: item.scene_id, source: "item" }
  return { sceneId: output.sceneId, source: "current" }
}

function EventSceneCanvas({ scene, output }: { scene: Scene; output: BroadcastOutput }) {
  const isLive = useBroadcastStore((state) => state.isLive)
  const liveVerse = useBroadcastStore((state) => state.liveVerse)
  const sources = useBroadcastStore((state) => state.sources)
  const themes = useBroadcastStore((state) => state.themes)
  const ticker = useBroadcastStore((state) => tickerForScreens(state))
  const lowerThird = useBroadcastStore((state) => state.lowerThird)
  const logoUrl = useSettingsStore((state) => state.brandKit.logoUrl)
  const cameras = useSettingsStore((state) => state.cameras)
  const countdowns = useBroadcastStore((state) => state.countdowns)
  const timer = useTimerStore((state) => state.timer)
  useTimerStore((state) => state.tick)
  const overlay = overlayFor(lowerThird, feedFrame({ isLive, liveVerse, sources }, output.shows))
  const live = { isLive, liveVerse, sources, themes, ticker, overlay, logoUrl, countdowns, cameraLabel: (url: string) => cameraLabelOf(url, cameras) }
  const theme = themes.find((candidate) => candidate.id === output.themeId) ?? themes[0]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layers = useRef(new Map<string, HTMLCanvasElement>())
  const [, redraw] = useState(0)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx || !theme) return
    drawScene(ctx, theme.resolution.width, theme.resolution.height, sceneFrame({ ...live, clock: sceneClock(timer, monotonicNow(), Date.now()) }, output, scene, true), {
      preview: true,
      imageCache: themeImageCache(),
      layerCanvas: (id) => {
        let layer = layers.current.get(id)
        if (!layer) layers.current.set(id, (layer = document.createElement("canvas")))
        return layer
      },
      image: (url) => {
        const image = themeImageCache().get(url)
        if (!image) void loadThemeImage(url).then(() => redraw((value) => value + 1))
        return image ?? null
      },
    })
  })

  if (!theme) return null
  return (
    <div className="overflow-hidden rounded-md bg-muted" style={{ aspectRatio: `${theme.resolution.width} / ${theme.resolution.height}` }}>
      <canvas
        ref={canvasRef}
        width={theme.resolution.width}
        height={theme.resolution.height}
        aria-label={`Preview of ${scene.name}`}
        role="img"
        className="size-full"
      />
    </div>
  )
}
