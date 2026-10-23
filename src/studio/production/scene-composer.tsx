import { useTimerStore, monotonicNow } from "@/stores/timer-store"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, EyeIcon, EyeOffIcon, PinIcon, PinOffIcon, PlusIcon, SaveIcon, UndoIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CONTENT_NAMES } from "@/lib/content-names"
import { feedFrame } from "@/lib/live-sources"
import { drawScene } from "@/lib/scene-renderer"
import { copyScene, newLayer, newScene, SCENE_PRESETS, sceneClock, sceneFrame } from "@/lib/scenes"
import { loadThemeImage, themeImageCache } from "@/lib/theme-image-cache"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMediaStore } from "@/stores/media-store"
import { ConfirmDelete } from "@/studio/ui/confirm-delete"
import { CONTENT_TYPES, type ContentType } from "@/types/broadcast"
import type { BroadcastOutput, Scene, SceneBox, SceneLayer, SceneLayerKind } from "@/types"

/**
 * The congregation Scene Composer (ADR 0001, ARCH-002): arrange live sources, colours, pictures and
 * camera places on one frame, then Take it to a congregation output. Looks come from Design; this is
 * about where things go. Edits stay in the composer until Save or Take, so a scene on air never
 * changes while it is being arranged.
 */
export function SceneComposer() {
  const scenes = useBroadcastStore((s) => s.scenes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const congregation = outputs.filter((o) => (o.role ?? "congregation") === "congregation")
  const [targetId, setTargetId] = useState(congregation[0]?.id ?? "")
  const target = congregation.find((o) => o.id === targetId) ?? congregation[0]
  const [draft, setDraft] = useState<Scene | null>(() => scenes[0] ?? null)
  const [layerId, setLayerId] = useState<string | null>(null)
  const saved = draft ? scenes.find((s) => s.id === draft.id) : undefined
  const dirty = !!draft && (!saved || JSON.stringify({ ...saved, updatedAt: 0 }) !== JSON.stringify({ ...draft, updatedAt: 0 }))
  const layer = draft?.layers.find((l) => l.id === layerId) ?? null

  const edit = (patch: Partial<Scene>) => draft && setDraft({ ...draft, ...patch })
  const editLayer = (id: string, patch: Partial<SceneLayer>) => draft && setDraft({ ...draft, layers: draft.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  const open = (s: Scene | null) => {
    setDraft(s)
    setLayerId(null)
  }
  const save = () => draft && useBroadcastStore.getState().saveScene(draft)
  const take = () => {
    if (!draft || !target) return
    save()
    useBroadcastStore.getState().takeScene(target.id, draft.id)
  }
  const onAir = (id: string) => outputs.filter((o) => o.sceneId === id)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)_17rem]">
        <section aria-label="Scenes" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <h3 className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Scenes</h3>
          <ul className="flex flex-col gap-1">
            {scenes.map((s) => (
              <li key={s.id}>
                <button type="button" aria-current={draft?.id === s.id ? "true" : undefined} onClick={() => open(s)} className={cn("flex w-full flex-col rounded-md px-2.5 py-1.5 text-left text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50", draft?.id === s.id ? "bg-primary/10 text-primary" : "hover:bg-muted")}>
                  <span className="truncate font-semibold">{s.name}</span>
                  {onAir(s.id).length > 0 && <span className="text-[0.625rem] font-bold text-live-pulse uppercase">On {onAir(s.id).map((o) => o.name).join(", ")}</span>}
                </button>
              </li>
            ))}
            {scenes.length === 0 && <li className="text-xs text-muted-foreground">No scenes yet. Start from one below.</li>}
          </ul>
          <span className="mt-1 text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">New from</span>
          {SCENE_PRESETS.map((p) => (
            <button key={p.id} type="button" title={p.description} onClick={() => open(newScene(p.name, p))} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted [&_svg]:size-3.5">
              <PlusIcon /> {p.name}
            </button>
          ))}
        </section>

        <section aria-label="Scene preview" className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3">
          {draft ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Scene name" value={draft.name} maxLength={80} onChange={(e) => edit({ name: e.target.value })} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm font-semibold" />
                <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                  Background
                  <input type="color" aria-label="Background colour" disabled={draft.background === "transparent"} value={draft.background === "transparent" ? "#000000" : draft.background} onChange={(e) => edit({ background: e.target.value })} className="h-7 w-9 rounded border border-border bg-transparent p-0.5" />
                </label>
                <label className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                  <input type="checkbox" checked={draft.background === "transparent"} onChange={(e) => edit({ background: e.target.checked ? "transparent" : "#000000" })} /> Transparent
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
                <Button size="sm" variant="outline" onClick={() => open(copyScene(draft, `${draft.name} copy`))}><CopyIcon /> Duplicate</Button>
                {saved && <ConfirmDelete label={`Delete ${draft.name}`} onConfirm={() => { useBroadcastStore.getState().deleteScene(draft.id); open(null) }} />}
              </div>
              {target && <ScenePreview scene={draft} output={target} selected={layerId} onSelect={setLayerId} onMove={(id, box) => editLayer(id, { box })} />}
              <AddLayer onAdd={(kind) => { const l = newLayer(kind, { box: kind === "feed" ? { x: 10, y: 60, w: 80, h: 35 } : { x: 0, y: 0, w: 100, h: 100 } }); setDraft({ ...draft, layers: [...draft.layers, l] }); setLayerId(l.id) }} />
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
          {draft && layer ? <Inspector layer={layer} onChange={(p) => editLayer(layer.id, p)} onRemove={() => { setDraft({ ...draft, layers: draft.layers.filter((l) => l.id !== layer.id) }); setLayerId(null) }} target={target} /> : <p className="text-muted-foreground">Select a layer in the preview or the list. Drag it to move it; drag its corner to resize; arrow keys nudge it.</p>}
        </section>
      </div>

      <ProgramBar congregation={congregation} target={target} onTarget={setTargetId} draft={draft} dirty={dirty} onSave={save} onTake={take} />
    </div>
  )
}

function describe(l: SceneLayer): string {
  if (l.kind === "feed") return l.shows?.length ? l.shows.map((k) => CONTENT_NAMES[k]).join(" + ") + (l.held ? " · held" : "") : "whatever is on air" + (l.held ? " · held" : "")
  if (l.kind === "color") return "colour"
  if (l.kind === "picture") return "picture"
  return l.cameraUrl ? "camera" : "camera (no stream yet)"
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
  const kinds: [SceneLayerKind, string][] = [["feed", "Live content"], ["color", "Colour"], ["picture", "Picture"], ["clock", "Clock"], ["camera", "Camera"]]
  return (
    <div role="group" aria-label="Add a layer" className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Add</span>
      {kinds.map(([k, name]) => <Button key={k} size="xs" variant="outline" onClick={() => onAdd(k)}><PlusIcon /> {name}</Button>)}
    </div>
  )
}

/** The scene as the chosen output would show it now, with layers that can be dragged and resized. */
function ScenePreview({ scene, output, selected, onSelect, onMove }: { scene: Scene; output: BroadcastOutput; selected: string | null; onSelect: (id: string) => void; onMove: (id: string, box: SceneBox) => void }) {
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const sources = useBroadcastStore((s) => s.sources)
  const themes = useBroadcastStore((s) => s.themes)
  const timer = useTimerStore((s) => s.timer)
  useTimerStore((s) => s.tick)
  const live = { isLive, liveVerse, sources, themes }
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
        if (!img) void loadThemeImage(url).then(() => redraw((n) => n + 1))
        return img ?? null
      },
    })
  })

  const box = useRef<HTMLDivElement>(null)
  const drag = useCallback((e: React.PointerEvent, l: SceneLayer, mode: "move" | "size") => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(l.id)
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    const start = { x: e.clientX, y: e.clientY, b: l.box }
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture?.(e.pointerId)
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - start.x) / rect.width) * 100
      const dy = ((ev.clientY - start.y) / rect.height) * 100
      const b = start.b
      const next = mode === "move"
        ? { ...b, x: clamp(b.x + dx, 0, 100 - b.w), y: clamp(b.y + dy, 0, 100 - b.h) }
        : { ...b, w: clamp(b.w + dx, 2, 100 - b.x), h: clamp(b.h + dy, 2, 100 - b.y) }
      onMove(l.id, round(next))
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [onMove, onSelect])

  const nudge = (e: React.KeyboardEvent, l: SceneLayer) => {
    const d = e.shiftKey ? 5 : 1
    const b = l.box
    const next = e.key === "ArrowLeft" ? { ...b, x: clamp(b.x - d, 0, 100 - b.w) } : e.key === "ArrowRight" ? { ...b, x: clamp(b.x + d, 0, 100 - b.w) } : e.key === "ArrowUp" ? { ...b, y: clamp(b.y - d, 0, 100 - b.h) } : e.key === "ArrowDown" ? { ...b, y: clamp(b.y + d, 0, 100 - b.h) } : null
    if (!next) return
    e.preventDefault()
    onMove(l.id, next)
  }

  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-md bg-[repeating-conic-gradient(#2a3338_0%_25%,#20282c_0%_50%)] bg-[length:16px_16px]" style={{ aspectRatio: `${W} / ${H}` }}>
      <canvas ref={canvasRef} width={W} height={H} aria-label={`Preview of ${scene.name}`} role="img" className="absolute inset-0 size-full" />
      {scene.layers.filter((l) => l.visible).map((l) => (
        <div
          key={l.id}
          role="button"
          tabIndex={0}
          aria-label={`${l.name}: drag to move, arrow keys to nudge`}
          onPointerDown={(e) => drag(e, l, "move")}
          onKeyDown={(e) => nudge(e, l)}
          onFocus={() => onSelect(l.id)}
          className={cn("absolute cursor-move outline-none", l.id === selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-white/40 focus-visible:ring-2 focus-visible:ring-primary")}
          style={{ left: `${l.box.x}%`, top: `${l.box.y}%`, width: `${l.box.w}%`, height: `${l.box.h}%` }}
        >
          {l.id === selected && <span aria-label={`Resize ${l.name}`} role="presentation" onPointerDown={(e) => drag(e, l, "size")} className="absolute -right-1.5 -bottom-1.5 size-3 cursor-se-resize rounded-sm bg-primary" />}
        </div>
      ))}
    </div>
  )
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round = (b: SceneBox): SceneBox => ({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 })

function Num({ label, value, onChange, min = 0, max = 100 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[0.625rem] text-muted-foreground">{label}</span>
      <input type="number" aria-label={label} value={value} min={min} max={max} step={1} onChange={(e) => onChange(clamp(Number(e.target.value) || 0, min, max))} className="h-7 w-full rounded border border-input bg-transparent px-1.5 tabular-nums" />
    </label>
  )
}

function Inspector({ layer, onChange, onRemove, target }: { layer: SceneLayer; onChange: (p: Partial<SceneLayer>) => void; onRemove: () => void; target: BroadcastOutput | undefined }) {
  const themes = useBroadcastStore((s) => s.themes)
  const assets = useMediaStore((s) => s.assets)
  const crop = layer.crop ?? { l: 0, t: 0, r: 0, b: 0 }
  const b = layer.box
  const holdNow = () => {
    const s = useBroadcastStore.getState()
    onChange({ held: feedFrame(s, layer.shows) })
  }
  useEffect(() => {
    if (layer.kind === "picture" && assets.length === 0) void useMediaStore.getState().list().catch(() => [])
  }, [layer.kind, assets.length])
  return (
    <div className="flex flex-col gap-2.5">
      <input aria-label="Layer name" value={layer.name} maxLength={80} onChange={(e) => onChange({ name: e.target.value })} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm font-semibold" />
      {layer.kind === "feed" && (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[0.625rem] text-muted-foreground">Follows</legend>
            <span className="flex flex-wrap gap-1">
              <Chip on={!layer.shows?.length} onClick={() => onChange({ shows: undefined })}>Whatever is on air</Chip>
              {CONTENT_TYPES.map((k: ContentType) => {
                const on = !!layer.shows?.includes(k)
                return <Chip key={k} on={on} onClick={() => { const next = on ? layer.shows!.filter((x) => x !== k) : [...(layer.shows ?? []), k]; onChange({ shows: next.length ? next : undefined }) }}>{CONTENT_NAMES[k]}</Chip>
              })}
            </span>
          </fieldset>
          <label className="flex flex-col gap-0.5">
            <span className="text-[0.625rem] text-muted-foreground">Look (from Design)</span>
            <select aria-label="Look" value={layer.themeId ?? ""} onChange={(e) => onChange({ themeId: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-card px-1.5">
              <option value="">{target ? `${target.name}'s looks` : "The output's looks"}</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {layer.held ? (
            <Button size="sm" variant="outline" onClick={() => onChange({ held: null })}><PinOffIcon /> Follow live again <span className="truncate text-muted-foreground">({layer.held.reference || "held"})</span></Button>
          ) : (
            <Button size="sm" variant="outline" onClick={holdNow} title="Keep what this layer shows now, whatever goes live next"><PinIcon /> Hold what it shows now</Button>
          )}
        </>
      )}
      {layer.kind === "color" && (
        <label className="flex items-center justify-between gap-2">
          <span>Colour</span>
          <input type="color" aria-label="Layer colour" value={layer.color ?? "#000000"} onChange={(e) => onChange({ color: e.target.value })} className="h-7 w-10 rounded border border-border bg-transparent p-0.5" />
        </label>
      )}
      {layer.kind === "picture" && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.625rem] text-muted-foreground">Picture (from Library)</span>
          <select
            aria-label="Picture"
            value={layer.mediaId ?? ""}
            onChange={async (e) => {
              const id = e.target.value
              if (!id) return onChange({ mediaId: undefined, imageUrl: undefined })
              const url = await useMediaStore.getState().dataUrl(id).catch(() => null)
              onChange({ mediaId: id, imageUrl: url ?? undefined })
            }}
            className="h-8 rounded-md border border-input bg-card px-1.5"
          >
            <option value="">Choose a picture…</option>
            {assets.filter((a) => a.kind === "image" && a.present !== false).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      {layer.kind === "clock" && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="text-[0.625rem] text-muted-foreground">Shows</span>
            <select aria-label="What the clock shows" value={layer.clockShows ?? "timer"} onChange={(e) => onChange({ clockShows: e.target.value === "timer" ? undefined : (e.target.value as "time" | "until") })} className="h-8 rounded-md border border-input bg-card px-1.5">
              <option value="timer">The service timer (Present → timer)</option>
              <option value="until">A countdown to a time (e.g. the service start)</option>
              <option value="time">The time of day</option>
            </select>
          </label>
          {layer.clockShows === "until" && (
            <label className="flex items-center justify-between gap-2">
              <span>Count down to</span>
              <input type="time" aria-label="Count down to" value={layer.until ?? ""} onChange={(e) => onChange({ until: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-transparent px-2" />
            </label>
          )}
          <p className="text-muted-foreground">{layer.clockShows === "time" ? "This computer's time of day." : layer.clockShows === "until" ? "Counts down to that time today, then stays at 0:00." : "A countdown or the time so far, as Present's timer runs. It stops at 0:00 on the screens."}</p>
          <label className="flex flex-col gap-0.5">
            <span className="text-[0.625rem] text-muted-foreground">Look (from Design)</span>
            <select aria-label="Clock look" value={layer.themeId ?? ""} onChange={(e) => onChange({ themeId: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-card px-1.5">
              <option value="">{target ? `${target.name}'s look` : "The output's look"}</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </>
      )}
      {layer.kind === "camera" && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.625rem] text-muted-foreground">Stream address (WHEP)</span>
          <input aria-label="Camera stream address" value={layer.cameraUrl ?? ""} placeholder="http://192.168.1.10:8889/pulpit/whep" onChange={(e) => onChange({ cameraUrl: e.target.value.trim() || undefined })} className="h-8 rounded-md border border-input bg-transparent px-2" />
          <span className="text-muted-foreground">A camera relayed on the church network (MediaMTX: http://&lt;its computer&gt;:8889/&lt;camera&gt;/whep). Each screen plays it directly, without sound; until it connects the scene's background shows there. Only addresses on the church network are used.</span>
        </label>
      )}
      {layer.kind === "camera" && (
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.625rem] text-muted-foreground">While the camera is not playing, show</span>
          <input aria-label="Words while the camera is not playing" value={layer.cameraFallback ?? ""} maxLength={120} placeholder="the scene's background (e.g. type: Camera back shortly)" onChange={(e) => onChange({ cameraFallback: e.target.value || undefined })} className="h-8 rounded-md border border-input bg-transparent px-2" />
        </label>
      )}
      <div className="grid grid-cols-4 gap-1.5">
        <Num label="Left %" value={b.x} max={100 - b.w} onChange={(x) => onChange({ box: { ...b, x } })} />
        <Num label="Top %" value={b.y} max={100 - b.h} onChange={(y) => onChange({ box: { ...b, y } })} />
        <Num label="Width %" value={b.w} min={1} max={100 - b.x} onChange={(w) => onChange({ box: { ...b, w } })} />
        <Num label="Height %" value={b.h} min={1} max={100 - b.y} onChange={(h) => onChange({ box: { ...b, h } })} />
      </div>
      {layer.kind !== "color" && (
        <div className="grid grid-cols-4 gap-1.5">
          <Num label="Crop left" value={crop.l} max={90 - crop.r} onChange={(l) => onChange({ crop: { ...crop, l } })} />
          <Num label="Crop top" value={crop.t} max={90 - crop.b} onChange={(t) => onChange({ crop: { ...crop, t } })} />
          <Num label="Crop right" value={crop.r} max={90 - crop.l} onChange={(r) => onChange({ crop: { ...crop, r } })} />
          <Num label="Crop bottom" value={crop.b} max={90 - crop.t} onChange={(bb) => onChange({ crop: { ...crop, b: bb } })} />
        </div>
      )}
      <label className="flex items-center gap-2">
        <span className="w-16 shrink-0">Opacity</span>
        <input type="range" aria-label="Opacity" min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} className="flex-1" />
        <span className="w-9 text-right tabular-nums">{Math.round(layer.opacity * 100)}%</span>
      </label>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="outline" onClick={() => onChange({ box: { x: 0, y: 0, w: 100, h: 100 }, crop: undefined })}>Fill the frame</Button>
        <ConfirmDelete label={`Remove ${layer.name}`} verb="Remove" onConfirm={onRemove} />
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted")}>{children}</button>
}

/** The program of one congregation output: which scene it shows, Take, back to its own feed, Restore. */
function ProgramBar({ congregation, target, onTarget, draft, dirty, onSave, onTake }: { congregation: BroadcastOutput[]; target: BroadcastOutput | undefined; onTarget: (id: string) => void; draft: Scene | null; dirty: boolean; onSave: () => void; onTake: () => void }) {
  const scenes = useBroadcastStore((s) => s.scenes)
  const back = useBroadcastStore((s) => (target ? s.sceneReturn[target.id] : undefined))
  const showing = target?.sceneId ? scenes.find((s) => s.id === target.sceneId) : undefined
  const restorable = !showing && back ? scenes.find((s) => s.id === back) : undefined
  if (!target) return <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">Add a congregation output (Production → Screens) to take a scene to it.</p>
  return (
    <section aria-label="Program" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-[#16242b] p-3 text-xs text-[#d6e2df]">
      <span className="text-[0.625rem] font-bold tracking-[0.1em] text-[#9fb2b0] uppercase">Program</span>
      <select aria-label="Congregation output" value={target.id} onChange={(e) => onTarget(e.target.value)} className="h-8 rounded-md border border-[#34504b] bg-[#1b3033] px-1.5 text-[#e9f1ed]">
        {congregation.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <span className="min-w-0 flex-1 truncate">{showing ? <>Shows <strong>{showing.name}</strong></> : "Shows its own feed, full screen"}</span>
      {draft && dirty && <Button size="sm" variant="outline" onClick={onSave} className="border-[#34504b] bg-transparent text-[#e9f1ed] hover:bg-[#1b3033]"><SaveIcon /> Save scene</Button>}
      {draft && <Button size="sm" onClick={onTake} className="bg-live-pulse text-white hover:bg-live-pulse/90" title={`Put ${draft.name} on ${target.name}${dirty ? " (saves it first)" : ""}`}>Take {draft.name}</Button>}
      {showing && <Button size="sm" variant="outline" onClick={() => useBroadcastStore.getState().releaseScene(target.id)} className="border-[#34504b] bg-transparent text-[#e9f1ed] hover:bg-[#1b3033]">Back to its own feed</Button>}
      {restorable && <Button size="sm" variant="outline" onClick={() => useBroadcastStore.getState().takeScene(target.id, restorable.id)} className="border-[#34504b] bg-transparent text-[#e9f1ed] hover:bg-[#1b3033]"><UndoIcon /> Restore {restorable.name}</Button>}
    </section>
  )
}
