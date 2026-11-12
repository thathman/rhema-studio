import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ChevronDownIcon, LayersIcon, RotateCcwIcon, UndoIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { drawScene } from "@/lib/scene-renderer"
import { sceneForOutput, sceneFrame, sceneNeedsRefresh } from "@/lib/scenes"
import { sceneRevisionLabel, sceneTakeDetails } from "@/lib/scene-take-details"
import { readSceneTakeRevisions, sceneTakeApproval, type ApprovedSceneTake } from "@/lib/scene-take"
import { loadThemeImage, themeImageCache } from "@/lib/theme-image-cache"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useServiceStore } from "@/stores/service-store"
import { cleanIntentId } from "@/lib/item-intent"
import { sceneReleaseApprovalBlockReason } from "@/studio/present/scene-take-policy"
import { usePreviewItem } from "@/studio/prepare/use-selected-item"
import { SceneSheetButton } from "@/studio/present/scene-sheet"
import type { SceneTakeSelection } from "@/studio/present/live-scene-take-action"
import type { BroadcastOutput, Scene, SceneAppearanceSnapshot } from "@/types"

/** Window heights at which the scenes start folded (a 1440×900 laptop and smaller). */
export const SCENES_FOLDED_QUERY = "(max-height: 900px)"

const isCongregation = (o: BroadcastOutput) => (o.role ?? "congregation") === "congregation"

type ApprovedPreviewState =
  | { key: string; status: "idle" | "loading" }
  | { key: string; status: "ready"; approved: ApprovedSceneTake }
  | { key: string; status: "error"; message: string }

/** What a scene Take does in rehearsal: like Show live there, it stays in the app and is undone when rehearsal ends. */
export const SCENES_REHEARSAL_NOTE = "Rehearsal: a Take here is practice. The screens keep their scene, and it comes back when rehearsal ends."

/**
 * Scenes in Present (ADR 0001): choose a private arrangement for a congregation screen (camera and
 * Bible, lyrics on a picture…) without leaving the live console. Selection does not change the
 * screen; the named action on Program applies it. The words still come from the live sources.
 * Scenes are made and edited in Live → Production tools → Scenes. The operator can return to the
 * screen's own feed and preview the last scene before the same named Take. Shown only when there
 * is a congregation screen and a saved scene.
 */
