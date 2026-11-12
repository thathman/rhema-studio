import { liveLanguage } from "@/lib/output-language"
import { useTimerStore, monotonicNow } from "@/stores/timer-store"
import { useEffect, useRef, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, BookmarkPlusIcon, CopyIcon, EyeIcon, EyeOffIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, SaveIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { CONTENT_NAMES } from "@/lib/content-names"
import { feedFrame } from "@/lib/live-sources"
import { drawScene } from "@/lib/scene-renderer"
import { copyScene, FADES, layerBox, newLayer, newScene, ownPreset, SCENE_PRESETS, sceneClock, sceneForOutput, sceneFrame, type ScenePreset } from "@/lib/scenes"
import { cameraLabelOf, cameraOfUrl, routerStatus, whepUrl, type RouterStatus } from "@/lib/cameras"
import { overlayFor } from "@/lib/lower-third-style"
import { loadThemeImage, themeImageCache } from "@/lib/theme-image-cache"
import { tickerForScreens, useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useServiceStore } from "@/stores/service-store"
import { useObsStore } from "@/stores/obs-store"
import { onlineProgramName } from "@/lib/program-names"
import { useMediaStore } from "@/stores/media-store"
import { dropReplacedGradients, gradientCss } from "@/lib/scene-gradient"
import { dropStaleImageDraws } from "@/lib/scene-image"
import { layerRotation, layerTurns } from "@/lib/scene-rotation"
import { framePivot, layerAt, resizeTurned, unturnDelta } from "@/studio/production/scene-hit"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"
import { CountdownSelect } from "@/studio/production/countdown-select"
import { useProductionTab } from "@/studio/production/production-tab"
import { useShellStore, type PrepareDesignReturnContext } from "@/studio/shell-store"
import { CONTENT_TYPES, type ContentType } from "@/types/broadcast"
import type { BroadcastOutput, BroadcastOutputLanguage, NoSignal, Scene, SceneBox, SceneLayer, SceneLayerKind } from "@/types"
import { toast } from "sonner"
import { sceneReleaseApprovalBlockReason } from "@/studio/present/scene-take-policy"

/**
 * The congregation Scene Composer (ADR 0001, ARCH-002): arrange live sources, colours, pictures and
 * camera places on one frame. Looks come from Design; this is about where things go. Edits stay in
 * the composer or saved library until the operator selects the scene and uses the named Program Take.
 */
export function SceneComposer() {
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const service = useServiceStore((s) => s.current)
  const requireApproval = useSettingsStore((s) => s.requireApproval)
  const sceneTakeBlockReason = sceneReleaseApprovalBlockReason(rehearsal, service, requireApproval)
  const prepareReturn = useShellStore((s) => s.prepareDesignReturn)
  const obsVideo = useObsStore((s) => (s.status === "connected" ? s.video : null))
  const congregation = outputs.filter((o) => (o.role ?? "congregation") === "congregation")
  const [targetId, setTargetId] = useState(congregation[0]?.id ?? "")
  const target = congregation.find((o) => o.id === targetId) ?? congregation[0]
  // A scene another page asked for (a library scene just copied) opens first, once.
  const [draft, setDraft] = useState<Scene | null>(() => {
    const requestedId = prepareReturn?.sceneId ?? useProductionTab.getState().scene
    return (requestedId ? scenes.find((scene) => scene.id === requestedId) : undefined) ?? (prepareReturn ? null : scenes[0] ?? null)
  })
  useEffect(() => {
    if (useProductionTab.getState().scene) useProductionTab.setState({ scene: null })
  }, [])
  const [layerId, setLayerId] = useState<string | null>(null)
  const [pendingSceneAction, setPendingSceneAction] = useState<"save" | "return" | "design" | null>(null)
  const saved = draft ? scenes.find((s) => s.id === draft.id) : undefined
  const dirty = !!draft && (!saved || JSON.stringify({ ...saved, updatedAt: 0 }) !== JSON.stringify({ ...draft, updatedAt: 0 }))
  const layer = draft?.layers.find((l) => l.id === layerId) ?? null
  const sceneSaveLosses = draft && saved ? sceneDesignDetailsLostOnSave(draft, saved) : []

  useEffect(() => {
    if (prepareReturn && !scenes.some((scene) => scene.id === prepareReturn.sceneId)) {
      toast.error("The scene copy is no longer available", { description: "Return to Prepare and choose a scene for this moment again." })
      useShellStore.getState().goTo("prepare")
    }
  }, [prepareReturn, scenes])

  const edit = (patch: Partial<Scene>) => draft && setDraft({ ...draft, ...patch })
  const editLayer = (id: string, patch: Partial<SceneLayer>) => draft && setDraft({ ...draft, layers: draft.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  const open = (s: Scene | null) => {
    setDraft(s)
    setLayerId(null)
  }
  const openPinnedDesign = () => {
    if (!draft?.design) return
    useShellStore.getState().openDesignDocument(draft.design.id)
  }
  const saveNow = (showUndo: boolean) => {
    if (!draft) return
    const before = saved
    useBroadcastStore.getState().saveScene(draft)
    const persisted = useBroadcastStore.getState().scenes.find((scene) => scene.id === draft.id)
    if (persisted) setDraft(persisted)
    if (!showUndo || !before || !persisted || sceneSaveLosses.length === 0) return
    const savedRevision = persisted.updatedAt
    toast.success("Scene saved with the listed Design changes", {
      description: "The pinned Design version is unchanged. Undo restores the previous Scene appearance if this scene has not changed again.",
      action: {
        label: "Undo",
        onClick: () => {
          const current = useBroadcastStore.getState().scenes.find((scene) => scene.id === before.id)
          if (!current || current.updatedAt !== savedRevision) {
            toast.error("This scene changed again", { description: "Reopen the saved Design version and choose it again to restore its complete appearance." })
            return
          }
          useBroadcastStore.getState().saveScene(before)
          const restored = useBroadcastStore.getState().scenes.find((scene) => scene.id === before.id)
          if (restored) setDraft(restored)
          toast.success("Saved Design appearance restored")
        },
      },
    })
  }
  const save = () => {
    if (!draft) return
    if (sceneSaveLosses.length) setPendingSceneAction("save")
    else saveNow(false)
  }
  const returnToPrepare = () => {
    if (dirty && sceneSaveLosses.length) { setPendingSceneAction("return"); return }
    if (dirty) saveNow(false)
    useShellStore.getState().goTo("prepare")
  }
  const confirmSceneAction = () => {
    const action = pendingSceneAction
    setPendingSceneAction(null)
    if (action === "design") { openPinnedDesign(); return }
    if (!action) return
    saveNow(true)
    if (action === "return") useShellStore.getState().goTo("prepare")
  }
  const requestOpenPinnedDesign = () => {
    if (!draft?.design) return
    if (dirty) { setPendingSceneAction("design"); return }
    openPinnedDesign()
  }
  const onAir = (id: string) => outputs.filter((o) => o.sceneId === id)

  return (
    <div className="flex flex-col gap-3">
      {/* Saved scene design stays separate from the congregation and OBS Program outputs. */}
      <header aria-label="Scene design context" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-bold tracking-[-0.02em]">Scene design</h2>
        <p className="text-xs text-muted-foreground">Saved looks for congregation screens. The {onlineProgramName(obsVideo)} is OBS's; scene edits do not change Program.</p>
      </header>
      <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)_17rem]">
        <section aria-label="Scenes" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          {prepareReturn ? (
            <>
              <h3 className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Prepare scene copy</h3>
              <p className="text-xs font-semibold">{prepareReturn.momentTitle}</p>
              <p className="text-xs text-muted-foreground">{prepareReturn.eventTitle}</p>
              <p className="rounded-md bg-tone-neutral px-2 py-1.5 text-xs text-tone-neutral-foreground">Draft for this service moment. It stays private until an operator Takes it in Live.</p>
            </>
          ) : (
            <>
              <h3 className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Scenes</h3>
              <ul className="flex flex-col gap-1">
                {scenes.map((s) => (
                  <li key={s.id}>
                    <button type="button" aria-current={draft?.id === s.id ? "true" : undefined} onClick={() => open(s)} className={cn("flex w-full flex-col rounded-md px-2.5 py-1.5 text-left text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50", draft?.id === s.id ? "bg-primary/10 text-primary-text" : "hover:bg-muted")}>
                      <span className="truncate font-semibold">{s.name}</span>
                      {onAir(s.id).length > 0 && <span className={cn("text-[0.625rem] font-bold uppercase", rehearsal ? "text-tone-amber-foreground" : "text-live-pulse")}>{rehearsal ? "Rehearsal on" : "On"} {onAir(s.id).map((o) => o.name).join(", ")}</span>}
                    </button>
                  </li>
                ))}
                {scenes.length === 0 && <li className="text-xs text-muted-foreground">No scenes yet. Start from one below.</li>}
              </ul>
              <NewFrom onNew={(p) => open(newScene(p.name, p))} />
            </>
          )}
        </section>

        <section aria-label="Scene preview" className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
          {draft ? (
            <>
              {prepareReturn && <p className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-xs text-muted-foreground">Private preview for {target?.name ?? "a congregation output"}. Saving this copy will not change Program or any output.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Scene name" value={draft.name} maxLength={80} onChange={(e) => edit({ name: e.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm font-semibold" />
                <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                  Background
                  {draft.backgroundGradient && <span aria-label="Scene background gradient preview" title={`Pinned gradient · ${draft.backgroundGradient.angle}° · ${draft.backgroundGradient.stops.length} stops`} className="size-6 rounded border border-border" style={{ background: gradientCss(draft.backgroundGradient) }} />}
                  <input type="color" aria-label="Background colour" disabled={draft.background === "transparent"} value={draft.background === "transparent" ? "#000000" : draft.background} onChange={(e) => edit({ background: e.target.value, backgroundGradient: undefined })} className="h-7 w-9 rounded border border-border bg-transparent p-0.5" />
                </label>
                <label className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                  <input type="checkbox" checked={draft.background === "transparent"} onChange={(e) => edit({ background: e.target.checked ? "transparent" : "#000000", backgroundGradient: undefined })} /> Transparent
                </label>
                <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                  Take
                  <select aria-label="How the scene comes on air" value={draft.fadeMs ?? 0} onChange={(e) => { const ms = Number(e.target.value); edit({ fadeMs: ms > 0 ? ms : undefined }) }} className="h-7 rounded-md border border-input bg-card px-1">
                    <option value={0}>Cut</option>
                    <option value={300}>Fade 0.3 s</option>
                    <option value={500}>Fade 0.5 s</option>
                    <option value={1000}>Fade 1 s</option>
                  </select>
                </label>
                {!prepareReturn && <Button size="sm" variant="outline" disabled={sceneSaveLosses.length > 0} title={sceneSaveLosses.length ? "Confirm the appearance change with Save before duplicating this scene." : undefined} onClick={() => open(copyScene(draft, `${draft.name} copy`))}><CopyIcon /> Duplicate</Button>}
                {!prepareReturn && <SaveAsPreset key={draft.id} scene={draft} disabled={sceneSaveLosses.length > 0} />}
                {!prepareReturn && saved && <ConfirmDelete label={`Delete ${draft.name}`} onConfirm={() => { useBroadcastStore.getState().deleteScene(draft.id); open(null) }} />}
              </div>
              {(draft.backgroundGradient || draft.layers.some((item) => item.gradient || item.imageDraw)) && (
                <div aria-label="Scene appearance details" className="flex flex-wrap items-center gap-2 rounded-md border border-tone-amber/40 bg-tone-amber/10 px-2.5 py-2 text-xs">
                  <span className="min-w-0 flex-1 text-tone-amber-foreground">
                    This scene includes precise gradient or picture appearance details. Changing a solid colour, picture or crop replaces the related detail only after you confirm Save. Save the change before duplicating or making a preset.
                  </span>
                  {draft.design ? <Button size="xs" variant="outline" onClick={requestOpenPinnedDesign}><PencilIcon /> Open source Design · pinned v{draft.design.version}</Button> : <span className="text-muted-foreground">No linked Design document is available for this scene.</span>}
                </div>
              )}
              {target && <ScenePreview scene={draft} output={target} selected={layerId} onSelect={setLayerId} onMove={(id, box) => editLayer(id, { box })} />}
              <AddLayer onAdd={(kind) => { const l = newLayer(kind, { box: kind === "feed" ? { x: 10, y: 60, w: 80, h: 35 } : layerBox(kind) }); setDraft({ ...draft, layers: [...draft.layers, l] }); setLayerId(l.id) }} />
              <ol aria-label="Layers, bottom first" className="flex flex-col gap-1">
                {draft.layers.map((l, i) => (
                  <li key={l.id} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", l.id === layerId ? "border-primary" : "border-border")}>
                    <button type="button" onClick={() => setLayerId(l.id)} className="min-w-0 flex-1 truncate text-left font-medium">{i + 1}. {l.name} <span className="text-muted-foreground">· {describe(l)}</span></button>
                    <IconButton label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} onClick={() => editLayer(l.id, { visible: !l.visible })}>{l.visible ? <EyeIcon /> : <EyeOffIcon />}</IconButton>
                    <IconButton label={`Move ${l.name} up`} disabled={i === draft.layers.length - 1} onClick={() => setDraft({ ...draft, layers: swap(draft.layers, i, i + 1) })}><ArrowUpIcon /></IconButton>
                    <IconButton label={`Move ${l.name} down`} disabled={i === 0} onClick={() => setDraft({ ...draft, layers: swap(draft.layers, i, i - 1) })}><ArrowDownIcon /></IconButton>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Choose a scene, or start one from a ready-made arrangement.</p>
          )}
        </section>

        <section aria-label="Layer" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-xs">
          <h3 className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Layer</h3>
          {draft && layer ? <Inspector layer={layer} onChange={(p) => editLayer(layer.id, p)} onOpenDesign={requestOpenPinnedDesign} hasPinnedDesign={!!draft.design} onRemove={() => { setDraft({ ...draft, layers: draft.layers.filter((l) => l.id !== layer.id) }); setLayerId(null) }} target={target} /> : <p className="text-muted-foreground">Select a layer in the preview or the list. Drag it to move it; drag its corner to resize; arrow keys nudge it.</p>}
        </section>
      </div>

      {prepareReturn
        ? <PrivateSceneBar context={prepareReturn} congregation={congregation} target={target} onTarget={setTargetId} draft={draft} dirty={dirty} onReturn={returnToPrepare} />
        : <ProgramBar congregation={congregation} target={target} onTarget={setTargetId} draft={draft} dirty={dirty} onSave={save} onPreviewRestore={open} sceneTakeBlockReason={sceneTakeBlockReason} />}

      <Dialog open={pendingSceneAction !== null} onOpenChange={(open) => { if (!open) setPendingSceneAction(null) }}>
        <DialogContent aria-describedby="scene-design-loss-description">
          <DialogHeader>
            <DialogTitle>{pendingSceneAction === "design" ? "Open the source Design?" : "Replace precise Design details?"}</DialogTitle>
            <DialogDescription id="scene-design-loss-description">
              {pendingSceneAction === "design"
                ? `Your unsaved Scene changes will be discarded. The source Design and pinned v${draft?.design?.version ?? "?"} will stay unchanged.`
                : "Saving this Scene will replace the listed precise Design details with the current solid colour or picture crop. This changes the saved Scene appearance; it does not change Program or any output."}
            </DialogDescription>
          </DialogHeader>
          {pendingSceneAction !== "design" && sceneSaveLosses.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Design details being replaced">
              {sceneSaveLosses.map((loss) => <li key={loss}>{loss}</li>)}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingSceneAction(null)}>Keep editing</Button>
            <Button onClick={confirmSceneAction}>{pendingSceneAction === "design" ? "Discard draft and open source Design" : pendingSceneAction === "return" ? "Replace details and return" : "Replace details and save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PrivateSceneBar({ context, congregation, target, onTarget, draft, dirty, onReturn }: {
  context: PrepareDesignReturnContext
  congregation: BroadcastOutput[]
  target: BroadcastOutput | undefined
  onTarget: (id: string) => void
  draft: Scene | null
  dirty: boolean
  onReturn: () => void
}) {
  return (
    <section aria-label="Private scene preview" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs">
      <span className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Private preview</span>
      {target ? (
        <>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Preview for
            <select aria-label="Preview output" value={target.id} onChange={(event) => onTarget(event.target.value)} className="h-8 rounded-md border border-input bg-secondary px-1.5 text-foreground">
              {congregation.map((output) => <option key={output.id} value={output.id}>{output.name}</option>)}
            </select>
          </label>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{context.eventTitle} · {context.momentTitle}</span>
        </>
      ) : <span className="min-w-0 flex-1 text-muted-foreground">No congregation output is configured. You can still save the scene copy for {context.momentTitle}.</span>}
      <Button size="sm" onClick={onReturn} disabled={!draft} aria-label={dirty ? "Save scene and return to Prepare" : "Return to Prepare"}>
        {dirty ? <><SaveIcon /> Save and return to Prepare</> : "Return to Prepare"}
      </Button>
    </section>
  )
}

function describe(l: SceneLayer): string {
  if (l.kind === "feed") return l.shows?.length ? l.shows.map((k) => CONTENT_NAMES[k]).join(" + ") + (l.held ? " · held" : "") : "whatever is on air" + (l.held ? " · held" : "")
  if (l.kind === "color") return l.gradient ? `colour · ${l.gradient.stops.length}-stop gradient` : "colour"
  if (l.kind === "ellipse") return l.gradient ? `ellipse · ${l.gradient.stops.length}-stop gradient` : "ellipse · solid fill"
  if (l.kind === "picture") return l.imageDraw ? "picture · precise Design crop" : "picture"
  if (l.kind === "video") return l.videoUrl ? "video, looping, no sound" : "video (none chosen yet)"
  if (l.kind === "clock") return "clock"
  if (l.kind === "ticker") return "the running ticker"
  if (l.kind === "lowerThird") return "the lower third on air"
  if (l.kind === "logo") return "the church logo"
  return l.cameraUrl ? "camera" : "camera (none chosen yet)"
}

/** Name the Design paint or image treatment that saveScene would otherwise replace. */
function sceneDesignDetailsLostOnSave(next: Scene, previous: Scene): string[] {
  const committed = dropStaleImageDraws(dropReplacedGradients(next, previous), previous)
  const losses: string[] = []
  if (previous.backgroundGradient && !committed.backgroundGradient) {
    losses.push(`Scene background gradient (${previous.backgroundGradient.stops.length} stops, ${previous.backgroundGradient.angle}°)`)
  }
  const nextLayers = new Map(committed.layers.map((layer) => [layer.id, layer]))
  for (const layer of previous.layers) {
    const current = nextLayers.get(layer.id)
    if (!current) continue // Removing a whole layer is an explicit scene edit.
    if (layer.gradient && !current.gradient) losses.push(`Gradient fill on “${layer.name}”`)
    if (layer.imageDraw && !current.imageDraw) losses.push(`Precise Design crop, corners, or clips on “${layer.name}”`)
  }
  return losses
}

/** The new-scene menu: the ready-made arrangements, then the church's own presets (rename, delete). */
function NewFrom({ onNew }: { onNew: (p: ScenePreset) => void }) {
  const own = useBroadcastStore((s) => s.scenePresets)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState("")
  const item = "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted [&_svg]:size-3.5 [&_svg]:shrink-0"
  const heading = "mt-1 text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase"
  return (
    <>
      <span className={heading}>New from</span>
      {SCENE_PRESETS.map((p) => (
        <button key={p.id} type="button" title={p.description} onClick={() => onNew(p)} className={item}>
          <PlusIcon /> {p.name}
        </button>
      ))}
      {own.length > 0 && <span className={heading}>Your presets</span>}
      {own.map((p) => renaming === p.id ? (
        <form key={p.id} className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); useBroadcastStore.getState().renameScenePreset(p.id, name); setRenaming(null) }}>
          <input aria-label={`New name for ${p.name}`} autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null) }} className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-xs" />
          <Button size="xs" type="submit" disabled={!name.trim()}>Save</Button>
        </form>
      ) : (
        <div key={p.id} className="flex items-center gap-0.5">
          <button type="button" title="Your preset: a new scene with this arrangement" onClick={() => onNew(ownPreset(p))} className={item}><PlusIcon /> <span className="truncate">{p.name}</span></button>
          <IconButton label={`Rename the preset ${p.name}`} onClick={() => { setRenaming(p.id); setName(p.name) }}><PencilIcon /></IconButton>
          <ConfirmDelete label={`Delete the preset ${p.name}`} onConfirm={() => useBroadcastStore.getState().deleteScenePreset(p.id)} />
        </div>
      ))}
    </>
  )
}

/** Keep this scene's arrangement as one of the church's presets, for new scenes. */
function SaveAsPreset({ scene, disabled = false }: { scene: Scene; disabled?: boolean }) {
  const [name, setName] = useState<string | null>(null)
  if (name === null) return <Button size="sm" variant="outline" disabled={disabled} onClick={() => setName(scene.name)} title={disabled ? "Confirm the appearance change with Save before making a preset." : "Keep this arrangement as a preset for new scenes"}><BookmarkPlusIcon /> Save as preset</Button>
  return (
    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); useBroadcastStore.getState().saveScenePreset(scene, name); setName(null) }}>
      <input aria-label="Preset name" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setName(null) }} title="A preset of the same name is replaced" className="h-8 w-40 rounded-md border border-input bg-transparent px-2 text-xs" />
      <Button size="sm" type="submit" disabled={!name.trim() || disabled} title={disabled ? "Confirm the appearance change with Save before making a preset." : undefined}>Save preset</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setName(null)}>Cancel</Button>
    </form>
  )
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = [...a]
  ;[b[i], b[j]] = [b[j], b[i]]
  return b
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex size-8 items-center justify-center rounded hover:bg-muted disabled:opacity-30 [&_svg]:size-3.5">{children}</button>
}

