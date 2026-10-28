import { useEffect, useMemo, useRef, useState } from "react"
import { LayersIcon, PencilIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { CONTENT_NAMES } from "@/lib/content-names"
import { drawScene } from "@/lib/scene-renderer"
import { newScene, sceneFrame } from "@/lib/scenes"
import { BASIC_PLACES, basicOf, NEW_BASIC, withBasic, type BasicPlace, type BasicScene } from "@/lib/basic-scene"
import { loadThemeImage, themeImageCache } from "@/lib/theme-image-cache"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useMediaStore } from "@/stores/media-store"
import { useSettingsStore } from "@/stores/settings-store"
import { cameraLabelOf } from "@/lib/cameras"
import { CameraPicker, NoSignalChoice, VideoPicker } from "@/studio/production/scene-composer"
import { openProductionTab } from "@/studio/production/production-tab"
import { CONTENT_TYPES, type ContentType } from "@/types/broadcast"
import type { BroadcastOutput, Scene, SceneLayer } from "@/types"

/**
 * New scene / Edit scene from Present (#243 SC.18): a basic scene (a background, one content box,
 * the lower third and a camera) made or changed without leaving the live console. Nothing goes on
 * air until Take scene; saving a scene a screen shows changes that screen. The full composer is in
 * Production → Scenes.
 */