export function ScenesStrip({ className, outputId, onTakeSelectionChange }: {
  className?: string
  outputId?: string | null
  onTakeSelectionChange?: (selection: SceneTakeSelection | null) => void
}) {
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const congregation = outputs.filter(isCongregation)
  // Folded at first on a short window, so the Live panel keeps its room; one click opens it.
  const [open, setOpen] = useState(() => !(typeof window.matchMedia === "function" && window.matchMedia(SCENES_FOLDED_QUERY).matches))
  const bodyId = useId()
  const planned = usePlannedScene(scenes)
  if (congregation.length === 0 || scenes.length === 0) return null
  const target = congregation.find((o) => o.id === outputId) ?? congregation[0]
  const sceneName = (o: BroadcastOutput) => sceneForOutput(o, scenes)?.name ?? "its own feed"

  return (
    <section aria-label="Scenes" className={cn("flex shrink-0 flex-col rounded-lg border border-border bg-card", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        aria-label={open ? `Hide detailed scenes for ${target.name}` : `Show detailed scenes for ${target.name}`}
        title={open ? "Hide detailed scene controls" : "Show full scene controls"}
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <LayersIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">Scenes</span>
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-muted-foreground">
          {congregation.map((o) => `${o.name}: ${sceneName(o)}`).join(" · ")}
          {planned && !open && ` · Preview's item: ${planned.name}`}
        </span>
        <ChevronDownIcon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      <div className={cn("flex flex-col gap-2 border-t border-border", open ? "px-3 pt-2 pb-2.5" : "px-2 py-1.5")}>
        <ScenePicker key={target.id} output={target} scenes={scenes} planned={planned} open={open} controlsId={bodyId} onTakeSelectionChange={onTakeSelectionChange} />
      </div>
    </section>
  )
}

/** The scene the previewed rundown item is planned with (its `scene_id`, #243 RS.3), when it is a saved one. */
function usePlannedScene(scenes: Scene[]): Scene | null {
  const id = cleanIntentId(usePreviewItem()?.item.scene_id)
  return (id && scenes.find((s) => s.id === id)) || null
}

/**
 * One congregation screen: its saved scenes to preview, its own feed, and a restore preview.
 * The previewed item's planned scene starts picked (never taken: the Program action stays explicit);
 * a pick of the operator's own holds until Preview's planned scene changes.
 */
function ScenePicker({ output, scenes, planned, open, controlsId, onTakeSelectionChange }: {
  output: BroadcastOutput
  scenes: Scene[]
  planned: Scene | null
  open: boolean
  controlsId: string
  onTakeSelectionChange?: (selection: SceneTakeSelection | null) => void
}) {
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const service = useServiceStore((s) => s.current)
  const requireApproval = useSettingsStore((s) => s.requireApproval)
  const themes = useBroadcastStore((s) => s.themes)
  const logoUrl = useSettingsStore((s) => s.brandKit.logoUrl)
  const [refreshed, setRefreshed] = useState(false)
  const operatorName = useSettingsStore((s) => s.operatorName)
  const taken = useBroadcastStore((s) => s.sceneTakes[output.id])
  const back = useBroadcastStore((s) => s.sceneReturn[output.id])
  const covered = useBroadcastStore((s) => (s.isLive ? s.liveVerse?.screen : undefined))
  // The operator's own pick (null: none); undefined follows the plan.
  const [own, setOwn] = useState<string | null | undefined>(undefined)
  const plannedId = planned?.id ?? null
  const [seenPlanned, setSeenPlanned] = useState(plannedId)
  if (seenPlanned !== plannedId) {
    setSeenPlanned(plannedId)
    setOwn(undefined)
  }
  const showing = sceneForOutput(output, scenes)
  const releaseBlock = sceneReleaseApprovalBlockReason(rehearsal, service, requireApproval)
  // Already on this screen: nothing to pre-pick.
  const suggested = planned && planned.id !== showing?.id ? planned : null
  const pickedId = own !== undefined ? own : (suggested?.id ?? null)
  const picked = scenes.find((s) => s.id === pickedId) ?? null
  const approvalPreviewRequired = !rehearsal && !!service && service.approved_revision !== null && service.approved_revision !== undefined
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const previewKey = approvalPreviewRequired && picked
    ? `${service.id}\u0000${service.approved_revision}\u0000${output.id}\u0000${picked.id}\u0000${picked.updatedAt}\u0000${previewAttempt}`
    : ""
  const [approvedPreview, setApprovedPreview] = useState<ApprovedPreviewState>({ key: "", status: "idle" })
  useEffect(() => {
    if (!previewKey || !picked || !service) return
    let current = true
    void (async () => {
      const observed = await readSceneTakeRevisions(output.id, picked.id)
      if (!current) return
      if (!observed.ok) {
        setApprovedPreview({ key: previewKey, status: "error", message: observed.refusal.message })
        return
      }
      if (observed.seen.service !== service.id || observed.seen.approved === null) {
        setApprovedPreview({ key: previewKey, status: "error", message: "The main computer is not reporting this service's approved revision." })
        return
      }
      const checked = await sceneTakeApproval(picked.id, [output.id])
      if (!current) return
      if (!checked.ok) {
        setApprovedPreview({ key: previewKey, status: "error", message: checked.refusal.message })
        return
      }
      const pin = checked.approved
      const appearance = pin?.outputs[output.id]
      if (!pin || pin.programId !== observed.seen.service || pin.revision !== observed.seen.approved || pin.scene.id !== picked.id || !appearance) {
        setApprovedPreview({ key: previewKey, status: "error", message: "The approved scene or this output's captured appearance is incomplete or changed. Review the service approval before taking it." })
        return
      }
      setApprovedPreview({ key: previewKey, status: "ready", approved: pin })
    })().catch((error) => {
      if (current) setApprovedPreview({ key: previewKey, status: "error", message: error instanceof Error ? error.message : String(error) })
    })
    return () => { current = false }
  }, [previewKey, output.id, picked, service])
  const currentApprovedPreview = approvedPreview.key === previewKey
    ? approvedPreview
    : previewKey
      ? { key: previewKey, status: "loading" as const }
      : { key: "", status: "idle" as const }
  const approvedPin = currentApprovedPreview.status === "ready" ? currentApprovedPreview.approved : null
  const previewScene = approvalPreviewRequired ? approvedPin?.scene ?? null : picked
  const approvalPreviewReason = approvalPreviewRequired
    ? currentApprovedPreview.status === "loading"
      ? "Checking the approved scene and this output's appearance with the main computer."
      : currentApprovedPreview.status === "error"
        ? `Approved Preview could not be verified: ${currentApprovedPreview.message}`
        : null
    : null
  const takeDetailsId = useId()
  const restorable = back ? scenes.find((s) => s.id === back) : undefined
  const b = useBroadcastStore.getState

  const currentApprovalIsOnOutput = !approvedPin || (
    output.sceneSnapshot?.id === approvedPin.scene.id
    && output.sceneSnapshot.updatedAt === approvedPin.scene.updatedAt
    && output.sceneSnapshot.design?.id === approvedPin.scene.design?.id
    && output.sceneSnapshot.design?.version === approvedPin.scene.design?.version
    && output.sceneAppearanceSnapshot?.approved?.programId === approvedPin.programId
    && output.sceneAppearanceSnapshot.approved.revision === approvedPin.revision
    && output.sceneAppearanceSnapshot.approved.appearanceComplete !== false
  )
  const takeReason = !picked
    ? "Pick a scene above first"
    : approvalPreviewReason
      ?? (previewScene && showing && previewScene.id === showing.id && previewScene.updatedAt === showing.updatedAt && currentApprovalIsOnOutput && !sceneNeedsRefresh(output, scenes, themes, logoUrl) ? `${output.name} already shows ${previewScene.name}` : null)
  const ownReason = releaseBlock ?? (!showing ? `${output.name} already shows its own feed` : null)
  const restoreReason = showing ? `${output.name} shows ${showing.name}: Restore is for after Back to its own feed` : !restorable ? `${output.name} has not shown a scene yet` : null
  // In rehearsal the scene on a screen is the rehearsal's, never called on air.
  const onAirWord = rehearsal ? "In rehearsal" : "On air"
  const details = picked && previewScene && !takeReason ? sceneTakeDetails({
    outputName: output.name,
    sceneName: previewScene.name,
    revision: sceneRevisionLabel(previewScene),
    actor: operatorName,
    rehearsal,
  }) : null

  useEffect(() => {
    onTakeSelectionChange?.(picked ? {
      outputId: output.id,
      outputName: output.name,
      sceneId: picked.id,
      sceneName: previewScene?.name ?? picked.name,
      sceneUpdatedAt: previewScene?.updatedAt ?? picked.updatedAt,
      revisionLabel: previewScene ? sceneRevisionLabel(previewScene) : sceneRevisionLabel(picked),
      disabledReason: takeReason,
      details,
    } : null)
  }, [output.id, output.name, picked, previewScene, takeReason, details, onTakeSelectionChange])

  return (
    <>
      {!open && (
        <div role="group" aria-label={`Quick scene controls for ${output.name}`} className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="flex min-w-36 flex-1 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="shrink-0">Scene</span>
            <select
              aria-label={`Choose scene for ${output.name}`}
              value={pickedId ?? ""}
              onChange={(event) => { setOwn(event.currentTarget.value || null); setRefreshed(false) }}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Choose a scene</option>
              {scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}
            </select>
          </label>
          {picked && previewScene && <SceneThumb scene={previewScene} output={output} appearance={approvedPin?.outputs[output.id]} />}
          <span className="min-w-0 flex-1 truncate text-right text-[0.6875rem] text-muted-foreground" title={`${rehearsal ? "Rehearsal layout" : "Current layout"} on ${output.name}`}>
            Private Preview: {previewScene?.name ?? (approvalPreviewRequired ? "approved scene unavailable" : "no scene selected")} · {rehearsal ? "Rehearsal layout" : "Layout"}: {showing?.name ?? "own feed"}{showing ? ` · ${sceneRevisionLabel(showing)}` : ""}
          </span>
        </div>
      )}
      <div id={controlsId} hidden={!open} className={open ? "flex flex-col gap-2" : "hidden"}>
        <div role="group" aria-label={`Scenes for ${output.name}`} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {scenes.map((s) => {
            const onAir = s.id === output.sceneId
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === pickedId}
                aria-label={`${s.name}${onAir ? `, ${onAirWord.toLowerCase()}` : s.id === planned?.id ? ", planned for the item in Preview" : ""}`}
                onClick={() => { setOwn(s.id === pickedId ? null : s.id); setRefreshed(false) }}
                title={onAir ? `${s.name} is on ${output.name}${rehearsal ? " in rehearsal" : ""}` : `Pick ${s.name}, then Take scene${s.id === planned?.id ? " (the scene planned for the item in Preview)" : ""}`}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border p-1 pr-2 text-left text-[0.6875rem] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  s.id === pickedId ? "border-primary bg-primary/10 text-foreground" : "border-border hover:bg-muted"
                )}
              >
                {s.id === pickedId && approvalPreviewRequired
                  ? previewScene
                    ? <SceneThumb scene={previewScene} output={output} appearance={approvedPin?.outputs[output.id]} />
                    : <span data-approved-preview-unavailable={s.id} className="flex h-[27px] w-12 shrink-0 items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground">Checking</span>
                  : <SceneThumb scene={s} output={output} />}
                <span className="flex max-w-28 flex-col leading-tight">
                  <span className="truncate font-semibold">{s.name}</span>
                  {onAir && <span className={cn("text-[0.625rem] font-bold tracking-wide uppercase", rehearsal ? "text-tone-amber-foreground" : "text-live-pulse")}>{onAirWord}</span>}
                  {!onAir && s.id === planned?.id && <span className="text-[0.625rem] font-bold tracking-wide text-primary-text uppercase">For Preview</span>}
                </span>
              </button>
            )
          })}
        </div>
        {showing && sceneNeedsRefresh(output, scenes, themes, logoUrl) && scenes.some((s) => s.id === showing.id) && (
          <button type="button" aria-label={`Refresh saved preview for ${output.name}`} className="min-h-11 self-start rounded-md border px-3 text-xs" onClick={() => { setOwn(showing.id); setRefreshed(true) }}>
            Refresh saved preview
          </button>
        )}
        {showing && <p className="text-xs text-muted-foreground">
          {rehearsal ? "Rehearsal" : "Taken"} design: {sceneRevisionLabel(showing)} · Saved by {showing.updatedBy || "unknown operator"}.
          {!rehearsal && taken && <> Taken by {taken.by || "unknown operator"} at {new Date(taken.at).toLocaleString()}.</>}
          {scenes.find((s) => s.id === showing.id) && <> Saved design: {sceneRevisionLabel(scenes.find((s) => s.id === showing.id)!)}.</>}
          {output.sceneAppearanceSnapshot?.approved && <> Approved service {output.sceneAppearanceSnapshot.approved.programId} revision {output.sceneAppearanceSnapshot.approved.revision} · {output.sceneAppearanceSnapshot.approved.approvedBy || "unknown operator"} · {output.sceneAppearanceSnapshot.approved.approvedAt || "time unavailable"}.</>}
        </p>}
        <div className="flex flex-wrap items-center gap-1.5">
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
            label={restorable ? `Preview restore ${restorable.name} on ${output.name}` : "Preview restore scene"}
            text={restorable ? `Preview restore ${restorable.name}` : "Preview restore"}
            title={restorable ? `Select ${restorable.name} in private Preview. The Program Take stays a separate action.` : "Choose a scene to preview before taking."}
            reason={restoreReason}
            onClick={() => {
              if (!restorable) return
              setOwn(restorable.id)
              setRefreshed(false)
            }}
          />
          <SceneSheetButton output={output} scene={picked} />
          <span className="min-w-0 flex-1 truncate text-right text-[0.6875rem] text-muted-foreground">
            {rehearsal && "Rehearsal · "}
            {showing ? <>Shows <strong className="font-semibold text-foreground">{showing.name}</strong></> : "Shows its own feed"}
            {covered && ` · ${covered === "black" ? "Black" : "Logo"} covers it`}
          </span>
        </div>
        {rehearsal && <p className="text-xs text-tone-amber-foreground">{SCENES_REHEARSAL_NOTE}</p>}
      </div>
      {details && <p id={takeDetailsId} role="note" aria-label="Take details" className="text-xs text-muted-foreground">{details}</p>}
      {approvalPreviewRequired && picked && (
        <p role={currentApprovedPreview.status === "error" ? "alert" : "status"} aria-live="polite" className="text-xs text-muted-foreground">
          {currentApprovedPreview.status === "loading"
            ? "Checking the approved scene and output appearance with the main computer. No output changes."
            : currentApprovedPreview.status === "error"
              ? `${currentApprovedPreview.message} This scene cannot be taken until the approved Preview is verified.`
              : currentApprovedPreview.status === "ready"
                ? `Private Preview · approved service revision ${currentApprovedPreview.approved.revision} · ${output.name} only. Take applies this pinned scene and appearance.`
                : ""}
        </p>
      )}
      {currentApprovedPreview.status === "error" && picked && approvalPreviewRequired && (
        <button type="button" className="min-h-11 self-start rounded-md border px-3 text-xs" onClick={() => setPreviewAttempt((attempt) => attempt + 1)}>
          Refresh approved Preview
        </button>
      )}
      {refreshed && <p role="status" className="text-xs text-muted-foreground">Preview refreshed for {output.name}. Take scene to apply it.</p>}
    </>
  )
}

