import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ChevronDownIcon, LayersIcon, RotateCcwIcon, UndoIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { drawScene } from "@/lib/scene-renderer"
import { sceneFrame } from "@/lib/scenes"
import { loadThemeImage, themeImageCache } from "@/lib/theme-image-cache"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { SceneSheetButton } from "@/studio/present/scene-sheet"
import type { BroadcastOutput, Scene } from "@/types"

/** Window heights at which the scenes start folded (a 1440×900 laptop and smaller). */
export const SCENES_FOLDED_QUERY = "(max-height: 900px)"

const isCongregation = (o: BroadcastOutput) => (o.role ?? "congregation") === "congregation"

/** What a scene Take does in rehearsal: like Show live there, it stays in the app and is undone when rehearsal ends. */
export const SCENES_REHEARSAL_NOTE = "Rehearsal: a Take here is practice. The screens keep their scene, and it comes back when rehearsal ends."

/**
 * Scenes in Present (ADR 0001): change what a congregation screen is arranged to show (camera and
 * Bible, lyrics on a picture…) without leaving the live console. Taking a scene changes the
 * screen's layout, not what is live: the words come from the live sources either way. Scenes are
 * made and edited in Production → Scenes (a basic one here too: New / Edit scene); this takes them, goes back to the screen's own
 * feed, and restores the last one. Shown only when there is a congregation screen and a saved scene.
 */
export function ScenesStrip({ className }: { className?: string }) {
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const congregation = outputs.filter(isCongregation)
  // Folded at first on a short window, so the Live panel keeps its room; one click opens it.
  const [open, setOpen] = useState(() => !(typeof window.matchMedia === "function" && window.matchMedia(SCENES_FOLDED_QUERY).matches))
  const [targetId, setTargetId] = useState<string | null>(null)
  const bodyId = useId()
  if (congregation.length === 0 || scenes.length === 0) return null
  const target = congregation.find((o) => o.id === targetId) ?? congregation[0]
  const sceneName = (o: BroadcastOutput) => scenes.find((s) => s.id === o.sceneId)?.name ?? "its own feed"

  return (
    <section aria-label="Scenes" className={cn("flex shrink-0 flex-col rounded-lg border border-border bg-card", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        title={open ? "Hide the scenes" : "Show the scenes"}
        className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <LayersIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Scenes</span>
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground">
          {congregation.map((o) => `${o.name}: ${sceneName(o)}`).join(" · ")}
        </span>
        <ChevronDownIcon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={bodyId} className="flex flex-col gap-2 border-t border-border px-3 pt-2 pb-2.5">
          {congregation.length > 1 && (
            <div role="group" aria-label="Which screen" className="flex flex-wrap items-center gap-1">
              {congregation.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={o.id === target.id}
                  onClick={() => setTargetId(o.id)}
                  className={cn("rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50", o.id === target.id ? "border-foreground/40 bg-muted text-foreground" : "border-border text-muted-foreground hover:bg-muted")}
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}
          <ScenePicker key={target.id} output={target} scenes={scenes} />
        </div>
      )}
    </section>
  )
}

/** One congregation screen: its saved scenes to pick from, and Take scene, its own feed, Restore. */
function ScenePicker({ output, scenes }: { output: BroadcastOutput; scenes: Scene[] }) {
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const back = useBroadcastStore((s) => s.sceneReturn[output.id])
  const covered = useBroadcastStore((s) => (s.isLive ? s.liveVerse?.screen : undefined))
  const [pickedId, setPickedId] = useState<string | null>(null)
  const showing = scenes.find((s) => s.id === output.sceneId)
  const picked = scenes.find((s) => s.id === pickedId) ?? null
  const restorable = back ? scenes.find((s) => s.id === back) : undefined
  const b = useBroadcastStore.getState

  const takeReason = !picked ? "Pick a scene above first" : picked.id === showing?.id ? `${output.name} already shows ${picked.name}` : null
  const ownReason = !showing ? `${output.name} already shows its own feed` : null
  const restoreReason = showing ? `${output.name} shows ${showing.name}: Restore is for after Back to its own feed` : !restorable ? `${output.name} has not shown a scene yet` : null
  // In rehearsal the scene on a screen is the rehearsal's, never called on air.
  const onAirWord = rehearsal ? "In rehearsal" : "On air"

  return (
    <>
      <div role="group" aria-label={`Scenes for ${output.name}`} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {scenes.map((s) => {
          const onAir = s.id === output.sceneId
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === pickedId}
              aria-label={`${s.name}${onAir ? `, ${onAirWord.toLowerCase()}` : ""}`}
              onClick={() => setPickedId(s.id === pickedId ? null : s.id)}
              title={onAir ? `${s.name} is on ${output.name}${rehearsal ? " in rehearsal" : ""}` : `Pick ${s.name}, then Take scene`}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md border p-1 pr-2 text-left text-[0.6875rem] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                s.id === pickedId ? "border-primary bg-primary/10 text-foreground" : "border-border hover:bg-muted"
              )}
            >
              <SceneThumb scene={s} output={output} />
              <span className="flex max-w-28 flex-col leading-tight">
                <span className="truncate font-semibold">{s.name}</span>
                {onAir && <span className={cn("text-[0.625rem] font-bold tracking-wide uppercase", rehearsal ? "text-tone-amber-foreground" : "text-live-pulse")}>{onAirWord}</span>}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <SceneAction
          icon={<LayersIcon />}
          label={picked ? `Take scene ${picked.name} to ${output.name}` : "Take scene"}
          text="Take scene"
          title={picked ? (rehearsal ? `Rehearse ${picked.name} on ${output.name}. The screen keeps its scene.` : `Arrange ${output.name} as ${picked.name}. What is live stays live.`) : "Take scene"}
          reason={takeReason}
          onClick={() => {
            if (!picked) return
            b().takeScene(output.id, picked.id)
            setPickedId(null)
          }}
          primary
        />
        <SceneAction
          icon={<UndoIcon />}
          label={`${output.name}: back to its own feed`}
          text="Own feed"
          title={`Back to its own feed: ${output.name} shows what is live, full screen`}
          reason={ownReason}
          onClick={() => b().releaseScene(output.id)}
        />
        <SceneAction
          icon={<RotateCcwIcon />}
          label={restorable ? `Restore ${restorable.name} on ${output.name}` : "Restore scene"}
          text={restorable ? `Restore ${restorable.name}` : "Restore"}
          title={restorable ? `Put ${restorable.name} back on ${output.name}` : "Restore the last scene"}
          reason={restoreReason}
          onClick={() => restorable && b().takeScene(output.id, restorable.id)}
        />
        <SceneSheetButton output={output} scene={picked} />
        <span className="min-w-0 flex-1 truncate text-right text-[0.6875rem] text-muted-foreground">
          {rehearsal && "Rehearsal · "}
          {showing ? <>Shows <strong className="font-semibold text-foreground">{showing.name}</strong></> : "Shows its own feed"}
          {covered && ` · ${covered === "black" ? "Black" : "Logo"} covers it`}
        </span>
      </div>
      {rehearsal && <p className="text-xs text-tone-amber-foreground">{SCENES_REHEARSAL_NOTE}</p>}
    </>
  )
}

/**
 * A scene control. Like the transport's, one that cannot act stays focusable and says why. Take
 * scene is outlined teal with a layers icon, so it never reads as the solid Take live.
 */
function SceneAction({ icon, label, text, title, reason, onClick, primary }: { icon: ReactNode; label: string; text: string; title: string; reason: string | null; onClick: () => void; primary?: boolean }) {
  const reasonId = useId()
  const off = reason !== null
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-disabled={off || undefined}
        aria-describedby={off ? reasonId : undefined}
        title={reason ?? title}
        onClick={off ? undefined : onClick}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 [&_svg]:size-3.5",
          primary ? "border-primary/70 bg-card text-primary-text hover:bg-primary/10 aria-disabled:hover:bg-card" : "border-border bg-card text-foreground hover:bg-muted aria-disabled:hover:bg-card"
        )}
      >
        {icon}
        <span aria-hidden className="max-w-36 truncate">{text}</span>
      </button>
      {off && <span id={reasonId} className="sr-only">{reason}</span>}
    </>
  )
}