function AddLayer({ onAdd }: { onAdd: (kind: SceneLayerKind) => void }) {
  const kinds: [SceneLayerKind, string][] = [["feed", "Live content"], ["color", "Colour"], ["ellipse", "Ellipse"], ["picture", "Picture"], ["video", "Video"], ["clock", "Clock"], ["camera", "Camera"], ["ticker", "Ticker"], ["lowerThird", "Lower third"], ["logo", "Logo"]]
  return (
    <div role="group" aria-label="Add a layer" className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Add</span>
      {kinds.map(([k, name]) => <Button key={k} size="xs" variant="outline" onClick={() => onAdd(k)}><PlusIcon /> {name}</Button>)}
    </div>
  )
}

/** A clock layer's "Shows" choice: "next" and "milestone" are both a run-of-show countdown (#196 R2). */
function clockChoice(l: SceneLayer): string {
  if (l.clockShows === "countdown") return (l.countdownTo ?? "next") === "next" ? "next" : "milestone"
  return l.clockShows ?? "timer"
}

function clockPatch(choice: string): Partial<SceneLayer> {
  if (choice === "next") return { clockShows: "countdown", countdownTo: undefined }
  if (choice === "milestone") return { clockShows: "countdown", countdownTo: "end" }
  return { clockShows: choice === "timer" ? undefined : (choice as "time" | "until"), countdownTo: undefined }
}

