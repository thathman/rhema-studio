import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, CircleIcon, CopyIcon, EyeIcon, EyeOffIcon, MoveRightIcon, PlusIcon, QrCodeIcon, Redo2Icon, SaveIcon, SquareIcon, StarIcon, TextIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { designStore, type DesignDocument, type DesignInput, type DesignVersion } from "@/design-engine/design-store"
import { designPages, designToScene, outputCoverPictures, previewDesign, type LivePreviewInput, type RhemaBinding, type RhemaDesignPage, VIDEO_LAYER_PLACEHOLDER_COLOR } from "@/design-engine/rhema-scene"
import { createCameraLayer, createClockLayer, createColorLayer, createLiveFeedLayer, createLogoLayer, createLowerThirdLayer, createTickerLayer } from "@/design-engine/design-document-utils"
import { applyCommand, createSaraswatiEditorStore, getNodeBounds, pointerDown, pointerMove, pointerUp, type SaraswatiClipPath, type SaraswatiCommand, type SaraswatiImageNode, type SaraswatiPointerState } from "@/vendor/avnac/saraswati"
import { renderSceneToCanvas } from "@/vendor/avnac/renderer/offscreen-render"
import type { SaraswatiColor, SaraswatiEllipseNode, SaraswatiGroupNode, SaraswatiLineNode, SaraswatiNode, SaraswatiPolygonNode, SaraswatiRectNode, SaraswatiRenderableNode, SaraswatiScene, SaraswatiTextNode } from "@/vendor/avnac/saraswati"
import { cn } from "@/lib/utils"
import { CONTENT_NAMES } from "@/lib/content-names"
import { CONTENT_TYPES, type ContentType } from "@/types/broadcast"
import type { BroadcastOutputLanguage } from "@/types/broadcast-output"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { gradientCss, normalizeGradient } from "@/lib/scene-gradient"
import { layerRotation, layerTurns } from "@/lib/scene-rotation"
import { monotonicNow, useTimerStore } from "@/stores/timer-store"
import { clockText, countdownClock, sceneClock, untilClock } from "@/lib/scenes"
import { crawlElapsed, pageIndex, tickerText } from "@/lib/ticker"
import { useMediaStore } from "@/stores/media-store"
import { cameraOfUrl, useRouterHealth, whepUrl } from "@/lib/cameras"
import type { MediaAssetStatus } from "@/types"
import { CountdownSelect } from "@/studio/production/countdown-select"
import { qrDataUrl, safeLink } from "@/lib/qr-bulletin"

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error && "message" in error) return String(error.message)
  return String(error)
}

function isRevisionConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "kind" in error && error.kind === "conflict"
}

function renderable(node: SaraswatiNode | undefined): node is SaraswatiRenderableNode {
  return !!node && node.type !== "group"
}

function paintNode(node: SaraswatiRenderableNode): node is Extract<SaraswatiRenderableNode, { type: "rect" | "ellipse" | "polygon" }> {
  return node.type === "rect" || node.type === "ellipse" || node.type === "polygon"
}

function layerIds(scene: SaraswatiScene, rootId = scene.root): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    const node = scene.nodes[id]
    if (!node) return
    if (node.type === "group") node.children.forEach(walk)
    else out.push(id)
  }
  walk(rootId)
  return out
}

function stableId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

type BindingSnapshot = Record<string, RhemaBinding>

function bindingSnapshot(bindings: Record<string, RhemaBinding>): BindingSnapshot {
  return { ...bindings }
}

function fullImageEllipseClip(node: Pick<SaraswatiImageNode, "width" | "height">): SaraswatiClipPath {
  return { type: "ellipse", x: node.width / 2, y: node.height / 2, width: node.width, height: node.height }
}

function hasFullImageEllipse(node: SaraswatiImageNode): boolean {
  const clip = node.clipPath
  return !node.clipPathStack?.length && clip?.type === "ellipse" &&
    clip.x === node.width / 2 && clip.y === node.height / 2 &&
    clip.width === node.width && clip.height === node.height
}

function imageMaskChoice(node: SaraswatiImageNode): "none" | "ellipse" | "custom" {
  const clips = [...(node.clipPathStack ?? []), ...(node.clipPath ? [node.clipPath] : [])]
  if (!clips.length) return "none"
  return clips.length === 1 && hasFullImageEllipse({ ...node, clipPath: clips[0]!, clipPathStack: undefined }) ? "ellipse" : "custom"
}

function moveValue(node: SaraswatiRenderableNode, field: "x" | "y" | "width" | "height", value: number): SaraswatiRenderableNode {
  if (!Number.isFinite(value)) return node
  if (field === "x" || field === "y") return { ...node, [field]: value }
  if (!("width" in node)) return node
  if (node.type === "image" && hasFullImageEllipse(node)) {
    const resized = { ...node, [field]: Math.max(1, value) }
    return { ...resized, clipPath: fullImageEllipseClip(resized), clipPathStack: undefined }
  }
  const resized = { ...node, [field]: Math.max(1, value) }
  return resized
}

function NumberField({ label, value, min, max, disabled, onCommit }: {
  label: string
  value: number
  min?: number
  max?: number
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const commit = (raw: string) => {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) onCommit(Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? -Number.MAX_SAFE_INTEGER, parsed)))
  }
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">
      {label}
      <Input key={label + ":" + value} type="number" min={min} max={max} defaultValue={String(Math.round(value))} disabled={disabled} onBlur={(event) => commit(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} className="h-8 text-xs text-foreground" />
    </label>
  )
}

function GradientColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => boolean }) {
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const commit = () => {
    const next = draft.trim()
    const accepted = onCommit(next)
    setInvalid(!accepted)
    if (accepted) setDraft(next)
  }
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">
      {label}
      <Input value={draft} maxLength={48} aria-label={label} aria-invalid={invalid} onChange={(event) => setDraft(event.currentTarget.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} className="h-8 text-xs text-foreground" />
      {invalid && <span role="alert" className="font-normal text-destructive">Enter a supported hex or RGB colour.</span>}
    </label>
  )
}

function paintGradient(angle: number, stops: Array<{ color: string; offset: number }>): SaraswatiColor | undefined {
  const normalized = normalizeGradient({ angle, stops })
  if (!normalized) return undefined
  return { type: "gradient", css: gradientCss(normalized), stops: normalized.stops, angle: normalized.angle }
}