export function SceneSheetButton({ output, scene }: { output: BroadcastOutput; scene: Scene | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={scene ? `Change ${scene.name}: its background, content box, lower third and camera` : "Make a basic scene without leaving Present"}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5"
      >
        {scene ? <PencilIcon /> : <PlusIcon />}
        {scene ? "Edit scene" : "New scene"}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {open && <SceneSheetBody key={scene?.id ?? "new"} output={output} scene={scene} onDone={() => setOpen(false)} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

const FOLLOWS: { id: string; name: string; shows?: ContentType[] }[] = [
  { id: "air", name: "Whatever is on air" },
  ...CONTENT_TYPES.map((k) => ({ id: k, name: CONTENT_NAMES[k], shows: [k] })),
]

const followsId = (shows: ContentType[] | undefined) => (!shows?.length ? "air" : shows.length === 1 ? shows[0] : "mixed")

/** A stand-in layer, so the composer's own camera and video pickers can be used here. */
const pseudo = (kind: SceneLayer["kind"], patch: Partial<SceneLayer>): SceneLayer => ({ id: `sheet-${kind}`, name: kind === "camera" ? "Camera" : "Video", kind, box: { x: 0, y: 0, w: 100, h: 100 }, opacity: 1, visible: true, ...patch })

function SceneSheetBody({ output, scene, onDone }: { output: BroadcastOutput; scene: Scene | null; onDone: () => void }) {
  const [b, setB] = useState<BasicScene>(() => (scene ? basicOf(scene) : { ...NEW_BASIC }))
  const assets = useMediaStore((s) => s.assets)
  const outputs = useBroadcastStore((s) => s.outputs)
  const onScreens = scene ? outputs.filter((o) => o.sceneId === scene.id).map((o) => o.name) : []
  useEffect(() => {
    if (assets.length === 0) void useMediaStore.getState().list().catch(() => [])
  }, [assets.length])
  const set = (patch: Partial<BasicScene>) => setB((x) => ({ ...x, ...patch }))
  // A new scene keeps one id while it is being made.
  const [fresh] = useState(() => ({ ...newScene("New scene"), layers: [] }))
  const draft = useMemo(() => withBasic(scene ?? fresh, b), [scene, fresh, b])
  const save = (): Scene => {
    useBroadcastStore.getState().saveScene(draft)
    return draft
  }
  const bg = b.background
  const pictures = assets.filter((a) => a.kind === "image" && a.present !== false)
  const label = "text-xs font-semibold text-muted-foreground"
  const select = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm"

  return (
    <form className="flex min-h-full flex-col" onSubmit={(e) => { e.preventDefault(); save(); onDone() }}>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2"><LayersIcon className="size-4" /> {scene ? `Edit ${scene.name}` : "New scene"}</SheetTitle>
        <SheetDescription>A basic arrangement for the congregation screens. Saving puts nothing on air: use Take scene for that.</SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-4 text-sm">
        <SheetPreview scene={draft} output={output} />
        <label className="flex flex-col gap-1">
          <span className={label}>Name</span>
          <input aria-label="Scene name" required value={b.name} maxLength={80} placeholder="e.g. Sermon with camera" onChange={(e) => set({ name: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2" />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className={cn(label, "mb-1")}>Background</legend>
          <select aria-label="Background" value={bg.kind} onChange={(e) => {
            const k = e.target.value as BasicScene["background"]["kind"]
            set({ background: k === "colour" ? { kind: "colour", color: "#000000" } : k === "transparent" ? { kind: "transparent" } : { kind: k } })
          }} className={select}>
            <option value="colour">A colour</option>
            <option value="transparent">Transparent (for keying)</option>
            <option value="picture">A picture from the Library</option>
            <option value="video">A video from the Library (loops, no sound)</option>
          </select>
          {bg.kind === "colour" && <input type="color" aria-label="Background colour" value={bg.color} onChange={(e) => set({ background: { kind: "colour", color: e.target.value } })} className="h-8 w-12 rounded border border-border bg-transparent p-0.5" />}
          {bg.kind === "picture" && (
            <select aria-label="Background picture" value={bg.mediaId ?? ""} onChange={async (e) => {
              const id = e.target.value
              const url = id ? await useMediaStore.getState().dataUrl(id).catch(() => null) : null
              set({ background: { kind: "picture", mediaId: id || undefined, imageUrl: url ?? undefined } })
            }} className={select}>
              <option value="">Choose a picture…</option>
              {pictures.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {bg.kind === "video" && <VideoPicker layer={pseudo("video", { mediaId: bg.mediaId, videoUrl: bg.videoUrl, mediaFile: bg.mediaFile })} onChange={(p) => set({ background: { kind: "video", mediaId: p.mediaId, videoUrl: p.videoUrl, mediaFile: p.mediaFile } })} />}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className={cn(label, "mb-1")}>Content box</legend>
          <select aria-label="What the content box shows" value={b.content ? followsId(b.content.shows) : "none"} onChange={(e) => {
            const v = e.target.value
            if (v === "none") return set({ content: null })
            if (v === "mixed") return
            set({ content: { place: b.content?.place ?? "full", shows: FOLLOWS.find((f) => f.id === v)?.shows } })
          }} className={select}>
            <option value="none">No content box</option>
            {FOLLOWS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            {b.content && followsId(b.content.shows) === "mixed" && <option value="mixed">{b.content.shows!.map((k) => CONTENT_NAMES[k]).join(" + ")}</option>}
          </select>
          {b.content && (
            <select aria-label="Where the content box goes" value={b.content.place} onChange={(e) => set({ content: { ...b.content!, place: e.target.value as BasicPlace } })} className={select}>
              {(Object.keys(BASIC_PLACES) as Exclude<BasicPlace, "custom">[]).map((k) => <option key={k} value={k}>{BASIC_PLACES[k].name}</option>)}
              {b.content.place === "custom" && <option value="custom">Where it is now (arranged in the composer)</option>}
            </select>
          )}
          <span className="text-xs text-muted-foreground">In {output.name}'s looks; the words come from what is live.</span>
        </fieldset>

        <label className="flex items-start gap-2">
          <input type="checkbox" checked={b.lowerThird} onChange={(e) => set({ lowerThird: e.target.checked })} className="mt-0.5" />
          <span>
            <span className="block font-medium">Lower third</span>
            <span className="block text-xs text-muted-foreground">Names and titles from Present → Lower third, shown in this scene.</span>
          </span>
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={b.camera !== null} onChange={(e) => set({ camera: e.target.checked ? "" : null })} className="mt-0.5" />
            <span>
              <span className="block font-medium">Camera</span>
              <span className="block text-xs text-muted-foreground">Full screen, over the background and under the words.</span>
            </span>
          </label>
          {b.camera !== null && <CameraPicker layer={pseudo("camera", { cameraUrl: b.camera || undefined })} onChange={(p) => { if ("cameraUrl" in p) set({ camera: p.cameraUrl ?? "" }) }} />}
          {b.camera !== null && <NoSignalChoice layer={b.cameraWhenOff ?? {}} onChange={(p) => set({ cameraWhenOff: { ...b.cameraWhenOff, ...p } })} className="h-9" />}
        </fieldset>

        {onScreens.length > 0 && <p className="rounded-md border border-gold/60 bg-tone-amber px-2.5 py-1.5 text-xs text-tone-amber-foreground">{scene?.name} is on {onScreens.join(", ")} now: saving changes {onScreens.length === 1 ? "that screen" : "those screens"} at once.</p>}
      </div>
      <SheetFooter className="flex-row flex-wrap justify-end">
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="button" variant="outline" disabled={!b.name.trim()} title="Save, then arrange it in Production → Scenes" onClick={() => { const s = save(); onDone(); openProductionTab("programs", { sceneId: s.id }) }}>Open in the composer</Button>
        <Button type="submit" disabled={!b.name.trim()}>Save scene</Button>
      </SheetFooter>
    </form>
  )
}

const PREVIEW_W = 320
const PREVIEW_H = 180

/** The scene as this screen would draw it now. */
function SheetPreview({ scene, output }: { scene: Scene; output: BroadcastOutput }) {
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const sources = useBroadcastStore((s) => s.sources)
  const themes = useBroadcastStore((s) => s.themes)
  const cameras = useSettingsStore((s) => s.cameras)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layers = useRef(new Map<string, HTMLCanvasElement>())
  const [, redraw] = useState(0)
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    drawScene(ctx, PREVIEW_W, PREVIEW_H, sceneFrame({ isLive, liveVerse, sources, themes, cameraLabel: (url) => cameraLabelOf(url, cameras) }, output, scene, true), {
      preview: true,
      imageCache: themeImageCache(),
      layerCanvas: (id) => {
        let c = layers.current.get(id)
        if (!c) layers.current.set(id, (c = document.createElement("canvas")))
        return c
      },
      image: (url) => {
        const img = themeImageCache().get(url)
        if (!img) void loadThemeImage(url).then((ok) => ok && redraw((n) => n + 1))
        return img ?? null
      },
    })
  })
  return <canvas ref={canvasRef} width={PREVIEW_W} height={PREVIEW_H} role="img" aria-label={`Preview of ${scene.name}`} className="aspect-video w-full rounded-md bg-[repeating-conic-gradient(#2a3338_0%_25%,#20282c_0%_50%)] bg-[length:12px_12px]" />
}