/** The scene as the chosen output would show it now, with layers that can be dragged and resized. */
function ScenePreview({ scene, output, selected, onSelect, onMove }: { scene: Scene; output: BroadcastOutput; selected: string | null; onSelect: (id: string) => void; onMove: (id: string, box: SceneBox) => void }) {
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const sources = useBroadcastStore((s) => s.sources)
  const themes = useBroadcastStore((s) => s.themes)
  const ticker = useBroadcastStore((s) => tickerForScreens(s))
  const lowerThird = useBroadcastStore((s) => s.lowerThird)
  const logoUrl = useSettingsStore((s) => s.brandKit.logoUrl)
  const cameras = useSettingsStore((s) => s.cameras)
  const countdowns = useBroadcastStore((s) => s.countdowns)
  const timer = useTimerStore((s) => s.timer)
  useTimerStore((s) => s.tick)
  // The lower third as this output would show it (one that follows the program takes its words).
  const overlay = overlayFor(lowerThird, feedFrame({ isLive, liveVerse, sources }, output.shows))
  const live = { isLive, liveVerse, sources, themes, ticker, overlay, logoUrl, countdowns, cameraLabel: (url: string) => cameraLabelOf(url, cameras) }
  const theme = live.themes.find((t) => t.id === output.themeId) ?? live.themes[0]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layers = useRef(new Map<string, HTMLCanvasElement>())
  const [, redraw] = useState(0)
  const W = theme.resolution.width
  const H = theme.resolution.height

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    drawScene(ctx, W, H, sceneFrame({ ...live, clock: sceneClock(timer, monotonicNow(), Date.now()) }, output, scene, true), {
      preview: true,
      imageCache: themeImageCache(),
      layerCanvas: (id) => {
        let c = layers.current.get(id)
        if (!c) layers.current.set(id, (c = document.createElement("canvas")))
        return c
      },
      image: (url) => {
        const img = themeImageCache().get(url)
        if (!img) void loadThemeImage(url).then((ok) => { if (ok) redraw((n) => n + 1) })
        return img ?? null
      },
    })
  })

  // Where each turned layer turns (#851 G7), as the canvas draws it: the selection ring and the
  // pointer follow the turn, so a turned layer is grabbed where it shows.
  const [measure] = useState(() => (typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d")))
  const frames = new Map(sceneFrame(live, output, scene, true).layers.map((f) => [f.id, f]))
  const pivots = new Map([...frames.values()].map((f) => [f.id, framePivot(measure, f, W, H)]))
  const turnOf = (l: SceneLayer) => (layerTurns(l.kind) ? l.rotation : undefined)

  const box = useRef<HTMLDivElement>(null)
  const drag = (e: React.PointerEvent, l: SceneLayer, mode: "move" | "size") => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(l.id)
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    const start = { x: e.clientX, y: e.clientY, b: l.box }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture?.(e.pointerId)
    const turn = layerTurns(l.kind) ? l.rotation : undefined
    // Where the layer turns for a given box, so a resize keeps its far corner still on screen.
    const frame = frames.get(l.id)
    const pivotOf = (b: SceneBox) => (frame ? framePivot(measure, { ...frame, box: b }, W, H) : { x: b.x + b.w / 2, y: b.y + b.h / 2 })
    const move = (ev: PointerEvent) => {
      // A resize follows the layer's own (turned) edges.
      const d = mode === "size" ? unturnDelta(ev.clientX - start.x, ev.clientY - start.y, turn) : { dx: ev.clientX - start.x, dy: ev.clientY - start.y }
      const dx = (d.dx / rect.width) * 100
      const dy = (d.dy / rect.height) * 100
      const b = start.b
      const next = mode === "move"
        ? { ...b, x: clamp(b.x + dx, 0, 100 - b.w), y: clamp(b.y + dy, 0, 100 - b.h) }
        : resizeTurned(b, { w: clamp(b.w + dx, 2, 100), h: clamp(b.h + dy, 2, 100) }, turn, W, H, pivotOf)
      onMove(l.id, round(next))
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  /** Pick the topmost layer under the pointer where it is drawn (turned or not) and drag it. */
  const pick = (e: React.PointerEvent) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const visible = scene.layers.filter((l) => l.visible)
    const id = layerAt(visible.map((l) => ({ id: l.id, kind: l.kind, box: l.box, rotation: l.rotation, pivot: pivots.get(l.id) })), { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 }, W, H)
    const hit = visible.find((l) => l.id === id)
    if (hit) drag(e, hit, "move")
  }

  const nudge = (e: React.KeyboardEvent, l: SceneLayer) => {
    const d = e.shiftKey ? 5 : 1
    const b = l.box
    const next = e.key === "ArrowLeft" ? { ...b, x: clamp(b.x - d, 0, 100 - b.w) } : e.key === "ArrowRight" ? { ...b, x: clamp(b.x + d, 0, 100 - b.w) } : e.key === "ArrowUp" ? { ...b, y: clamp(b.y - d, 0, 100 - b.h) } : e.key === "ArrowDown" ? { ...b, y: clamp(b.y + d, 0, 100 - b.h) } : null
    if (!next) return
    e.preventDefault()
    onMove(l.id, next)
  }

  return (
    <div ref={box} data-testid="scene-preview" onPointerDown={pick} className="relative w-full overflow-hidden rounded-md bg-[repeating-conic-gradient(#2a3338_0%_25%,#20282c_0%_50%)] bg-[length:16px_16px]" style={{ aspectRatio: `${W} / ${H}` }}>
      <canvas ref={canvasRef} width={W} height={H} aria-label={`Preview of ${scene.name}`} role="img" className="absolute inset-0 size-full" />
      {scene.layers.filter((l) => l.visible).map((l) => (
        <div
          key={l.id}
          role="button"
          tabIndex={0}
          aria-label={`${l.name}: drag to move, arrow keys to nudge`}
          onKeyDown={(e) => nudge(e, l)}
          onFocus={() => onSelect(l.id)}
          // The pointer is hit-tested by the preview (`pick`), where the layer is drawn turned.
          className={cn("pointer-events-none absolute cursor-move outline-none", l.id === selected ? "ring-2 ring-primary" : "focus-visible:ring-2 focus-visible:ring-primary")}
          style={{ left: `${l.box.x}%`, top: `${l.box.y}%`, width: `${l.box.w}%`, height: `${l.box.h}%`, ...turnStyle(l.box, turnOf(l), pivots.get(l.id)) }}
        >
          {l.id === selected && <span aria-label={`Resize ${l.name}`} role="presentation" onPointerDown={(e) => drag(e, l, "size")} className="pointer-events-auto absolute -right-1.5 -bottom-1.5 size-3 cursor-se-resize rounded-sm bg-primary" />}
        </div>
      ))}
    </div>
  )
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** CSS that turns a layer's outline as the canvas turns the layer: about its pivot (% of the frame). */
function turnStyle(b: SceneBox, rotation: number | undefined, pivot: { x: number; y: number } | undefined): React.CSSProperties {
  if (!rotation) return {}
  const p = pivot ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  return { transform: `rotate(${rotation}deg)`, transformOrigin: `${((p.x - b.x) / b.w) * 100}% ${((p.y - b.y) / b.h) * 100}%` }
}
const round = (b: SceneBox): SceneBox => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 })