function PaintControls({ label, paint, accentColor, onChange }: {
  label: string
  paint: SaraswatiColor
  accentColor: string
  onChange: (paint: SaraswatiColor) => void
}) {
  const changeGradient = (angle: number, stops = paint.type === "gradient" ? paint.stops : []) => {
    const next = paintGradient(angle, stops)
    if (!next) return false
    onChange(next)
    return true
  }
  const changeStop = (index: number, color: string) => {
    if (paint.type !== "gradient") return false
    const stops = paint.stops.map((stop, stopIndex) => stopIndex === index ? { ...stop, color } : stop)
    return changeGradient(paint.angle, stops)
  }
  const setStyle = (style: string) => {
    if (style === "solid") {
      if (paint.type === "gradient") onChange({ type: "solid", color: paint.stops[0]?.color ?? "#111827" })
      return
    }
    if (style === "gradient" && paint.type === "solid") {
      const secondColor = paint.color.toLowerCase() === accentColor.toLowerCase() ? "#ffffff" : accentColor
      changeGradient(90, [{ color: paint.color, offset: 0 }, { color: secondColor, offset: 1 }])
    }
  }
  const solidPickerCompatible = paint.type === "solid" && /^#[0-9a-f]{6}$/i.test(paint.color)

  return (
    <section className="space-y-2 rounded-md border border-border p-2" aria-label={`${label} paint controls`}>
      <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">
        {label} style
        <select aria-label={`${label} paint style`} value={paint.type} onChange={(event) => setStyle(event.currentTarget.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
          <option value="solid">Solid colour</option>
          <option value="gradient">Linear gradient</option>
        </select>
      </label>
      {paint.type === "solid" ? (
        solidPickerCompatible
          ? <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Solid colour
              <Input aria-label={`${label} solid colour`} type="color" value={paint.color} onChange={(event) => onChange({ type: "solid", color: event.currentTarget.value })} className="h-8 w-14 p-1" />
            </label>
          : <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Solid colour
              <Input aria-label={`${label} solid colour`} value={paint.color} onChange={(event) => onChange({ type: "solid", color: event.currentTarget.value })} className="h-8 text-xs text-foreground" />
            </label>
      ) : (
        <>
          <NumberField label={`${label} gradient angle (deg)`} min={0} max={360} value={paint.angle} onCommit={(angle) => changeGradient(Math.min(360, Math.max(0, Math.round(angle))))} />
          <div className="grid grid-cols-2 gap-2">
            <GradientColorField key={`${label}:start:${paint.stops[0]?.color}`} label={`${label} gradient start colour`} value={paint.stops[0]?.color ?? "#111827"} onCommit={(color) => changeStop(0, color)} />
            <GradientColorField key={`${label}:end:${paint.stops.at(-1)?.color}`} label={`${label} gradient end colour`} value={paint.stops.at(-1)?.color ?? "#ffffff"} onCommit={(color) => changeStop(paint.stops.length - 1, color)} />
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">Intermediate stops stay in place when you edit the end colours.</p>
        </>
      )}
    </section>
  )
}

/** Canvas editor for Rhema-supported scene layers. Unsupported Avnac edits stay visible as issues. */
export function DesignDocumentEditor({
  document,
  onSaved,
  onReopen,
  onVersionCreated,
  onDuplicate,
  onDirtyChange,
}: {
  document: DesignDocument
  onSaved: (document: DesignDocument) => void
  onReopen: () => Promise<void>
  onVersionCreated: (version: DesignVersion) => void
  onDuplicate: () => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [base, setBase] = useState(document)
  const [title, setTitle] = useState(document.title)
  const [editor] = useState(() => createSaraswatiEditorStore(document.document.scene))
  const [scene, setScene] = useState(() => editor.getState().scene)
  const [pageMetadata, setPageMetadata] = useState(() => new Map<string, RhemaDesignPage>(designPages(document.document).map((page) => [page.nodeId, page])))
  const initialPages = Array.isArray(document.document.pages) ? document.document.pages : []
  const pageNodeIds = useRef(new Set(initialPages.map((page) => page.nodeId)))
  const [hasExplicitPages, setHasExplicitPages] = useState(initialPages.length > 0)
  const [activePageId, setActivePageId] = useState(initialPages[0]?.id ?? document.document.scene.root)
  const [bindings, setBindingsState] = useState(document.document.bindings)
  const bindingsRef = useRef(bindings)
  const setBindings = (update: Record<string, RhemaBinding> | ((current: Record<string, RhemaBinding>) => Record<string, RhemaBinding>)) => {
    const next = typeof update === "function" ? update(bindingsRef.current) : update
    bindingsRef.current = next
    setBindingsState(next)
  }
  const bindingSnapshots = useRef(new WeakMap<SaraswatiScene, BindingSnapshot>())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [versions, setVersions] = useState<DesignVersion[]>([])
  const [versionNote, setVersionNote] = useState("")
  const [conflicted, setConflicted] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState("")
  const [liveValuesPreview, setLiveValuesPreview] = useState(false)
  const [previewClockNow, setPreviewClockNow] = useState(() => Date.now())
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const [cameraPickerOpen, setCameraPickerOpen] = useState(false)
  const [qrFormOpen, setQrFormOpen] = useState(false)
  const [qrLink, setQrLink] = useState("")
  const [qrMessage, setQrMessage] = useState("")
  const [mediaPickerKind, setMediaPickerKind] = useState<"image" | "video">("image")
  const [imagePickerBusy, setImagePickerBusy] = useState(false)
  const [imagePickerMessage, setImagePickerMessage] = useState("")
  const [editorFlags, setEditorFlags] = useState({ canUndo: false, canRedo: false })
  const operatorName = useSettingsStore((state) => state.operatorName)
  const brandKit = useSettingsStore((state) => state.brandKit)
  const brandKitLogoUrl = useSettingsStore((state) => liveValuesPreview ? state.brandKit.logoUrl : null)
  const isLive = useBroadcastStore((state) => liveValuesPreview ? state.isLive : false)
  const liveVerse = useBroadcastStore((state) => liveValuesPreview ? state.liveVerse : null)
  const liveSources = useBroadcastStore((state) => liveValuesPreview ? state.sources : null)
  const stateSources = useBroadcastStore((state) => liveValuesPreview ? state.stateSources : null)
  const ticker = useBroadcastStore((state) => liveValuesPreview ? state.ticker : null)
  const lowerThird = useBroadcastStore((state) => liveValuesPreview ? state.lowerThird : null)
  const countdowns = useBroadcastStore((state) => liveValuesPreview ? state.countdowns : null)
  const serviceTimer = useTimerStore((state) => liveValuesPreview ? state.timer : null)
  useTimerStore((state) => liveValuesPreview ? state.tick : 0)
  const cameras = useSettingsStore((state) => state.cameras)
  const routerStatus = useRouterHealth((state) => state.status)
  const cameraRouterReady = !!routerStatus?.running && !!routerStatus.lanAddress
  const mediaAssets = useMediaStore((state) => state.assets)
  const mediaLoaded = useMediaStore((state) => state.loaded)
  const mediaError = useMediaStore((state) => state.error)
  const libraryPictures = useMemo(
    () => mediaAssets.filter((asset) => asset.kind === "image" && asset.present),
    [mediaAssets],
  )
  const libraryVideos = useMemo(
    () => mediaAssets.filter((asset) => asset.kind === "video" && asset.present),
    [mediaAssets],
  )
  const pointerRef = useRef<SaraswatiPointerState | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (Object.values(bindings).some((binding) => binding.kind === "video") && !mediaLoaded) {
      void useMediaStore.getState().list()
    }
  }, [bindings, mediaLoaded])
  useEffect(() => {
    return editor.subscribe((next) => {
      setScene(next.scene)
      setEditorFlags({ canUndo: next.canUndo, canRedo: next.canRedo })
      const rootNode = next.scene.nodes[next.scene.root]
      const explicit = rootNode?.type === "group" && rootNode.children.length > 0 && rootNode.children.every((id) => {
        const node = next.scene.nodes[id]
        return pageNodeIds.current.has(id) && node?.type === "group"
      })
      setHasExplicitPages((current) => {
        if (explicit) return true
        return Array.isArray(document.document.pages) && document.document.pages.length ? current : false
      })
      const snapshot = bindingSnapshots.current.get(next.scene)
      if (snapshot) setBindings(snapshot)
    })
  }, [editor, document.document.pages])

  const pageRoot = scene.nodes[scene.root]
  const pages = useMemo<RhemaDesignPage[]>(() => {
    if (hasExplicitPages && pageRoot?.type === "group") {
      const resolved = pageRoot.children.flatMap((nodeId) => {
        const node = scene.nodes[nodeId]
        const saved = pageMetadata.get(nodeId)
        if (!saved || node?.type !== "group") return []
        return [{ ...saved, title: node.name?.trim() || saved.title }]
      })
      if (resolved.length) return resolved
    }
    return [{ id: scene.root, nodeId: scene.root, title: "Page 1" }]
  }, [hasExplicitPages, pageMetadata, pageRoot, scene])
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0]!
  const activeRootId = activePage.nodeId
  const pageScene = useMemo<SaraswatiScene>(
    () => activeRootId === scene.root ? scene : { ...scene, root: activeRootId },
    [activeRootId, scene],
  )
  const orderedIds = useMemo(() => layerIds(scene, activeRootId), [scene, activeRootId])
  const pagesForDocument = hasExplicitPages ? pages : undefined
  const designForEditor = useMemo(() => {
    return { ...document.document, pages: pagesForDocument, scene, bindings }
  }, [document.document, pagesForDocument, scene, bindings])
  useEffect(() => {
    if (!liveValuesPreview) return
    const interval = window.setInterval(() => setPreviewClockNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [liveValuesPreview])
  const livePreviewInput = useMemo<LivePreviewInput | null>(() => {
    if (!liveValuesPreview) return null
    const now = previewClockNow
    const timerClock = serviceTimer ? sceneClock(serviceTimer, monotonicNow(), now) : null
    const sources: LivePreviewInput["sources"] = Object.entries(liveSources ?? {}).flatMap(([id, value]) => value ? [{
      id,
      reference: value.value.reference || value.value.lines?.filter(Boolean).join(" · ") || "Live content",
      on: value.on,
      revision: value.revision,
    }] : [])
    const tickerWords = ticker?.style.motion === "pages"
      ? (() => {
        const items = ticker.items.map((item) => item.trim()).filter(Boolean)
        const index = pageIndex(ticker.items, ticker.style.pageSeconds, crawlElapsed(ticker, now))
        return index >= 0 ? items[index] ?? "" : ""
      })()
      : ticker ? tickerText(ticker.items, ticker.style.separator) : ""
    sources.push({ id: "ticker", reference: tickerWords, on: !!ticker })
    sources.push({
      id: "lowerThird",
      reference: [lowerThird?.line1, lowerThird?.line2].map((line) => line?.trim()).filter(Boolean).join("\n"),
      on: !!lowerThird,
    })
    for (const [id, source] of Object.entries(stateSources ?? {})) {
      if (!id.startsWith("camera:") || !source) continue
      sources.push({
        id,
        reference: id.slice("camera:".length),
        on: source.on,
        state: source?.hold ? "frozen" : source?.backup ? "backup" : source?.on ? "sending" : "off",
      })
    }
    const until: Record<string, string | null> = {}
    const countdown: NonNullable<LivePreviewInput["clockValues"]>["countdown"] = {}
    for (const binding of Object.values(bindings)) {
      if (binding.kind !== "clock") continue
      if (binding.clockShows === "until" && binding.until) {
        const clock = untilClock(binding.until, now)
        until[binding.until] = clock ? clockText(clock, now) : null
      }
      if (binding.clockShows === "countdown") {
        const target = binding.countdownTo ?? "next"
        const clock = countdownClock(countdowns ?? null, target)
        countdown[target] = clock ? clockText(clock, now) : null
      }
    }
    const time = clockText({ mode: "time", at: 0, text: "" }, now)
    const timer = timerClock ? clockText(timerClock, now) : null
    sources.push({ id: "timer", reference: timer ?? "Service timer not started", on: timer !== null })
    return {
      program: { onAir: isLive, reference: liveVerse?.reference || liveVerse?.lines?.[0] || null },
      sources,
      clockValues: { timer, time, until, countdown },
      logoUrl: brandKitLogoUrl,
    }
  }, [bindings, brandKitLogoUrl, countdowns, isLive, liveSources, liveValuesPreview, lowerThird, liveVerse, previewClockNow, serviceTimer, stateSources, ticker])
  const canvasPreviewScene = useMemo(
    () => liveValuesPreview && livePreviewInput ? previewDesign({ ...designForEditor, scene: pageScene }, livePreviewInput) : pageScene,
    [designForEditor, livePreviewInput, liveValuesPreview, pageScene],
  )
  // Keep bindings in editor state so Undo/Redo can restore deleted nodes with their Rhema data.
  // Orphaned bindings are removed only from the document sent to storage.
  const savedBindings = Object.fromEntries(
    Object.entries(bindings).filter(([id]) => layerIds(scene).includes(id)),
  )
  const selectedNode = selectedId ? scene.nodes[selectedId] : undefined
  const selectedRenderable = renderable(selectedNode) ? selectedNode : undefined
  const selectedBinding = selectedRenderable ? bindings[selectedRenderable.id] : undefined
  const selectedCameraName = selectedBinding?.kind === "camera" ? cameraOfUrl(selectedBinding.cameraUrl, cameras) : null
  const selectedPaintNode = selectedRenderable && selectedBinding?.kind !== "video" && paintNode(selectedRenderable) ? selectedRenderable : undefined
  const selectedVideoAsset = selectedBinding?.kind === "video"
    ? mediaAssets.find((asset) => asset.id === selectedBinding.mediaId)
    : undefined
  const selectedVideoMissing = selectedBinding?.kind === "video" && mediaLoaded && !mediaError && !selectedVideoAsset?.present
  const selectedPictureAsset = selectedBinding?.kind === "picture"
    ? mediaAssets.find((asset) => asset.id === selectedBinding.mediaId)
    : undefined
  const pictureSourceWidth = selectedPictureAsset?.width && selectedPictureAsset.width > 0 ? selectedPictureAsset.width : null
  const pictureSourceHeight = selectedPictureAsset?.height && selectedPictureAsset.height > 0 ? selectedPictureAsset.height : null
  const selectedPictureHasSceneCrop = selectedBinding?.kind === "picture" && !!selectedBinding.crop &&
    !selectedBinding.imageDraw &&
    !!(selectedBinding.crop.l || selectedBinding.crop.t || selectedBinding.crop.r || selectedBinding.crop.b)
  const issues = useMemo(() => designToScene({
    ...designForEditor,
    meta: { ...document.document.meta, name: title },
  }, activePage.id).issues, [designForEditor, document.document.meta, title, activePage.id])
  const dirty = title !== base.title ||
    JSON.stringify(scene) !== JSON.stringify(base.document.scene) ||
    JSON.stringify(savedBindings) !== JSON.stringify(base.document.bindings) ||
    JSON.stringify(pagesForDocument) !== JSON.stringify(base.document.pages)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    let cancelled = false
    const draw = async () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext("2d")
      if (!canvas || !ctx) return
      const rendered = await renderSceneToCanvas(canvasPreviewScene, { multiplier: 1, imageCover: outputCoverPictures({ scene: canvasPreviewScene, bindings }) })
      if (cancelled || !rendered) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(rendered, 0, 0, canvas.width, canvas.height)
      if (selectedId) {
        const selected = pageScene.nodes[selectedId]
        if (renderable(selected)) {
          const box = getNodeBounds(selected)
          ctx.save()
          ctx.strokeStyle = "#60a5fa"
          ctx.lineWidth = 4
          ctx.setLineDash([12, 8])
          ctx.strokeRect(box.x, box.y, box.width, box.height)
          ctx.restore()
        }
      }
    }
    void draw().catch(() => setMessage("The editor preview could not be drawn. Your document remains available to edit and save."))
    return () => { cancelled = true }
  }, [bindings, canvasPreviewScene, pageScene, selectedId])

  useEffect(() => {
    void designStore.listVersions(document.id).then(setVersions).catch(() => setVersions([]))
  }, [document.id, document.latestVersion])

  const dispatch = (command: SaraswatiCommand) => {
    editor.dispatch(command)
  }
  const editSceneWithBindings = (
    editScene: () => void,
    updateBindings: (current: Record<string, RhemaBinding>) => Record<string, RhemaBinding>,
  ) => {
    const sceneBefore = editor.getState().scene
    bindingSnapshots.current.set(sceneBefore, bindingSnapshot(bindingsRef.current))
    editScene()
    const nextBindings = updateBindings(bindingsRef.current)
    setBindings(nextBindings)
    bindingSnapshots.current.set(editor.getState().scene, bindingSnapshot(nextBindings))
  }
  const applyBrandTextFont = (fontFamily: string) => {
    if (selectedRenderable?.type !== "text" || document.kind === "template") return
    dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontFamily })
  }
  const applyBrandTextColor = (color: string) => {
    if (selectedRenderable?.type !== "text" || document.kind === "template") return
    dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, color: { type: "solid", color } })
  }
  const applyBrandFill = (color: string) => {
    if (!selectedPaintNode || document.kind === "template") return
    dispatch({ type: "SET_NODE_FILL", id: selectedPaintNode.id, fill: { type: "solid", color } })
  }
  const materializeFirstPage = () => {
    if (hasExplicitPages) return pages[0]
    const current = editor.getState().scene
    const root = current.nodes[current.root]
    if (!root || root.type !== "group") return undefined
    const pageId = stableId("page")
    const page: RhemaDesignPage = { id: pageId, nodeId: pageId, title: "Page 1" }
    const group: SaraswatiGroupNode = { id: pageId, type: "group", parentId: root.id, name: page.title, visible: true, opacity: 1, children: [] }
    pageNodeIds.current.add(pageId)
    setPageMetadata((current) => new Map(current).set(pageId, page))
    editor.beginBatch()
    dispatch({ type: "ADD_NODE", node: group })
    dispatch({ type: "SET_GROUP_CHILDREN", id: pageId, children: [...root.children] })
    dispatch({ type: "SET_GROUP_CHILDREN", id: root.id, children: [pageId] })
    editor.endBatch()
    setHasExplicitPages(true)
    setActivePageId(pageId)
    setSelectedId(null)
    return page
  }
  const addPage = () => {
    if (document.kind === "template") return
    if (!hasExplicitPages) materializeFirstPage()
    const current = editor.getState().scene
    const root = current.nodes[current.root]
    if (!root || root.type !== "group") return
    const pageId = stableId("page")
    const page: RhemaDesignPage = { id: pageId, nodeId: pageId, title: `Page ${root.children.length + 1}` }
    const group: SaraswatiGroupNode = { id: pageId, type: "group", parentId: root.id, name: page.title, visible: true, opacity: 1, children: [] }
    pageNodeIds.current.add(pageId)
    setPageMetadata((current) => new Map(current).set(pageId, page))
    dispatch({ type: "ADD_NODE", node: group })
    setHasExplicitPages(true)
    setActivePageId(pageId)
    setSelectedId(null)
  }
  const duplicatePage = () => {
    if (document.kind === "template") return
    const sourcePage = hasExplicitPages ? activePage : materializeFirstPage()
    if (!sourcePage) return
    const sourceScene = editor.getState().scene
    const root = sourceScene.nodes[sourceScene.root]
    if (!root || root.type !== "group") return
    const duplicateId = stableId("page")
    const duplicateTitle = `${sourcePage.title} copy`.slice(0, 80)
    const newBindings: Record<string, RhemaBinding> = {}
    const cloneNode = (sourceId: string, parentId: string, forcedId?: string): string | null => {
      const original = sourceScene.nodes[sourceId]
      if (!original) return null
      const id = forcedId ?? stableId("layer")
      const cloned: SaraswatiNode = original.type === "group"
        ? { ...original, id, parentId, name: sourceId === sourcePage.nodeId ? duplicateTitle : original.name, children: [] }
        : { ...original, id, parentId }
      dispatch({ type: "ADD_NODE", node: cloned })
      const binding = bindingsRef.current[sourceId]
      if (binding) newBindings[id] = { ...binding, id }
      if (original.type !== "group") return id
      const children = original.children.flatMap((childId) => {
        const child = cloneNode(childId, id)
        return child ? [child] : []
      })
      dispatch({ type: "SET_GROUP_CHILDREN", id, children })
      return id
    }
    editSceneWithBindings(() => {
      editor.beginBatch()
      cloneNode(sourcePage.nodeId, root.id, duplicateId)
      editor.endBatch()
    }, (current) => ({ ...current, ...newBindings }))
    const duplicate: RhemaDesignPage = { id: duplicateId, nodeId: duplicateId, title: duplicateTitle }
    pageNodeIds.current.add(duplicateId)
    setPageMetadata((current) => new Map(current).set(duplicateId, duplicate))
    setHasExplicitPages(true)
    setActivePageId(duplicateId)
    setSelectedId(null)
  }
  const movePage = (direction: -1 | 1) => {
    const root = editor.getState().scene.nodes[scene.root]
    if (!root || root.type !== "group") return
    const children = [...root.children]
    const from = children.indexOf(activePage.nodeId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= children.length) return
    ;[children[from], children[to]] = [children[to]!, children[from]!]
    dispatch({ type: "SET_GROUP_CHILDREN", id: root.id, children })
  }
  const deletePage = () => {
    if (pages.length <= 1 || document.kind === "template") return
    const index = pages.findIndex((page) => page.id === activePage.id)
    const nextPage = pages[index - 1] ?? pages[index + 1]
    dispatch({ type: "DELETE_NODE", id: activePage.nodeId })
    setActivePageId(nextPage?.id ?? scene.root)
    setSelectedId(null)
  }
  const moveByArrow = (event: React.KeyboardEvent<HTMLElement>, id: string | null) => {
    if (!id) return
    const step = event.shiftKey ? 10 : 1
    const delta = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : null
    if (delta) {
      event.preventDefault()
      dispatch({ type: "MOVE_NODE", id, dx: delta[0]!, dy: delta[1]! })
    }
  }
  const updateNode = (node: SaraswatiRenderableNode) => dispatch({ type: "REPLACE_NODE", node })
  const alignSelectedToPage = (
    axis: "horizontal" | "vertical",
    position: "start" | "center" | "end",
  ) => {
    if (!selectedRenderable) return
    const bounds = getNodeBounds(selectedRenderable)
    const current = axis === "horizontal" ? bounds.x : bounds.y
    const size = axis === "horizontal" ? bounds.width : bounds.height
    const pageSize = axis === "horizontal" ? scene.artboard.width : scene.artboard.height
    const target = position === "start"
      ? 0
      : position === "center"
        ? (pageSize - size) / 2
        : pageSize - size
    const delta = target - current
    if (axis === "horizontal") {
      if (delta !== 0) dispatch({ type: "MOVE_NODE", id: selectedRenderable.id, dx: delta, dy: 0 })
    } else if (delta !== 0) {
      dispatch({ type: "MOVE_NODE", id: selectedRenderable.id, dx: 0, dy: delta })
    }
  }
  const duplicateSelectedLayer = () => {
    if (!selectedRenderable) return
    const bounds = getNodeBounds(selectedRenderable)
    const horizontalDelta = bounds.x + bounds.width + 24 <= scene.artboard.width
      ? 24
      : bounds.x >= 24 ? -24 : 0
    const verticalDelta = bounds.y + bounds.height + 24 <= scene.artboard.height
      ? 24
      : bounds.y >= 24 ? -24 : 0
    const duplicateId = stableId("layer")
    const duplicate: SaraswatiRenderableNode = {
      ...selectedRenderable,
      id: duplicateId,
      name: `${selectedRenderable.name?.trim() || "Layer"} copy`.slice(0, 80),
    }
    const binding = bindingsRef.current[selectedRenderable.id]
    editSceneWithBindings(() => {
      editor.beginBatch()
      dispatch({ type: "ADD_NODE", node: duplicate })
      dispatch({ type: "MOVE_NODE", id: duplicateId, dx: horizontalDelta, dy: verticalDelta })
      editor.endBatch()
    }, (current) => binding
      ? { ...current, [duplicateId]: { ...binding, id: duplicateId } }
      : current)
    setSelectedId(duplicateId)
  }
  const updateFeedBinding = (patch: Partial<RhemaBinding>) => {
    if (!selectedRenderable) return
    const id = selectedRenderable.id
    setBindings((current) => {
      const binding = current[id]
      if (!binding || binding.kind !== "feed") return current
      return { ...current, [id]: { ...binding, ...patch } }
    })
  }
  const updateDynamicBinding = (patch: Partial<RhemaBinding>) => {
    if (!selectedRenderable) return
    const id = selectedRenderable.id
    const beforeBindings = bindingSnapshot(bindingsRef.current)
    const binding = beforeBindings[id]
    if (!binding || !["clock", "ticker", "lowerThird", "logo"].includes(binding.kind)) return
    const afterBindings = { ...beforeBindings, [id]: { ...binding, ...patch } }
    if (JSON.stringify(binding) === JSON.stringify(afterBindings[id])) return
    const sceneBeforeBindingChange = editor.getState().scene
    bindingSnapshots.current.set(sceneBeforeBindingChange, beforeBindings)
    // A harmless node command puts the host binding edit into the same Undo/Redo history.
    dispatch({ type: "SET_NODE_NAME", id, name: selectedRenderable.name ?? selectedRenderable.id })
    bindingSnapshots.current.set(editor.getState().scene, afterBindings)
    setBindings(afterBindings)
  }
  const chooseClockMode = (choice: string) => {
    if (selectedBinding?.kind !== "clock") return
    if (choice === "next") updateDynamicBinding({ clockShows: "countdown", countdownTo: undefined, until: undefined })
    else if (choice === "milestone") updateDynamicBinding({ clockShows: "countdown", countdownTo: selectedBinding.countdownTo && selectedBinding.countdownTo !== "next" ? selectedBinding.countdownTo : "end", until: undefined })
    else if (choice === "timer") updateDynamicBinding({ clockShows: undefined, countdownTo: undefined, until: undefined })
    else if (choice === "time") updateDynamicBinding({ clockShows: "time", countdownTo: undefined, until: undefined })
    else if (choice === "until") updateDynamicBinding({ clockShows: "until", countdownTo: undefined })
  }
  const clockChoice = selectedBinding?.kind === "clock"
    ? selectedBinding.clockShows === "countdown"
      ? (selectedBinding.countdownTo ?? "next") === "next" ? "next" : "milestone"
      : selectedBinding.clockShows ?? "timer"
    : "timer"
  const commitNumber = (field: "x" | "y" | "width" | "height", value: number) => {
    if (selectedRenderable) updateNode(moveValue(selectedRenderable, field, value))
  }
  const commitImageCrop = (field: "left" | "top" | "width" | "height", value: number) => {
    if (selectedRenderable?.type !== "image" || selectedPictureHasSceneCrop || !pictureSourceWidth || !pictureSourceHeight) return
    const cropX = field === "left"
      ? Math.min(pictureSourceWidth - 1, Math.max(0, Math.round(value)))
      : Math.min(pictureSourceWidth - 1, Math.max(0, selectedRenderable.cropX))
    const cropY = field === "top"
      ? Math.min(pictureSourceHeight - 1, Math.max(0, Math.round(value)))
      : Math.min(pictureSourceHeight - 1, Math.max(0, selectedRenderable.cropY))
    const fullWidth = pictureSourceWidth - cropX
    const fullHeight = pictureSourceHeight - cropY
    const previousWidth = selectedRenderable.cropWidth ?? pictureSourceWidth - selectedRenderable.cropX
    const previousHeight = selectedRenderable.cropHeight ?? pictureSourceHeight - selectedRenderable.cropY
    const visibleWidth = field === "width"
      ? Math.min(fullWidth, Math.max(1, Math.round(value)))
      : Math.min(fullWidth, previousWidth)
    const visibleHeight = field === "height"
      ? Math.min(fullHeight, Math.max(1, Math.round(value)))
      : Math.min(fullHeight, previousHeight)
    dispatch({
      type: "SET_IMAGE_CROP",
      id: selectedRenderable.id,
      cropX,
      cropY,
      cropWidth: visibleWidth < fullWidth ? visibleWidth : undefined,
      cropHeight: visibleHeight < fullHeight ? visibleHeight : undefined,
    })
  }
  const chooseImageMask = (choice: string) => {
    if (selectedRenderable?.type !== "image" || selectedPictureHasSceneCrop || (choice !== "none" && choice !== "ellipse")) return
    editor.beginBatch()
    dispatch({ type: "SET_NODE_CLIP_STACK", id: selectedRenderable.id, clipPathStack: [] })
    dispatch({
      type: "SET_NODE_CLIP_PATH",
      id: selectedRenderable.id,
      clipPath: choice === "ellipse" ? fullImageEllipseClip(selectedRenderable) : null,
    })
    editor.endBatch()
  }
  const resetImageAppearance = () => {
    if (selectedRenderable?.type !== "image" || selectedPictureHasSceneCrop) return
    editor.beginBatch()
    dispatch({ type: "SET_IMAGE_CROP", id: selectedRenderable.id, cropX: 0, cropY: 0 })
    dispatch({ type: "SET_IMAGE_BORDER_RADIUS", id: selectedRenderable.id, radius: 0 })
    dispatch({ type: "SET_NODE_CLIP_STACK", id: selectedRenderable.id, clipPathStack: [] })
    dispatch({ type: "SET_NODE_CLIP_PATH", id: selectedRenderable.id, clipPath: null })
    editor.endBatch()
  }
  const pointInScene = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * scene.artboard.width,
      y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * scene.artboard.height,
    }
  }
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointInScene(event)
    const next = pointerDown(pageScene, event.pointerId, point.x, point.y)
    pointerRef.current = next.state
    setSelectedId(next.selectedIds[0] ?? null)
    if (next.selectedIds.length) {
      event.currentTarget.setPointerCapture(event.pointerId)
      editor.beginBatch()
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current) return
    const point = pointInScene(event)
    const next = pointerMove(pointerRef.current, event.pointerId, point.x, point.y)
    pointerRef.current = next.state
    if (!next.command) return
    const current = editor.getState().scene
    const resizing = next.command.type === "RESIZE_NODE" ? current.nodes[next.command.id] : undefined
    if (next.command.type === "RESIZE_NODE" && resizing?.type === "image" && hasFullImageEllipse(resizing)) {
      const resizedScene = applyCommand(current, next.command)
      const resized = resizedScene.nodes[resizing.id]
      editor.beginBatch()
      dispatch(next.command)
      if (resized?.type === "image") {
        dispatch({ type: "SET_NODE_CLIP_PATH", id: resized.id, clipPath: fullImageEllipseClip(resized) })
      }
      editor.endBatch()
      return
    }
    dispatch(next.command)
  }
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerRef.current) return
    editor.endBatch()
    pointerRef.current = pointerUp(pointerRef.current, event.pointerId)
  }
  const addLayer = (kind: "color" | "feed") => {
    const made = kind === "color"
      ? createColorLayer({ x: Math.round(scene.artboard.width * 0.35), y: Math.round(scene.artboard.height * 0.35) })
      : createLiveFeedLayer({ x: Math.round(scene.artboard.width * 0.1), y: Math.round(scene.artboard.height * 0.15) })
    made.node.parentId = activeRootId
    editSceneWithBindings(
      () => dispatch({ type: "ADD_NODE", node: made.node }),
      (current) => ({ ...current, [made.node.id]: made.binding }),
    )
    setSelectedId(made.node.id)
  }
  const addLiveLayer = (kind: "clock" | "ticker" | "lowerThird" | "logo") => {
    const x = Math.round(scene.artboard.width * 0.36)
    const y = Math.round(scene.artboard.height * 0.36)
    const made = kind === "clock"
      ? createClockLayer({ x, y, shows: "timer" })
      : kind === "ticker"
        ? createTickerLayer()
        : kind === "lowerThird"
          ? createLowerThirdLayer()
          : createLogoLayer()
    made.node.parentId = activeRootId
    editSceneWithBindings(
      () => dispatch({ type: "ADD_NODE", node: made.node }),
      (current) => ({ ...current, [made.node.id]: made.binding }),
    )
    setSelectedId(made.node.id)
  }
  const addCameraLayer = (camera: Pick<(typeof cameras)[number], "name" | "label">) => {
    const router = useRouterHealth.getState().status
    if (!router?.running || !router.lanAddress) return
    const made = createCameraLayer({
      x: Math.round(scene.artboard.width * 0.1),
      y: Math.round(scene.artboard.height * 0.15),
      name: `${camera.label} camera`,
      url: whepUrl(router.lanAddress, router.ports, camera.name),
    })
    made.node.parentId = activeRootId
    setBindings((current) => ({ ...current, [made.node.id]: made.binding }))
    dispatch({ type: "ADD_NODE", node: made.node })
    setSelectedId(made.node.id)
  }
  const selectCameraSource = (name: string) => {
    const camera = cameras.find((candidate) => candidate.name === name)
    const router = useRouterHealth.getState().status
    if (!camera || !router?.running || !router.lanAddress || !selectedRenderable) return
    const binding = bindingsRef.current[selectedRenderable.id]
    if (binding?.kind !== "camera") return
    const previousName = cameraOfUrl(binding.cameraUrl, cameras)
    const previousLabel = cameras.find((candidate) => candidate.name === previousName)?.label
    const beforeBindings = bindingSnapshot(bindingsRef.current)
    const afterBindings = {
      ...beforeBindings,
      [selectedRenderable.id]: { ...binding, cameraUrl: whepUrl(router.lanAddress, router.ports, camera.name) },
    }
    const nextName = previousLabel && selectedRenderable.name === `${previousLabel} camera`
      ? `${camera.label} camera`
      : selectedRenderable.name ?? selectedRenderable.id
    const sceneBeforeSourceChange = editor.getState().scene
    bindingSnapshots.current.set(sceneBeforeSourceChange, beforeBindings)
    // A scene command anchors the non-canvas source binding in the editor's undo history too.
    dispatch({ type: "SET_NODE_NAME", id: selectedRenderable.id, name: nextName })
    bindingSnapshots.current.set(editor.getState().scene, afterBindings)
    setBindings(afterBindings)
  }
  const addTextLayer = () => {
    const id = "text-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const node: SaraswatiTextNode = {
      id,
      parentId: activeRootId,
      name: "Text",
      visible: true,
      x: Math.round(scene.artboard.width * 0.1),
      y: Math.round(scene.artboard.height * 0.36),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      originX: "left",
      originY: "top",
      type: "text",
      text: "Your text",
      width: Math.round(scene.artboard.width * 0.8),
      fontSize: 72,
      fontFamily: "Arial",
      fontWeight: "700",
      fontStyle: "normal",
      textAlign: "center",
      lineHeight: 1.2,
      underline: false,
      color: { type: "solid", color: "#ffffff" },
      stroke: null,
      strokeWidth: 0,
    }
    editSceneWithBindings(
      () => dispatch({ type: "ADD_NODE", node }),
      (current) => ({ ...current, [id]: { id, kind: "text", textBoxHeight: scene.artboard.height * 0.2 } }),
    )
    setSelectedId(id)
  }
  const addRectangleLayer = () => {
    const made = createColorLayer({
      x: Math.round(scene.artboard.width * 0.35),
      y: Math.round(scene.artboard.height * 0.35),
      color: "#3157a4",
      name: "Rectangle",
    })
    made.node.parentId = activeRootId
    editSceneWithBindings(
      () => dispatch({ type: "ADD_NODE", node: made.node }),
      (current) => ({ ...current, [made.node.id]: made.binding }),
    )
    setSelectedId(made.node.id)
  }
  const addEllipseLayer = () => {
    const id = "ellipse-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const node: SaraswatiEllipseNode = {
      id,
      parentId: activeRootId,
      name: "Ellipse",
      visible: true,
      x: Math.round(scene.artboard.width * 0.32),
      y: Math.round(scene.artboard.height * 0.3),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      originX: "left",
      originY: "top",
      type: "ellipse",
      width: Math.round(scene.artboard.width * 0.36),
      height: Math.round(scene.artboard.height * 0.4),
      fill: { type: "solid", color: "#3157a4" },
      stroke: null,
      strokeWidth: 0,
    }
    editSceneWithBindings(
      () => dispatch({ type: "ADD_NODE", node }),
      (current) => ({ ...current, [id]: { id, kind: "ellipse" } }),
    )
    setSelectedId(id)
  }
  // A star and an arrow (#448): drawn on every output as here, saved as colour layers.
  const addStarLayer = () => {
    const id = "star-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const size = Math.round(scene.artboard.height * 0.36)
    const node: SaraswatiPolygonNode = {
      id, parentId: activeRootId, name: "Star", visible: true,
      x: Math.round(scene.artboard.width / 2 - size / 2), y: Math.round(scene.artboard.height / 2 - size / 2),
      rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, originX: "left", originY: "top",
      type: "polygon", width: size, height: size,
      points: Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = (i % 2 ? 0.4 : 1) * size / 2
        return { x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)) }
      }),
      fill: { type: "solid", color: "#e2b04a" }, stroke: null, strokeWidth: 0,
    }
    editSceneWithBindings(
      () => dispatch({ type: "ADD_NODE", node }),
      (current) => ({ ...current, [id]: { id, kind: "color" } }),
    )
    setSelectedId(id)
  }
  const addArrowLayer = () => {
    const id = "arrow-" + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const w = scene.artboard.width, h = scene.artboard.height
    const node: SaraswatiLineNode = {
      id, parentId: activeRootId, name: "Arrow", visible: true, x: 0, y: 0,
      rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, originX: "left", originY: "top",
      type: "line", x1: Math.round(w * 0.3), y1: Math.round(h * 0.5), x2: Math.round(w * 0.7), y2: Math.round(h * 0.5),
      stroke: { type: "solid", color: "#ffffff" }, strokeWidth: 12, arrowStart: false, arrowEnd: true,
      lineStyle: "solid", pathType: "straight", curveBulge: 0, curveT: 0.5,
    }
    editSceneWithBindings(
      () => dispatch({ type: "ADD_NODE", node }),
      (current) => ({ ...current, [id]: { id, kind: "color" } }),
    )
    setSelectedId(id)
  }
  /**
   * A QR code layer (#851 G7): an ordinary picture layer holding the code for a safe http(s) link,
   * so it stays editable and saves into scenes like any other picture. The layer is named after
   * the link so nobody puts a surprise code on screen.
   */
  const addQrLayer = async () => {
    const link = safeLink(qrLink)
    if (!link) {
      setQrMessage("Enter a web address that starts with https:// or http:// (no password, at most 300 characters).")
      return
    }
    try {
      const imageUrl = await qrDataUrl(link)
      const side = Math.round(scene.artboard.height * 0.36)
      const id = stableId("qr")
      const node: SaraswatiImageNode = {
        id,
        parentId: activeRootId,
        name: `QR code · ${link}`.slice(0, 80),
        visible: true,
        x: Math.round((scene.artboard.width - side) / 2),
        y: Math.round((scene.artboard.height - side) / 2),
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        originX: "left",
        originY: "top",
        type: "image",
        width: side,
        height: side,
        src: imageUrl,
        cropX: 0,
        cropY: 0,
        clipPath: null,
      }
      editSceneWithBindings(
        () => dispatch({ type: "ADD_NODE", node }),
        (current) => ({ ...current, [id]: { id, kind: "picture", imageUrl } }),
      )
      setSelectedId(id)
      setQrFormOpen(false)
      setQrLink("")
      setQrMessage("")
      setMessage("QR code added as a picture layer. Keep it large and unrotated so it scans; save the draft to keep it.")
    } catch (error) {
      setQrMessage("The QR code could not be made: " + errorMessage(error))
    }
  }
  const openMediaPicker = (kind: "image" | "video") => {
    setMediaPickerKind(kind)
    setImagePickerOpen(true)
    setImagePickerMessage("")
    if (!mediaLoaded) void useMediaStore.getState().list()
  }
  const openImagePicker = () => openMediaPicker("image")
  const openVideoPicker = () => openMediaPicker("video")
  const importMediaFiles = async () => {
    const kind = mediaPickerKind
    const plural = kind === "video" ? "videos" : "pictures"
    setImagePickerBusy(true)
    setImagePickerMessage("")
    try {
      const results = await useMediaStore.getState().importFiles(kind === "video"
        ? [{ name: "Videos", extensions: ["mp4", "m4v", "mov", "webm"] }]
        : undefined)
      if (!results) return
      const imported = results.filter((result) => result.status === "imported")
      const failures = results.filter((result) => result.status === "failed")
      if (imported.length) setImagePickerMessage(`${kind === "video" ? "Videos" : "Pictures"} added to the Library. Choose one to add it to this design.`)
      else if (failures.length) setImagePickerMessage(failures.map((result) => result.message).join(" "))
      else setImagePickerMessage(`No ${plural} were added.`)
    } catch (error) {
      setImagePickerMessage(`The ${kind} could not be added to the Library: ` + errorMessage(error))
    } finally {
      setImagePickerBusy(false)
    }
  }
  const addLibraryPicture = async (asset: MediaAssetStatus) => {
    if (!asset.present) {
      setImagePickerMessage("That picture is no longer available in the Library. Refresh the list and try again.")
      return
    }
    setImagePickerBusy(true)
    setImagePickerMessage("")
    try {
      // Persist the content-addressed local asset URL in the design. The file name keeps the
      // media library's deletion guard effective and avoids copying image bytes into every version.
      const imageUrl = await useMediaStore.getState().fileUrl(asset.id)
      if (!imageUrl) throw new Error("The picture file is missing or could not be read.")

      const selectedImage = selectedRenderable?.type === "image" ? selectedRenderable : null
      if (selectedImage) {
        const sceneBeforeReplace = editor.getState().scene
        const bindingsBeforeReplace = bindingSnapshot(bindingsRef.current)
        bindingSnapshots.current.set(sceneBeforeReplace, bindingsBeforeReplace)
        const replacementBinding: RhemaBinding = {
          ...bindingsBeforeReplace[selectedImage.id],
          id: selectedImage.id,
          kind: "picture",
          mediaId: asset.id,
          imageUrl,
        }
        updateNode({ ...selectedImage, src: imageUrl })
        const sceneAfterReplace = editor.getState().scene
        const bindingsAfterReplace = {
          ...bindingsBeforeReplace,
          [selectedImage.id]: replacementBinding,
        }
        bindingSnapshots.current.set(sceneAfterReplace, bindingSnapshot(bindingsAfterReplace))
        setBindings(bindingsAfterReplace)
      } else {
        const sourceAspect = asset.width && asset.height && asset.width > 0 && asset.height > 0
          ? asset.width / asset.height
          : 16 / 9
        const aspect = Math.max(0.1, Math.min(10, sourceAspect))
        const maxWidth = scene.artboard.width * 0.5
        const maxHeight = scene.artboard.height * 0.5
        const width = Math.round(Math.min(maxWidth, maxHeight * aspect))
        const height = Math.round(width / aspect)
        const id = "image-" + globalThis.crypto.randomUUID()
        const node = {
          id,
          parentId: activeRootId,
          name: asset.name,
          visible: true,
          x: Math.round((scene.artboard.width - width) / 2),
          y: Math.round((scene.artboard.height - height) / 2),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          originX: "left" as const,
          originY: "top" as const,
          type: "image" as const,
          width,
          height,
          src: imageUrl,
          cropX: 0,
          cropY: 0,
          clipPath: null,
        }
        const sceneBeforeAdd = editor.getState().scene
        const bindingsBeforeAdd = bindingSnapshot(bindingsRef.current)
        const bindingsAfterAdd = { ...bindingsBeforeAdd, [id]: { id, kind: "picture" as const, mediaId: asset.id, imageUrl } }
        bindingSnapshots.current.set(sceneBeforeAdd, bindingsBeforeAdd)
        setBindings(bindingsAfterAdd)
        dispatch({ type: "ADD_NODE", node })
        bindingSnapshots.current.set(editor.getState().scene, bindingSnapshot(bindingsAfterAdd))
        setSelectedId(id)
      }
      setImagePickerOpen(false)
      setImagePickerMessage("")
      setMessage(selectedRenderable?.type === "image" ? "Library picture replaced. Save the draft to keep the change." : "Library picture added as a layer. Save the draft to keep the change.")
    } catch (error) {
      setImagePickerMessage("The picture could not be added to this design: " + errorMessage(error))
    } finally {
      setImagePickerBusy(false)
    }
  }
  const addLibraryVideo = async (asset: MediaAssetStatus) => {
    if (asset.kind !== "video" || !asset.present) {
      setImagePickerMessage("That video is no longer available in the Library. Refresh the list and try again.")
      return
    }
    setImagePickerBusy(true)
    setImagePickerMessage("")
    try {
      const videoUrl = await useMediaStore.getState().fileUrl(asset.id)
      if (!videoUrl) throw new Error("The video file is missing or could not be read.")
      const sourceAspect = asset.width && asset.height && asset.width > 0 && asset.height > 0
        ? asset.width / asset.height
        : 16 / 9
      const aspect = Math.max(0.1, Math.min(10, sourceAspect))
      const maxWidth = scene.artboard.width * 0.5
      const maxHeight = scene.artboard.height * 0.5
      const width = Math.round(Math.min(maxWidth, maxHeight * aspect))
      const height = Math.round(width / aspect)
      const id = stableId("video")
      const node: SaraswatiRectNode = {
        id,
        parentId: activeRootId,
        name: asset.name,
        visible: true,
        x: Math.round((scene.artboard.width - width) / 2),
        y: Math.round((scene.artboard.height - height) / 2),
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        originX: "left",
        originY: "top",
        type: "rect",
        width,
        height,
        fill: { type: "solid", color: VIDEO_LAYER_PLACEHOLDER_COLOR },
        stroke: null,
        strokeWidth: 0,
        radiusX: 0,
        radiusY: 0,
      }
      const sceneBeforeAdd = editor.getState().scene
      const bindingsBeforeAdd = bindingSnapshot(bindingsRef.current)
      const bindingsAfterAdd = {
        ...bindingsBeforeAdd,
        [id]: { id, kind: "video" as const, mediaId: asset.id, videoUrl, mediaFile: asset.file },
      }
      bindingSnapshots.current.set(sceneBeforeAdd, bindingsBeforeAdd)
      setBindings(bindingsAfterAdd)
      dispatch({ type: "ADD_NODE", node })
      bindingSnapshots.current.set(editor.getState().scene, bindingSnapshot(bindingsAfterAdd))
      setSelectedId(id)
      setImagePickerOpen(false)
      setImagePickerMessage("")
      setMessage("Library video added as an editable design layer. Its local preview is muted; outputs stay unchanged.")
    } catch (error) {
      setImagePickerMessage("The video could not be added to this design: " + errorMessage(error))
    } finally {
      setImagePickerBusy(false)
    }
  }
  const reorder = (direction: -1 | 1) => {
    if (!selectedId) return
    const root = scene.nodes[scene.nodes[selectedId]?.parentId ?? activeRootId]
    if (!root || root.type !== "group") return
    const children = [...root.children]
    const from = children.indexOf(selectedId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= children.length) return
    ;[children[from], children[to]] = [children[to]!, children[from]!]
    dispatch({ type: "SET_GROUP_CHILDREN", id: root.id, children })
  }
  const input = (): DesignInput => ({
    title: title.trim(),
    kind: document.kind,
    document: {
      ...designForEditor,
      scene,
      bindings: savedBindings,
      meta: { ...document.document.meta, name: title.trim() },
    },
  })
  const saveDraft = async () => {
    if (document.kind === "template" || conflicted || !title.trim()) return
    setWorking(true)
    setMessage("")
    try {
      const saved = await designStore.saveDraft(document.id, base.revision, input())
      setBase(saved)
      setConflicted(false)
      setMessage("Draft saved. Screens and Program are unchanged.")
      onSaved(saved)
      toast.success("Design draft saved", { description: "Preview, Program and outputs are unchanged." })
    } catch (error) {
      if (isRevisionConflict(error)) {
        setConflicted(true)
        setMessage("This design changed on another desk. Reopen the saved version before continuing.")
      } else setMessage("Draft could not be saved: " + errorMessage(error))
    } finally {
      setWorking(false)
    }
  }
  const createVersion = async () => {
    if (dirty || conflicted || document.kind === "template") return
    setWorking(true)
    setMessage("")
    try {
      const version = await designStore.createVersion(document.id, base.revision, versionNote.trim() || undefined, operatorName.trim() || undefined)
      setVersionNote("")
      setVersions((current) => [version, ...current.filter((item) => item.version !== version.version)])
      setMessage("Version " + version.version + " saved. It will not change any screen or service until you choose it.")
      onVersionCreated(version)
    } catch (error) {
      if (isRevisionConflict(error)) {
        setConflicted(true)
        setMessage("This design changed on another desk. Reopen the saved version before creating a version.")
      } else setMessage("Version could not be created: " + errorMessage(error))
    } finally {
      setWorking(false)
    }
  }
  const reopen = async () => {
    setWorking(true)
    try {
      await onReopen()
    } catch (error) {
      setMessage("The latest saved version could not be reopened: " + errorMessage(error))
      setWorking(false)
    }
  }

  return (
    <div className="flex h-full min-h-[32rem] min-w-0 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="design-document-title">Design name</label>
          <Input id="design-document-title" value={title} maxLength={200} onChange={(event) => setTitle(event.currentTarget.value)} className="h-9 max-w-xl text-base font-semibold" />
          <p className="mt-1 text-xs text-muted-foreground">Revision {base.revision} · {document.kind === "template" ? "Template copy required before editing" : versions.length ? versions.length + " saved " + (versions.length === 1 ? "version" : "versions") : "No immutable versions yet"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {document.kind === "template" ? (
            <Button onClick={() => void onDuplicate()} disabled={working}>Duplicate as design</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => editor.undo()} disabled={!editorFlags.canUndo || working} aria-label="Undo design edit"><Undo2Icon /> Undo</Button>
              <Button variant="outline" onClick={() => editor.redo()} disabled={!editorFlags.canRedo || working} aria-label="Redo design edit"><Redo2Icon /> Redo</Button>
              <Button variant="outline" onClick={() => void createVersion()} disabled={dirty || conflicted || working} title={dirty ? "Save the draft before creating an immutable version" : undefined}>Create version</Button>
              <Button onClick={() => void saveDraft()} disabled={!dirty || conflicted || working || !title.trim()}><SaveIcon /> Save draft</Button>
            </>
          )}
        </div>
      </header>
      {conflicted && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs"><span>{message}</span><Button size="xs" variant="outline" onClick={() => void reopen()} disabled={working}>Reopen saved version</Button></div>}
      {!conflicted && message && <p role="status" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{message}</p>}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="flex min-w-0 flex-col gap-2 p-3" aria-label="Design canvas">
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2" aria-label="Design pages">
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-[0.6875rem] font-semibold">Page
              <select aria-label="Design page" value={activePage.id} onChange={(event) => { setActivePageId(event.currentTarget.value); setSelectedId(null) }} className="h-8 rounded-md border border-input bg-background px-2 text-xs font-normal">
                {pages.map((page, index) => <option key={page.id} value={page.id}>{index + 1}. {page.title}</option>)}
              </select>
            </label>
            {hasExplicitPages ? (
              <label className="flex min-w-32 flex-1 flex-col gap-1 text-[0.6875rem] font-semibold">Page name
                <Input aria-label="Page name" value={activePage.title} maxLength={80} onChange={(event) => dispatch({ type: "SET_NODE_NAME", id: activePage.nodeId, name: event.currentTarget.value.slice(0, 80) })} className="h-8 text-xs font-normal" />
              </label>
            ) : <p className="max-w-56 text-[0.6875rem] text-muted-foreground">This saved design opens as one page. Add a page to make the layout multi-page.</p>}
            <div className="flex flex-wrap gap-1">
              <Button size="xs" variant="outline" onClick={addPage} disabled={document.kind === "template"} aria-label="Add page"><PlusIcon /> Add page</Button>
              <Button size="xs" variant="outline" onClick={duplicatePage} disabled={document.kind === "template"} aria-label="Duplicate page">Duplicate</Button>
              <Button size="icon-xs" variant="ghost" onClick={() => movePage(-1)} disabled={!hasExplicitPages || pages.findIndex((page) => page.id === activePage.id) <= 0} aria-label="Move page earlier"><ArrowUpIcon /></Button>
              <Button size="icon-xs" variant="ghost" onClick={() => movePage(1)} disabled={!hasExplicitPages || pages.findIndex((page) => page.id === activePage.id) >= pages.length - 1} aria-label="Move page later"><ArrowDownIcon /></Button>
              <Button size="icon-xs" variant="ghost" onClick={deletePage} disabled={!hasExplicitPages || pages.length <= 1 || document.kind === "template"} aria-label="Delete page"><Trash2Icon /></Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs" variant="outline" onClick={addTextLayer} disabled={document.kind === "template"}><TextIcon /> Text</Button>
            <Button size="xs" variant="outline" onClick={addRectangleLayer} disabled={document.kind === "template"}><SquareIcon /> Rectangle</Button>
            <Button size="xs" variant="outline" onClick={addEllipseLayer} disabled={document.kind === "template"}><CircleIcon /> Ellipse</Button>
            <Button size="xs" variant="outline" onClick={addStarLayer} disabled={document.kind === "template"}><StarIcon /> Star</Button>
            <Button size="xs" variant="outline" onClick={addArrowLayer} disabled={document.kind === "template"}><MoveRightIcon /> Arrow</Button>
            <Button size="xs" variant="outline" onClick={openImagePicker} disabled={document.kind === "template" || imagePickerBusy}>
              {selectedRenderable?.type === "image" ? "Replace image" : "Image from Library"}
            </Button>
            <Button size="xs" variant="outline" onClick={openVideoPicker} disabled={document.kind === "template" || imagePickerBusy}>Video from Library</Button>
            <Button size="xs" variant="outline" onClick={() => { setQrFormOpen((open) => !open); setQrMessage("") }} disabled={document.kind === "template"} aria-expanded={qrFormOpen}><QrCodeIcon /> QR code</Button>
            <Button size="xs" variant="outline" onClick={() => addLayer("feed")} disabled={document.kind === "template"}><PlusIcon /> Live content</Button>
            <Button size="xs" variant="outline" onClick={() => setCameraPickerOpen((open) => !open)} disabled={document.kind === "template"}><PlusIcon /> Camera</Button>
            <Button size="xs" variant="outline" onClick={() => addLayer("color")} disabled={document.kind === "template"}><PlusIcon /> Colour layer</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="outline" aria-label="Add live design layer" disabled={document.kind === "template"}><PlusIcon /> Live layers</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Connected to live sources</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => addLiveLayer("clock")}>Service clock</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addLiveLayer("ticker")}>Ticker</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addLiveLayer("lowerThird")}>Lower third</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => addLiveLayer("logo")}>Brand Kit logo</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="ml-auto text-[0.6875rem] text-muted-foreground">Drag on canvas or focus a layer and use arrow keys; Shift + arrow moves 10 px.</span>
          </div>
          {imagePickerOpen && (
            <section aria-label={mediaPickerKind === "video" ? "Video library" : "Image library"} className="rounded-md border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold">{mediaPickerKind === "video" ? "Videos from your Library" : "Pictures from your Library"}</h3>
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{mediaPickerKind === "video"
                    ? "Choose a local video to add as an editable, versioned layer. The design stays private until normal approval and explicit Take."
                    : "Choose a local image to add as an editable layer. It stays with this design when you save it."}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="xs" variant="outline" onClick={() => void importMediaFiles()} disabled={imagePickerBusy}>{mediaPickerKind === "video" ? "Import video" : "Import picture"}</Button>
                  <Button size="xs" variant="ghost" onClick={() => setImagePickerOpen(false)} disabled={imagePickerBusy}>Close</Button>
                </div>
              </div>
              {imagePickerMessage && <p role="status" className="mt-2 text-xs text-muted-foreground">{imagePickerMessage}</p>}
              {mediaError && (mediaPickerKind === "video" ? libraryVideos.length === 0 : libraryPictures.length === 0) && <p role="alert" className="mt-2 text-xs text-destructive">The Library {mediaPickerKind === "video" ? "videos" : "pictures"} could not be loaded: {mediaError}</p>}
              {(mediaPickerKind === "video" ? libraryVideos : libraryPictures).length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {(mediaPickerKind === "video" ? libraryVideos : libraryPictures).map((asset) => (
                    <li key={asset.id}>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void (mediaPickerKind === "video" ? addLibraryVideo(asset) : addLibraryPicture(asset))}
                        disabled={imagePickerBusy}
                        aria-label={mediaPickerKind === "video"
                          ? `Add ${asset.name} as video layer`
                          : `${selectedRenderable?.type === "image" ? "Replace with" : "Add"} ${asset.name}${selectedRenderable?.type === "image" ? "" : " as image layer"}`}
                      >
                        {asset.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : !mediaError && (
                <p className="mt-3 rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  No {mediaPickerKind === "video" ? "videos" : "pictures"} are in the Library yet. Import {mediaPickerKind === "video" ? "a video" : "a picture"} here, then choose it to add it to this design.
                </p>
              )}
            </section>
          )}
          {qrFormOpen && (
            <form aria-label="QR code" className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-3" onSubmit={(event) => { event.preventDefault(); void addQrLayer() }}>
              <label className="flex min-w-64 flex-1 flex-col gap-1 text-[0.6875rem] font-semibold">Link the QR code opens
                <Input aria-label="QR code link" type="url" inputMode="url" placeholder="https://" value={qrLink} maxLength={300} onChange={(event) => { setQrLink(event.currentTarget.value); setQrMessage("") }} className="h-8 text-xs font-normal" />
              </label>
              <Button type="submit" size="xs" disabled={!qrLink.trim()}>Add QR code</Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setQrFormOpen(false)}>Close</Button>
              {qrMessage && <p role="alert" className="basis-full text-xs text-destructive">{qrMessage}</p>}
            </form>
          )}
          {cameraPickerOpen && (
            <section aria-label="Camera sources" className="rounded-md border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold">Cameras</h3>
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">Add a configured church camera as a live layer. This remains a private design draft until it is approved and explicitly taken.</p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => setCameraPickerOpen(false)}>Close</Button>
              </div>
              {!cameraRouterReady ? (
                <p role="status" className="mt-3 rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  Camera selection needs a running Rhema camera router with a LAN address. Start or connect it in Live → Production tools → Cameras.
                </p>
              ) : cameras.length === 0 ? (
                <p role="status" className="mt-3 rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  No cameras are configured. Add a camera in Live → Production tools → Cameras, then return here.
                </p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {cameras.map((camera) => (
                    <li key={camera.name}>
                      <Button size="xs" variant="outline" onClick={() => addCameraLayer({ name: camera.name, label: camera.label })} aria-label={`Add ${camera.label} camera`}>
                        Add {camera.label} camera
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-md border border-border bg-neutral-950">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
              <Button
                type="button"
                size="xs"
                variant={liveValuesPreview ? "secondary" : "outline"}
                aria-label="Preview current Live values"
                aria-pressed={liveValuesPreview}
                onClick={() => {
                  const next = !liveValuesPreview
                  if (next) setPreviewClockNow(Date.now())
                  setLiveValuesPreview(next)
                }}
              >
                {liveValuesPreview ? "Hide Live values" : "Preview Live values"}
              </Button>
              <p role={liveValuesPreview ? "status" : undefined} className="max-w-2xl text-[0.6875rem] text-muted-foreground">
                {liveValuesPreview
                  ? "Private preview of current host values. It does not change this design, Preview, Program or any output."
                  : "The canvas is a private design draft. Preview Live values to check current content, clocks and overlays without taking them to a screen."}
              </p>
            </div>
            <canvas
              ref={canvasRef}
              width={scene.artboard.width}
              height={scene.artboard.height}
              className="block aspect-video h-auto w-full touch-none"
              aria-label="Design canvas; select a layer and use arrow keys to move it"
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(event) => moveByArrow(event, selectedId)}
            />
          </div>
          {selectedBinding?.kind === "video" && (
            <section aria-label="Video layer media preview" className="mx-auto mt-3 max-w-2xl rounded-md border border-border p-3">
              <h3 className="text-xs font-semibold">Video layer · local preview</h3>
              {selectedVideoMissing ? (
                <p role="alert" className="mt-2 text-xs text-destructive">The Library video “{selectedVideoAsset?.name ?? selectedRenderable?.name ?? selectedBinding.mediaFile ?? "Video"}” is missing on this computer. Replace it from the Library before using this version in Prepare.</p>
              ) : selectedBinding.videoUrl ? (
                <video
                  src={selectedBinding.videoUrl}
                  muted
                  loop
                  playsInline
                  controls
                  preload="metadata"
                  aria-label={`Local preview, starts muted: ${selectedRenderable?.name ?? selectedBinding.mediaFile ?? "Video"}`}
                  className="mt-2 max-h-64 w-full rounded bg-black object-contain"
                />
              ) : (
                <p role="alert" className="mt-2 text-xs text-destructive">This video layer has no readable local video reference. Add it again from the Library before using this version in Prepare.</p>
              )}
              {mediaError && <p role="status" className="mt-2 text-[0.6875rem] text-muted-foreground">The Library could not be checked. This local preview alone does not confirm the video will be available on outputs.</p>}
              <p className="mt-2 text-[0.6875rem] text-muted-foreground">This private editor preview starts muted. Player controls affect only this preview; they do not change Preview, Program or any screen.</p>
            </section>
          )}
          <p className="text-[0.6875rem] text-muted-foreground">This is a private design draft. Saving it does not change Preview, Program or any output.</p>
          {issues.length > 0 && (
            <div role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <p className="font-semibold">Some Avnac features are not supported by Rhema scene output yet.</p>
              <p className="mt-1">This design can still be saved and versioned as a native draft. A version with these compatibility issues cannot be used in Prepare.</p>
              <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue.nodeId + issue.message}>{issue.message}</li>)}</ul>
            </div>
          )}
        </section>
        <aside className="flex min-h-0 flex-col border-t border-border lg:border-t-0 lg:border-l" aria-label="Design layers and properties">
          <div className="border-b border-border p-3">
            <h3 className="text-xs font-bold">Layers</h3>
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {[...orderedIds].reverse().map((id) => {
                const node = scene.nodes[id]
                if (!renderable(node)) return null
                return (
                  <div key={id} className={cn("flex items-center gap-1 rounded border px-1", selectedId === id ? "border-primary bg-accent" : "border-transparent")}>
                    <button type="button" className="min-w-0 flex-1 truncate px-1 py-1 text-left text-[0.6875rem] outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedId(id)} onFocus={() => setSelectedId(id)} onKeyDown={(event) => moveByArrow(event, id)}>{node.name || "Unnamed layer"}</button>
                    <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={(node.visible ? "Hide " : "Show ") + (node.name || "layer")} onClick={() => dispatch({ type: "SET_NODE_VISIBLE", id, visible: !node.visible })}>{node.visible ? <EyeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}</button>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold">Properties</h3>
              {selectedRenderable && <>
                <Button size="icon-xs" variant="ghost" onClick={() => reorder(1)} aria-label="Move layer forward"><ArrowUpIcon /></Button>
                <Button size="icon-xs" variant="ghost" onClick={() => reorder(-1)} aria-label="Move layer backward"><ArrowDownIcon /></Button>
                <Button size="icon-xs" variant="ghost" onClick={duplicateSelectedLayer} aria-label="Duplicate selected layer"><CopyIcon /></Button>
                <Button size="icon-xs" variant="ghost" onClick={() => {
                  const id = selectedRenderable.id
                  dispatch({ type: "DELETE_NODE", id })
                  setSelectedId(null)
                }} aria-label="Delete selected layer"><Trash2Icon /></Button>
              </>}
            </div>
            {selectedRenderable ? (
              <div className="space-y-3">
                <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Layer name
                  <Input value={selectedRenderable.name ?? ""} maxLength={80} onChange={(event) => dispatch({ type: "SET_NODE_NAME", id: selectedRenderable.id, name: event.currentTarget.value })} className="h-8 text-xs text-foreground" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="X" value={selectedRenderable.x} onCommit={(value) => commitNumber("x", value)} />
                  <NumberField label="Y" value={selectedRenderable.y} onCommit={(value) => commitNumber("y", value)} />
                  {"width" in selectedRenderable && <NumberField label="Width" min={1} max={scene.artboard.width * 2} value={selectedRenderable.width} onCommit={(value) => commitNumber("width", value)} />}
                  {"height" in selectedRenderable && <NumberField label="Height" min={1} max={scene.artboard.height * 2} value={selectedRenderable.height} onCommit={(value) => commitNumber("height", value)} />}
                  <NumberField label="Opacity %" min={0} max={100} value={selectedRenderable.opacity * 100} onCommit={(value) => dispatch({ type: "SET_NODE_OPACITY", id: selectedRenderable.id, opacity: value / 100 })} />
                  <NumberField label="Rotation °" min={-360} max={360} value={selectedRenderable.rotation} onCommit={(value) => updateNode({ ...selectedRenderable, rotation: value })} />
                </div>
                {layerRotation(selectedRenderable.rotation) !== undefined && selectedBinding && !layerTurns(selectedBinding.kind) && <p role="status" className="text-[0.6875rem] text-muted-foreground">Cameras, videos and tickers stay upright on outputs. Set Rotation back to 0 before using a version in Prepare.</p>}
                {selectedRenderable.type === "image" && selectedBinding?.kind === "picture" && (
                  <section className="space-y-2 border-t border-border pt-3" aria-label="Picture appearance">
                    <div>
                      <h4 className="text-[0.6875rem] font-semibold">Picture appearance</h4>
                      {pictureSourceWidth && pictureSourceHeight
                        ? <p className="text-[0.6875rem] text-muted-foreground">Crop values use the original {pictureSourceWidth} × {pictureSourceHeight} picture pixels.</p>
                        : <p role="status" className="text-[0.6875rem] text-muted-foreground">The original picture size is unavailable, so crop controls are disabled.</p>}
                    </div>
                    {selectedPictureHasSceneCrop && <p role="alert" className="text-[0.6875rem] text-destructive">This picture is cropped in the Scene composer. Reset that crop there before changing crop, corners or mask here.</p>}
                    {pictureSourceWidth && pictureSourceHeight && (
                      <div className="grid grid-cols-2 gap-2">
                        <NumberField label="Crop left (px)" min={0} max={pictureSourceWidth - 1} value={selectedRenderable.cropX} disabled={selectedPictureHasSceneCrop} onCommit={(value) => commitImageCrop("left", value)} />
                        <NumberField label="Crop top (px)" min={0} max={pictureSourceHeight - 1} value={selectedRenderable.cropY} disabled={selectedPictureHasSceneCrop} onCommit={(value) => commitImageCrop("top", value)} />
                        <NumberField label="Visible width (px)" min={1} max={pictureSourceWidth - selectedRenderable.cropX} value={selectedRenderable.cropWidth ?? pictureSourceWidth - selectedRenderable.cropX} disabled={selectedPictureHasSceneCrop} onCommit={(value) => commitImageCrop("width", value)} />
                        <NumberField label="Visible height (px)" min={1} max={pictureSourceHeight - selectedRenderable.cropY} value={selectedRenderable.cropHeight ?? pictureSourceHeight - selectedRenderable.cropY} disabled={selectedPictureHasSceneCrop} onCommit={(value) => commitImageCrop("height", value)} />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField label="Corner radius (px)" min={0} max={Math.floor(Math.min(selectedRenderable.width, selectedRenderable.height) / 2)} value={selectedRenderable.borderRadius ?? 0} disabled={selectedPictureHasSceneCrop} onCommit={(radius) => dispatch({ type: "SET_IMAGE_BORDER_RADIUS", id: selectedRenderable.id, radius })} />
                      <label className="flex min-w-0 flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">
                        Shape mask
                        <select aria-label="Picture shape mask" value={imageMaskChoice(selectedRenderable)} disabled={selectedPictureHasSceneCrop} onChange={(event) => chooseImageMask(event.currentTarget.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                          <option value="none">None</option>
                          <option value="ellipse">Oval</option>
                          {imageMaskChoice(selectedRenderable) === "custom" && <option value="custom" disabled>Custom mask · preserved</option>}
                        </select>
                      </label>
                    </div>
                    <Button size="xs" variant="outline" disabled={selectedPictureHasSceneCrop} onClick={resetImageAppearance}>Reset picture appearance</Button>
                  </section>
                )}
                <section className="space-y-2 border-t border-border pt-3" aria-label="Align selected layer">
                  <h4 className="text-[0.6875rem] font-semibold">Align to page</h4>
                  <div role="group" aria-label="Horizontal alignment" className="flex flex-wrap gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("horizontal", "start")} aria-label="Align left to page">Left</Button>
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("horizontal", "center")} aria-label="Center horizontally on page">Center</Button>
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("horizontal", "end")} aria-label="Align right to page">Right</Button>
                  </div>
                  <div role="group" aria-label="Vertical alignment" className="flex flex-wrap gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("vertical", "start")} aria-label="Align top to page">Top</Button>
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("vertical", "center")} aria-label="Center vertically on page">Middle</Button>
                    <Button size="xs" variant="outline" onClick={() => alignSelectedToPage("vertical", "end")} aria-label="Align bottom to page">Bottom</Button>
                  </div>
                </section>
                {selectedPaintNode && (
                  (selectedPaintNode.type === "rect" || selectedPaintNode.type === "polygon") && selectedBinding?.kind === "color" || selectedPaintNode.type === "ellipse" && selectedBinding?.kind === "ellipse"
                    ? <PaintControls label="Fill" paint={selectedPaintNode.fill} accentColor={brandKit.colors.accent} onChange={(fill) => dispatch({ type: "SET_NODE_FILL", id: selectedPaintNode.id, fill })} />
                    : <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Fill colour
                        {selectedPaintNode.fill.type === "solid"
                          ? <Input type="color" value={selectedPaintNode.fill.color} onChange={(event) => dispatch({ type: "SET_NODE_FILL", id: selectedPaintNode.id, fill: { type: "solid", color: event.currentTarget.value } })} className="h-8 w-14 p-1" />
                          : <span className="text-[0.6875rem]">Gradient preserved</span>}
                      </label>
                )}
                {/* A line or arrow (#448): its colour, width and arrowheads, as outputs draw them. */}
                {selectedRenderable.type === "line" && document.kind !== "template" && (() => {
                  const line = selectedRenderable
                  const color = line.stroke.type === "solid" ? line.stroke.color : "#ffffff"
                  return (
                    <section className="space-y-2 border-t border-border pt-3" aria-label="Line">
                      <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Line colour
                        <Input type="color" aria-label="Line colour" value={color} onChange={(event) => updateNode({ ...line, stroke: { type: "solid", color: event.currentTarget.value } })} className="h-8 w-14 p-1" />
                      </label>
                      <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Width (px)
                        <Input type="number" aria-label="Line width" min={1} max={200} value={line.strokeWidth} onChange={(event) => { const w = Number(event.currentTarget.value); if (w >= 1 && w <= 200) updateNode({ ...line, strokeWidth: w }) }} className="h-8 w-20" />
                      </label>
                      <div className="flex gap-3 text-[0.6875rem]">
                        <label className="flex items-center gap-1"><input type="checkbox" checked={line.arrowStart} onChange={(event) => updateNode({ ...line, arrowStart: event.currentTarget.checked })} /> Arrow at start</label>
                        <label className="flex items-center gap-1"><input type="checkbox" checked={line.arrowEnd} onChange={(event) => updateNode({ ...line, arrowEnd: event.currentTarget.checked })} /> Arrow at end</label>
                      </div>
                    </section>
                  )
                })()}
                {(selectedRenderable.type === "text" || !!selectedPaintNode) && (
                  <section className="space-y-2 border-t border-border pt-3" aria-label="Brand Kit styles">
                    <h4 className="text-[0.6875rem] font-semibold">Brand Kit</h4>
                    <p className="text-[0.6875rem] text-muted-foreground">Color tokens replace this layer’s current color or fill, including a gradient fill, with a solid color copied into this draft. Later Brand Kit changes will not update this layer.</p>
                    {selectedRenderable.type === "text" ? (
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="xs" variant="outline" aria-label="Apply Brand Kit heading font" disabled={document.kind === "template"} onClick={() => applyBrandTextFont(brandKit.fonts.heading)}>
                          Heading · {brandKit.fonts.heading}
                        </Button>
                        <Button size="xs" variant="outline" aria-label="Apply Brand Kit body font" disabled={document.kind === "template"} onClick={() => applyBrandTextFont(brandKit.fonts.body)}>
                          Body · {brandKit.fonts.body}
                        </Button>
                        <Button size="xs" variant="outline" aria-label="Apply Brand Kit text colour" disabled={document.kind === "template"} onClick={() => applyBrandTextColor(brandKit.colors.text)}>
                          <span aria-hidden="true" className="size-3 rounded-full border border-border" style={{ backgroundColor: brandKit.colors.text }} /> Text · {brandKit.colors.text}
                        </Button>
                        <Button size="xs" variant="outline" aria-label="Apply Brand Kit accent colour" disabled={document.kind === "template"} onClick={() => applyBrandTextColor(brandKit.colors.accent)}>
                          <span aria-hidden="true" className="size-3 rounded-full border border-border" style={{ backgroundColor: brandKit.colors.accent }} /> Accent · {brandKit.colors.accent}
                        </Button>
                      </div>
                    ) : selectedPaintNode && (
                      <div className="flex flex-wrap gap-1.5">
                        {(["primary", "accent", "text", "background"] as const).map((token) => {
                          const color = brandKit.colors[token]
                          return (
                            <Button key={token} size="xs" variant="outline" aria-label={`Apply Brand Kit ${token} fill`} disabled={document.kind === "template"} onClick={() => applyBrandFill(color)}>
                              <span aria-hidden="true" className="size-3 rounded-full border border-border" style={{ backgroundColor: color }} /> {token} · {color}
                            </Button>
                          )
                        })}
                      </div>
                    )}
                  </section>
                )}
                {selectedBinding?.kind === "feed" && (
                  <section className="space-y-3 border-t border-border pt-3" aria-label="Live content binding">
                    <fieldset className="space-y-2">
                      <legend className="text-[0.6875rem] font-semibold">What this follows</legend>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          aria-pressed={!selectedBinding.shows?.length}
                          onClick={() => updateFeedBinding({ shows: undefined })}
                          className={cn(
                            "rounded-full border px-2 py-1 text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            !selectedBinding.shows?.length ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          Whatever is on air
                        </button>
                        {CONTENT_TYPES.map((source: ContentType) => {
                          const selected = !!selectedBinding.shows?.includes(source)
                          return (
                            <button
                              key={source}
                              type="button"
                              aria-pressed={selected}
                              aria-label={`Follow ${CONTENT_NAMES[source]}`}
                              onClick={() => {
                                const current = selectedBinding.shows ?? []
                                const next = selected
                                  ? current.filter((item) => item !== source)
                                  : [...current, source]
                                updateFeedBinding({ shows: next.length ? next : undefined })
                              }}
                              className={cn(
                                "rounded-full border px-2 py-1 text-[0.6875rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                selected ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {CONTENT_NAMES[source]}
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">
                      Language
                      <select
                        aria-label="Live content language"
                        value={selectedBinding.language ?? ""}
                        onChange={(event) => updateFeedBinding({ language: (event.currentTarget.value || undefined) as BroadcastOutputLanguage | undefined })}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      >
                        <option value="">Use each output’s language</option>
                        <option value="first">Primary language only</option>
                        <option value="second">Secondary language only</option>
                        <option value="both">Both available languages</option>
                      </select>
                    </label>
                    <p className="text-[0.6875rem] text-muted-foreground">These choices are saved with this design. The canvas shows a placeholder for live content; it does not preview the current program.</p>
                  </section>
                )}
                {selectedBinding?.kind === "camera" && (
                  <section className="space-y-2 border-t border-border pt-3" aria-label="Camera source binding">
                    <h4 className="text-[0.6875rem] font-semibold">Camera source</h4>
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Configured camera
                      <select
                        aria-label="Camera source"
                        value={selectedCameraName ?? ""}
                        onChange={(event) => selectCameraSource(event.currentTarget.value)}
                        disabled={!cameraRouterReady || cameras.length === 0}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                      >
                        {!selectedCameraName && <option value="" disabled>Saved source is not configured</option>}
                        {cameras.map((camera) => <option key={camera.name} value={camera.name}>{camera.label}</option>)}
                      </select>
                    </label>
                    {!cameraRouterReady && <p role="status" className="text-[0.6875rem] text-muted-foreground">Connect a running Rhema camera router with a LAN address to change this source. The saved design stays unchanged.</p>}
                    {cameraRouterReady && cameras.length === 0 && <p role="status" className="text-[0.6875rem] text-muted-foreground">No configured cameras are available. Add one in Live → Production tools → Cameras.</p>}
                    <p className="text-[0.6875rem] text-muted-foreground">The canvas shows a placeholder and does not display live camera video. The draft stores the camera stream address; camera page secrets remain in Settings and are not copied into this design.</p>
                  </section>
                )}
                {selectedBinding?.kind === "clock" && (
                  <section className="space-y-2 border-t border-border pt-3" aria-label="Clock layer settings">
                    <h4 className="text-[0.6875rem] font-semibold">Host clock</h4>
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">What it shows
                      <select aria-label="What clock shows" value={clockChoice} onChange={(event) => chooseClockMode(event.currentTarget.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                        <option value="timer">Service timer</option>
                        <option value="until">Countdown to a time</option>
                        <option value="next">Time until the next item</option>
                        <option value="milestone">Time until a run-of-show milestone</option>
                        <option value="time">Time of day</option>
                      </select>
                    </label>
                    {clockChoice === "until" && (
                      <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Count down to
                        <Input type="time" aria-label="Count down to" value={selectedBinding.until ?? ""} onChange={(event) => updateDynamicBinding({ until: event.currentTarget.value || undefined })} className="h-8 w-28 text-xs text-foreground" />
                      </label>
                    )}
                    {clockChoice === "milestone" && (
                      <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Run-of-show target
                        <CountdownSelect label="Clock run-of-show target" value={selectedBinding.countdownTo} onChange={(countdownTo) => updateDynamicBinding({ countdownTo })} />
                      </label>
                    )}
                    <p className="text-[0.6875rem] text-muted-foreground">The host supplies the clock when this approved design is used. The canvas shows a placeholder, not the current timer or time.</p>
                  </section>
                )}
                {selectedBinding?.kind === "ticker" && (
                  <section className="space-y-2 border-t border-border pt-3" aria-label="Ticker layer settings">
                    <h4 className="text-[0.6875rem] font-semibold">Host ticker</h4>
                    <p className="text-[0.6875rem] text-muted-foreground">This layer follows the ticker currently running in Production. Its wording stays managed there; the canvas shows a placeholder.</p>
                  </section>
                )}
                {selectedBinding?.kind === "lowerThird" && (
                  <section className="space-y-2 border-t border-border pt-3" aria-label="Lower third layer settings">
                    <h4 className="text-[0.6875rem] font-semibold">Presenter lower third</h4>
                    <p className="text-[0.6875rem] text-muted-foreground">This layer follows the presenter name and title currently on air. Its wording stays managed in Production; the canvas shows a placeholder.</p>
                  </section>
                )}
                {selectedBinding?.kind === "logo" && (
                  <section className="space-y-2 border-t border-border pt-3" aria-label="Brand Kit logo layer settings">
                    <h4 className="text-[0.6875rem] font-semibold">Brand Kit logo</h4>
                    <p className="text-[0.6875rem] text-muted-foreground">This layer follows the logo saved in Settings → Brand Kit, so a later logo update is reflected here. The canvas shows a placeholder.</p>
                  </section>
                )}
                {selectedRenderable.type === "text" && (
                  <div className="space-y-3 border-t border-border pt-3">
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Text content
                      <textarea aria-label="Text content" value={selectedRenderable.text} maxLength={2000} onChange={(event) => dispatch({ type: "SET_TEXT_CONTENT", id: selectedRenderable.id, text: event.currentTarget.value })} rows={4} className="min-h-20 resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    </label>
                    <NumberField label="Font size" min={8} max={400} value={selectedRenderable.fontSize} onCommit={(value) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontSize: value })} />
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Font family
                      <Input value={selectedRenderable.fontFamily} maxLength={120} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontFamily: event.currentTarget.value })} className="h-8 text-xs text-foreground" />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[0.6875rem] font-medium text-muted-foreground">Text colour
                      {selectedRenderable.color.type === "solid"
                        ? <Input type="color" value={selectedRenderable.color.color} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, color: { type: "solid", color: event.currentTarget.value } })} className="h-8 w-14 p-1" />
                        : <span className="text-[0.6875rem]">Gradient preserved</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Alignment
                      <select aria-label="Text alignment" value={selectedRenderable.textAlign} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, textAlign: event.currentTarget.value as SaraswatiTextNode["textAlign"] })} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                        <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[0.6875rem] font-medium text-muted-foreground">Font weight
                      <select aria-label="Font weight" value={selectedRenderable.fontWeight} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontWeight: event.currentTarget.value })} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                        <option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground">
                      <input type="checkbox" checked={selectedRenderable.fontStyle === "italic"} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, fontStyle: event.currentTarget.checked ? "italic" : "normal" })} />
                      Italic
                    </label>
                    <label className="flex items-center gap-2 text-[0.6875rem] font-medium text-muted-foreground">
                      <input type="checkbox" checked={selectedRenderable.underline} onChange={(event) => dispatch({ type: "SET_TEXT_FORMAT", id: selectedRenderable.id, underline: event.currentTarget.checked })} />
                      Underline
                    </label>
                  </div>
                )}
              </div>
            ) : <p className="text-xs text-muted-foreground">Select a layer on the canvas or in this list to edit its placement.</p>}
            <div className="mt-5 border-t border-border pt-3">
              <h3 className="text-xs font-bold">Artboard</h3>
              <PaintControls label="Artboard background" paint={scene.artboard.bg} accentColor={brandKit.colors.accent} onChange={(bg) => dispatch({ type: "SET_ARTBOARD", bg })} />
            </div>
            <div className="mt-5 border-t border-border pt-3">
              <h3 className="text-xs font-bold">Saved versions</h3>
              <Input aria-label="Version note" value={versionNote} maxLength={200} onChange={(event) => setVersionNote(event.currentTarget.value)} placeholder="Optional note for the next version" className="mt-2 h-8 text-xs" />
              {versions.length === 0 ? (
                <p className="mt-2 text-[0.6875rem] text-muted-foreground">No immutable version yet. Save the draft, then create a version to use it in Prepare.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {versions.map((version) => <li key={version.version} className="rounded border border-border px-2 py-1.5">
                    <p className="text-[0.6875rem] font-semibold">Version {version.version}{version.note ? " · " + version.note : ""}</p>
                    <p className="text-[0.6875rem] text-muted-foreground">{version.savedBy || "Main desk"} · {new Date(version.createdAt).toLocaleString()}</p>
                  </li>)}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
