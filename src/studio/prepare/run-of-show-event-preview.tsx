import { useEffect, useRef, useState } from "react"
import { drawScene } from "@/lib/scene-renderer"
import { cameraLabelOf } from "@/lib/cameras"
import { feedFrame } from "@/lib/live-sources"
import { overlayFor } from "@/lib/lower-third-style"
import { sceneClock, sceneFrame } from "@/lib/scenes"
import { takeSteps } from "@/lib/item-intent"
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
    const target = moments[0] ? takeSteps(moments[0]).find((step) => step.kind === "scene") : undefined
    return target?.kind === "scene" && outputs.some((output) => output.id === target.outputId) ? target.outputId! : outputs[0]?.id ?? ""
  })
  const moment = moments.find((item) => item.id === momentId) ?? moments[0]
  const output = outputs.find((item) => item.id === outputId) ?? outputs[0]
  const plannedScene = moment ? takeSteps(moment).find((step) => step.kind === "scene") : undefined

  useEffect(() => {
    if (moment) presentActions.previewItem(moment)
  }, [moment])

  if (!moments.length) {
    return <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Add a moment to {eventTitle} before previewing this event.</p>
  }

  const sceneAppliesToOutput = !plannedScene || plannedScene.kind !== "scene" || !plannedScene.outputId || plannedScene.outputId === output?.id
  const sceneId = output && (sceneAppliesToOutput && plannedScene?.kind === "scene"
    ? plannedScene.sceneId
    : sceneAppliesToOutput && moment?.scene_id
      ? moment.scene_id
      : output.sceneId)
  const scene = scenes.find((candidate) => candidate.id === sceneId)

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
                setMomentId(event.currentTarget.value)
                const target = next ? takeSteps(next).find((step) => step.kind === "scene") : undefined
                if (target?.kind === "scene" && target.outputId && outputs.some((screen) => screen.id === target.outputId)) setOutputId(target.outputId)
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

        {plannedScene?.kind === "scene" && plannedScene.outputId && plannedScene.outputId !== output?.id && (
          <p className="text-xs text-muted-foreground">This moment's scene Take is assigned to another audience screen. Showing this screen's current scene.</p>
        )}
        {scene && output ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold">{scene.name} · {output.name}</p>
              {!plannedScene && !moment?.scene_id && <span className="text-[0.6875rem] text-muted-foreground">Current scene</span>}
            </div>
            <EventSceneCanvas scene={scene} output={output} />
            <p className="text-xs text-muted-foreground">Live-source layers show the values active now. The planned moment's content is previewed below; neither preview changes an audience output.</p>
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