function Num({ label, value, onChange, min = 0, max = 100 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="number" aria-label={label} value={value} min={min} max={max} step={1} onChange={(e) => onChange(clamp(Number(e.target.value) || 0, min, max))} className="h-7 w-full rounded border border-input bg-transparent px-1.5 tabular-nums" />
    </label>
  )
}

function Inspector({ layer, onChange, onRemove, onOpenDesign, hasPinnedDesign, target }: { layer: SceneLayer; onChange: (p: Partial<SceneLayer>) => void; onRemove: () => void; onOpenDesign: () => void; hasPinnedDesign: boolean; target: BroadcastOutput | undefined }) {
  const languageOverrides = useBroadcastStore((s) => s.languageOverrides)
  const themes = useBroadcastStore((s) => s.themes)
  const assets = useMediaStore((s) => s.assets)
  const crop = layer.crop ?? { l: 0, t: 0, r: 0, b: 0 }
  const b = layer.box
  const holdNow = () => {
    const s = useBroadcastStore.getState()
    onChange({ held: feedFrame(s, layer.shows) })
  }
  useEffect(() => {
    if ((layer.kind === "picture" || layer.kind === "video") && assets.length === 0) void useMediaStore.getState().list().catch(() => [])
  }, [layer.kind, assets.length])
  return (
    <div className="flex flex-col gap-2.5">
      <input aria-label="Layer name" value={layer.name} maxLength={80} onChange={(e) => onChange({ name: e.target.value })} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm font-semibold" />
      {layer.kind === "feed" && (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs text-muted-foreground">Follows</legend>
            <span className="flex flex-wrap gap-1">
              <Chip on={!layer.shows?.length} onClick={() => onChange({ shows: undefined })}>Whatever is on air</Chip>
              {CONTENT_TYPES.map((k: ContentType) => {
                const on = !!layer.shows?.includes(k)
                return <Chip key={k} on={on} onClick={() => { const next = on ? layer.shows!.filter((x) => x !== k) : [...(layer.shows ?? []), k]; onChange({ shows: next.length ? next : undefined }) }}>{CONTENT_NAMES[k]}</Chip>
              })}
            </span>
          </fieldset>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Look (from Design)</span>
            <select aria-label="Look" value={layer.themeId ?? ""} onChange={(e) => onChange({ themeId: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-card px-1.5">
              <option value="">{target ? `${target.name}'s looks` : "The output's looks"}</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Language</span>
            <select aria-label="Layer language" value={layer.language ?? ""} onChange={(e) => onChange({ language: (e.target.value || undefined) as BroadcastOutputLanguage | undefined })} className="h-8 rounded-md border border-input bg-card px-1.5">
              <option value="">{target ? `As ${target.name} is set (${LANGUAGE_NAMES[liveLanguage(target, languageOverrides)].toLowerCase()}${languageOverrides[target.id] ? ", this session" : ""})` : "As the output is set"}</option>
              {(Object.keys(LANGUAGE_NAMES) as BroadcastOutputLanguage[]).map((k) => <option key={k} value={k}>{LANGUAGE_NAMES[k]}</option>)}
            </select>
            <span className="text-muted-foreground">For a verse or song in two languages: this box can show both, or one of them, whatever the screen shows elsewhere.</span>
          </label>
          {layer.held ? (
            <Button size="sm" variant="outline" onClick={() => onChange({ held: null })}><PinOffIcon /> Follow live again <span className="truncate text-muted-foreground">({layer.held.reference || "held"})</span></Button>
          ) : (
            <Button size="sm" variant="outline" onClick={holdNow} title="Keep what this layer shows now, whatever goes live next"><PinIcon /> Hold what it shows now</Button>
          )}
        </>
      )}
      {(layer.kind === "color" || layer.kind === "ellipse") && (
        <>
          {layer.gradient && <div aria-label="Pinned Design gradient fill" className="flex flex-wrap items-center gap-2 rounded-md border border-tone-amber/40 bg-tone-amber/10 p-2">
            <span className="size-8 shrink-0 rounded border border-border" aria-hidden="true" style={{ background: gradientCss(layer.gradient) }} />
            <span className="min-w-0 flex-1 text-tone-amber-foreground">Pinned Design gradient · {layer.gradient.angle}° · {layer.gradient.stops.length} stops. Choosing a solid colour replaces this fill after Save.</span>
            {hasPinnedDesign && <Button size="xs" variant="outline" onClick={onOpenDesign}><PencilIcon /> Open Design</Button>}
          </div>}
          <label className="flex items-center justify-between gap-2">
            <span>{layer.kind === "ellipse" ? "Ellipse fill" : "Colour"}</span>
            <input type="color" aria-label={layer.kind === "ellipse" ? "Ellipse fill" : "Layer colour"} value={layer.color ?? (layer.kind === "ellipse" ? "#3157a4" : "#000000")} onChange={(e) => onChange({ color: e.target.value, gradient: undefined })} className="h-7 w-10 rounded border border-border bg-transparent p-0.5" />
          </label>
        </>
      )}
      {layer.kind === "picture" && (
        <>
          {layer.imageDraw && <div aria-label="Pinned Design image treatment" className="flex flex-wrap items-center gap-2 rounded-md border border-tone-amber/40 bg-tone-amber/10 p-2">
            <span className="min-w-0 flex-1 text-tone-amber-foreground">This picture has a precise Design crop, corners or clips. Choosing another picture or percentage crop replaces that treatment after Save.</span>
            {hasPinnedDesign && <Button size="xs" variant="outline" onClick={onOpenDesign}><PencilIcon /> Open Design</Button>}
          </div>}
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Picture (from Library)</span>
            <select
              aria-label="Picture"
              value={layer.mediaId ?? ""}
              onChange={async (e) => {
                const id = e.target.value
                if (!id) return onChange({ mediaId: undefined, imageUrl: undefined, imageDraw: undefined })
                const url = await useMediaStore.getState().dataUrl(id).catch(() => null)
                onChange({ mediaId: id, imageUrl: url ?? undefined, imageDraw: undefined })
              }}
              className="h-8 rounded-md border border-input bg-card px-1.5"
            >
              <option value="">Choose a picture…</option>
              {assets.filter((a) => a.kind === "image" && a.present !== false).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </>
      )}
      {layer.kind === "video" && <VideoPicker layer={layer} onChange={onChange} />}
      {layer.kind === "clock" && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Shows</span>
            <select aria-label="What the clock shows" value={clockChoice(layer)} onChange={(e) => onChange(clockPatch(e.target.value))} className="h-8 rounded-md border border-input bg-card px-1.5">
              <option value="timer">The service timer (Present → timer)</option>
              <option value="until">A countdown to a time (e.g. the service start)</option>
              <option value="next">Time until the next item</option>
              <option value="milestone">Time until a milestone (e.g. the service end)</option>
              <option value="time">The time of day</option>
            </select>
          </label>
          {clockChoice(layer) === "milestone" && (
            <label className="flex items-center justify-between gap-2">
              <span>Milestone</span>
              <CountdownSelect label="Milestone to count down to" value={layer.countdownTo} onChange={(countdownTo) => onChange({ countdownTo })} className="min-w-0 flex-1" />
            </label>
          )}
          {layer.clockShows === "until" && (
            <label className="flex items-center justify-between gap-2">
              <span>Count down to</span>
              <input type="time" aria-label="Count down to" value={layer.until ?? ""} onChange={(e) => onChange({ until: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-transparent px-2" />
            </label>
          )}
          <p className="text-muted-foreground">{layer.clockShows === "time" ? "This computer's time of day." : layer.clockShows === "until" ? "Counts down to that time today, then stays at 0:00." : layer.clockShows === "countdown" ? "From the run of show: when it is expected to start or end, moving as the service runs late or early. It stops at 0:00 on the screens and shows nothing when there is no next item." : "A countdown or the time so far, as Present's timer runs. It stops at 0:00 on the screens."}</p>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Look (from Design)</span>
            <select aria-label="Clock look" value={layer.themeId ?? ""} onChange={(e) => onChange({ themeId: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-card px-1.5">
              <option value="">{target ? `${target.name}'s look` : "The output's look"}</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </>
      )}
      {layer.kind === "camera" && <CameraPicker layer={layer} onChange={onChange} />}
      {layer.kind === "camera" && <NoSignalChoice layer={layer} onChange={onChange} />}
      <div className="grid grid-cols-4 gap-1.5">
        <Num label="Left %" value={b.x} max={100 - b.w} onChange={(x) => onChange({ box: { ...b, x } })} />
        <Num label="Top %" value={b.y} max={100 - b.h} onChange={(y) => onChange({ box: { ...b, y } })} />
        <Num label="Width %" value={b.w} min={1} max={100 - b.x} onChange={(w) => onChange({ box: { ...b, w } })} />
        <Num label="Height %" value={b.h} min={1} max={100 - b.y} onChange={(h) => onChange({ box: { ...b, h } })} />
      </div>
      {layerTurns(layer.kind) && (
        <div className="flex items-end gap-1.5">
          <div className="w-24"><Num label="Rotation °" value={layer.rotation ?? 0} min={-180} max={180} onChange={(deg) => onChange({ rotation: layerRotation(deg) })} /></div>
          {layer.rotation ? <Button size="xs" variant="outline" onClick={() => onChange({ rotation: undefined })}>Upright</Button> : null}
        </div>
      )}
      {layer.kind === "ticker" && <p className="text-muted-foreground">The ticker that is running (Present → Ticker), in this box. While this scene is up, the ticker shows only here, not across the whole screen. Nothing shows here while no ticker runs.</p>}
      {layer.kind === "lowerThird" && <p className="text-muted-foreground">The lower third that is up (Present → Lower third), laid out in this box. While this scene is up, the lower third shows only here, not across the whole screen.</p>}
      {layer.kind === "logo" && <LogoNote />}
      {layer.kind !== "color" && layer.kind !== "ellipse" && layer.kind !== "ticker" && layer.kind !== "lowerThird" && (
        <div className="grid grid-cols-4 gap-1.5">
          <Num label="Crop left" value={crop.l} max={90 - crop.r} onChange={(l) => onChange({ crop: { ...crop, l }, ...(layer.kind === "picture" ? { imageDraw: undefined } : {}) })} />
          <Num label="Crop top" value={crop.t} max={90 - crop.b} onChange={(t) => onChange({ crop: { ...crop, t }, ...(layer.kind === "picture" ? { imageDraw: undefined } : {}) })} />
          <Num label="Crop right" value={crop.r} max={90 - crop.l} onChange={(r) => onChange({ crop: { ...crop, r }, ...(layer.kind === "picture" ? { imageDraw: undefined } : {}) })} />
          <Num label="Crop bottom" value={crop.b} max={90 - crop.t} onChange={(bb) => onChange({ crop: { ...crop, b: bb }, ...(layer.kind === "picture" ? { imageDraw: undefined } : {}) })} />
        </div>
      )}
      {FADES(layer.kind) && (
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">When it changes</span>
          <select aria-label="How this layer changes" value={layer.fadeMs ?? 0} onChange={(e) => { const ms = Number(e.target.value); onChange({ fadeMs: ms > 0 ? ms : undefined }) }} className="h-8 rounded-md border border-input bg-card px-1.5">
            <option value={0}>Cut</option>
            <option value={300}>Fade 0.3 s</option>
            <option value={500}>Fade 0.5 s</option>
            <option value={1000}>Fade 1 s</option>
          </select>
          <span className="text-muted-foreground">How this layer goes to something new (the next verse or slide, another picture). How the whole scene comes on air is the scene's Take setting.</span>
        </label>
      )}
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0">Opacity</span>
        <input type="range" aria-label="Opacity" min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} className="flex-1" />
        <span className="w-9 text-right tabular-nums">{Math.round(layer.opacity * 100)}%</span>
      </label>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="outline" onClick={() => onChange({ box: { x: 0, y: 0, w: 100, h: 100 }, crop: undefined, ...(layer.kind === "picture" ? { imageDraw: undefined } : {}) })}>Fill the frame</Button>
        <ConfirmDelete label={`Remove ${layer.name}`} verb="Remove" onConfirm={onRemove} />
      </div>
    </div>
  )
}

const LANGUAGE_NAMES: Record<BroadcastOutputLanguage, string> = { both: "Both languages, as prepared", first: "First language only", second: "Second language only" }

/** A library video for a video layer: it loops without sound on every screen that shows the scene. */
export function VideoPicker({ layer, onChange }: { layer: SceneLayer; onChange: (p: Partial<SceneLayer>) => void }) {
  const assets = useMediaStore((s) => s.assets)
  const videos = assets.filter((a) => a.kind === "video" && a.present !== false)
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">Video (from Library)</span>
      <select
        aria-label="Video"
        value={layer.mediaId ?? ""}
        onChange={async (e) => {
          const id = e.target.value
          if (!id) return onChange({ mediaId: undefined, videoUrl: undefined, mediaFile: undefined })
          const url = await useMediaStore.getState().fileUrl(id).catch(() => null)
          const file = useMediaStore.getState().assets.find((a) => a.id === id)?.file
          onChange({ mediaId: id, videoUrl: url ?? undefined, mediaFile: file })
        }}
        className="h-8 rounded-md border border-input bg-card px-1.5"
      >
        <option value="">Choose a video…</option>
        {videos.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <span className="text-muted-foreground">{videos.length === 0 ? "No videos in the Library yet: add one in Library → Media." : "Plays on a loop without sound, under the layers above it, on every screen and browser feed that shows this scene."}</span>
    </label>
  )
}

/**
 * The church's cameras (Live → Production tools → Cameras) by name, for a camera layer; typing a stream address
 * stays possible under Advanced (a camera relayed somewhere else on the church network).
 */
/**
 * What a camera's box shows while the camera is not sending: colour bars (the default, with the
 * camera's name if ticked), TV static, words, or nothing. Shared with Present's scene sheet and joined desks.
 */
export function NoSignalChoice({ layer, onChange, className = "h-8" }: { layer: Pick<SceneLayer, "noSignal" | "noSignalName" | "cameraFallback">; onChange: (p: Partial<SceneLayer>) => void; className?: string }) {
  const mode = layer.noSignal ?? "bars"
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">When the camera isn't sending</span>
        <select aria-label="When the camera isn't sending" value={mode} onChange={(e) => onChange({ noSignal: e.target.value === "bars" ? undefined : (e.target.value as NoSignal) })} className={cn(className, "rounded-md border border-input bg-card px-1.5")}>
          <option value="bars">Colour bars</option>
          <option value="static">TV static</option>
          <option value="words">Words</option>
          <option value="none">Nothing (what is behind shows)</option>
        </select>
      </label>
      {mode === "bars" && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!layer.noSignalName} onChange={(e) => onChange({ noSignalName: e.target.checked || undefined })} />
          <span>Show the camera's name on the bars</span>
        </label>
      )}
      {mode === "words" && (
        <input aria-label="Words while the camera is not playing" value={layer.cameraFallback ?? ""} maxLength={120} placeholder="e.g. Camera back shortly" onChange={(e) => onChange({ cameraFallback: e.target.value || undefined })} className={cn(className, "rounded-md border border-input bg-transparent px-2")} />
      )}
      <span className="text-xs text-muted-foreground">{mode === "static" ? "Grey noise that moves, like an untuned TV." : mode === "none" ? "The camera's box is empty: the scene's background and layers below show." : mode === "words" ? "In the text style of the screen's look." : "The screens go back to the camera picture as soon as it sends."}</span>
    </div>
  )
}

export function CameraPicker({ layer, onChange }: { layer: SceneLayer; onChange: (p: Partial<SceneLayer>) => void }) {
  const cameras = useSettingsStore((s) => s.cameras)
  const [router, setRouter] = useState<RouterStatus | null>(null)
  useEffect(() => {
    let live = true
    void routerStatus().then((r) => { if (live) setRouter(r) })
    return () => { live = false }
  }, [])
  const host = router?.lanAddress ?? null
  const chosen = cameraOfUrl(layer.cameraUrl, cameras)
  const value = chosen ?? (layer.cameraUrl ? "typed" : "")
  const pick = (name: string) => {
    const cam = cameras.find((c) => c.name === name)
    if (!name || !cam) return onChange({ cameraUrl: undefined })
    if (!host || !router) return
    onChange({ cameraUrl: whepUrl(host, router.ports, cam.name), ...(layer.name === "Camera" ? { name: `${cam.label} camera` } : {}) })
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">Camera</span>
        <select aria-label="Camera" value={value} onChange={(e) => pick(e.target.value)} className="h-8 rounded-md border border-input bg-card px-1.5">
          <option value="">No camera yet</option>
          {cameras.map((c) => <option key={c.name} value={c.name} disabled={!host && c.name !== chosen}>{c.label}</option>)}
          {value === "typed" && <option value="typed" disabled>An address typed under Advanced</option>}
        </select>
        <span className="text-muted-foreground">
          {cameras.length === 0 ? "No cameras yet: add the phones or cameras for each angle in Live → Production tools → Cameras." : !host ? "Turn on the camera router in Live → Production tools → Cameras to choose a camera here." : "Each screen plays it straight from the camera router, without sound; until it connects its box shows what you choose under When the camera isn't sending."}
        </span>
      </label>
      <details open={value === "typed"} className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Advanced: type a stream address</summary>
        <label className="mt-1 flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Stream address (WHEP)</span>
          <input aria-label="Camera stream address" value={layer.cameraUrl ?? ""} placeholder="http://192.168.1.10:8889/pulpit/whep" onChange={(e) => onChange({ cameraUrl: e.target.value.trim() || undefined })} className="h-8 rounded-md border border-input bg-transparent px-2" />
          <span className="text-muted-foreground">A camera relayed somewhere else on the church network (MediaMTX: http://&lt;its computer&gt;:8889/&lt;camera&gt;/whep). Only addresses on the church network are used.</span>
        </label>
      </details>
    </div>
  )
}

function LogoNote() {
  const logoUrl = useSettingsStore((s) => s.brandKit.logoUrl)
  return <p className="text-muted-foreground">{logoUrl ? "The church logo from the Brand Kit (Design), fitted whole in this box. A new logo there shows here too." : "No church logo yet: add it in Design → Brand Kit, and it shows here."}</p>
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold", on ? "border-primary bg-primary/10 text-primary-text" : "border-border text-muted-foreground hover:bg-muted")}>{children}</button>
}

/** Read-only output context for design editing; the named Take stays on the main Program card. */
function ProgramBar({ congregation, target, onTarget, draft, dirty, onSave, onPreviewRestore, sceneTakeBlockReason }: { congregation: BroadcastOutput[]; target: BroadcastOutput | undefined; onTarget: (id: string) => void; draft: Scene | null; dirty: boolean; onSave: () => void; onPreviewRestore: (scene: Scene) => void; sceneTakeBlockReason: string | null }) {
  const scenes = useBroadcastStore((s) => s.scenes)
  const back = useBroadcastStore((s) => (target ? s.sceneReturn[target.id] : undefined))
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const showing = target ? sceneForOutput(target, scenes) : undefined
  const restorable = !showing && back ? scenes.find((s) => s.id === back) : undefined
  if (!target) return <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">Add a congregation output (Live → Production tools → Screens) to take a scene to it.</p>
  return (
    // The live console's own colours (dark ink, in every theme), from its tokens.
    <section aria-label="On the screen" className="dark present-surface flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs text-foreground">
      <span className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Preview output</span>
      <select aria-label="Scene preview output" value={target.id} onChange={(e) => onTarget(e.target.value)} className="h-8 rounded-md border border-input bg-secondary px-1.5 text-foreground">
        {congregation.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <span className="min-w-0 flex-1 truncate">
        {rehearsal && <strong className="mr-1.5 text-tone-amber-foreground" title="Rehearsal is on: a Take here stays in the app. The screens keep their scene, and it comes back when rehearsal ends.">Rehearsal ·</strong>}
        {showing ? <>Shows <strong>{showing.name}</strong></> : "Shows its own feed, full screen"}
      </span>
      {draft && dirty && <Button size="sm" variant="outline" onClick={onSave} className="border-input bg-transparent text-foreground hover:bg-muted"><SaveIcon /> Save scene</Button>}
      {draft && <p className="basis-full text-xs text-muted-foreground">This editor is private. Save the scene, choose it in Live → Scenes, then use the named Take on Program.</p>}
      {showing && <Button size="sm" variant="outline" aria-label={rehearsal ? `Rehearse back to ${target.name}'s own feed` : `Back to ${target.name}'s own feed`} title={sceneTakeBlockReason ?? undefined} disabled={!!sceneTakeBlockReason} onClick={() => useBroadcastStore.getState().releaseScene(target.id)} className="border-input bg-transparent text-foreground hover:bg-muted">Back to its own feed</Button>}
      {restorable && <Button size="sm" variant="outline" aria-label={`Preview restore ${restorable.name} for ${target.name}`} onClick={() => onPreviewRestore(restorable)} className="border-input bg-transparent text-foreground hover:bg-muted">Preview restore {restorable.name}</Button>}
    </section>
  )
}