/** A scene control that cannot act stays focusable and explains why. */
function SceneAction({ icon, label, text, title, reason, onClick }: { icon: ReactNode; label: string; text: string; title: string; reason: string | null; onClick: () => void }) {
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
          "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 [&_svg]:size-3.5",
          "border-border bg-card text-foreground hover:bg-muted aria-disabled:hover:bg-card"
        )}
      >
        {icon}
        <span aria-hidden className="max-w-56 truncate">{text}</span>
      </button>
      {off && <span id={reasonId} className="sr-only">{reason}</span>}
    </>
  )
}

const THUMB_W = 96
const THUMB_H = 54

/** A small picture of a scene as this screen would draw it now; redrawn only when the scene or what is live changes. */
function SceneThumb({ scene, output, appearance }: { scene: Scene; output: BroadcastOutput; appearance?: SceneAppearanceSnapshot }) {
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const sources = useBroadcastStore((s) => s.sources)
  const themes = useBroadcastStore((s) => s.themes)
  const logoUrl = useSettingsStore((s) => s.brandKit.logoUrl)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layers = useRef(new Map<string, HTMLCanvasElement>())
  const [loaded, redraw] = useState(0)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    drawScene(ctx, THUMB_W, THUMB_H, sceneFrame({ isLive, liveVerse, sources, themes, logoUrl }, { ...output, sceneAppearanceSnapshot: appearance }, scene), {
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
  }, [scene, output, appearance, isLive, liveVerse, sources, themes, logoUrl, loaded])

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_W}
      height={THUMB_H}
      data-scene-preview-id={scene.id}
      data-scene-preview-updated-at={scene.updatedAt}
      data-scene-preview-design-id={scene.design?.id}
      data-scene-preview-design-version={scene.design?.version}
      aria-hidden
      className="h-[27px] w-12 shrink-0 rounded-sm bg-[repeating-conic-gradient(#2a3338_0%_25%,#20282c_0%_50%)] bg-[length:8px_8px]"
    />
  )
}