const THUMB_W = 96
const THUMB_H = 54

/** A small picture of a scene as this screen would draw it now; redrawn only when the scene or what is live changes. */
function SceneThumb({ scene, output }: { scene: Scene; output: BroadcastOutput }) {
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const sources = useBroadcastStore((s) => s.sources)
  const themes = useBroadcastStore((s) => s.themes)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layers = useRef(new Map<string, HTMLCanvasElement>())
  const [loaded, redraw] = useState(0)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    drawScene(ctx, THUMB_W, THUMB_H, sceneFrame({ isLive, liveVerse, sources, themes }, output, scene), {
      imageCache: themeImageCache(),
      layerCanvas: (id) => {
        let c = layers.current.get(id)
        if (!c) layers.current.set(id, (c = document.createElement("canvas")))
        return c
      },
      image: (url) => {
        const img = themeImageCache().get(url)
        // Redraw once it loads; a picture that fails stays out rather than retrying forever.
        if (!img) void loadThemeImage(url).then((ok) => ok && redraw((n) => n + 1))
        return img ?? null
      },
    })
  }, [scene, output, isLive, liveVerse, sources, themes, loaded])

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_W}
      height={THUMB_H}
      aria-hidden
      className="h-[27px] w-12 shrink-0 rounded-sm bg-[repeating-conic-gradient(#2a3338_0%_25%,#20282c_0%_50%)] bg-[length:8px_8px]"
    />
  )
}
