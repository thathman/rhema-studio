import { useEffect, useRef, useState, useCallback } from "react"
import * as fabric from "fabric"
import { useBroadcastStore } from "@/stores"
import {
  onThemeFontsLoaded,
  renderVerse,
  type VerseLayoutMetrics,
} from "@/lib/verse-renderer"
import { seedFreeBoxesFromMetrics, SAMPLE_VERSE, SAMPLE_BILINGUAL_VERSE, SAMPLE_BILINGUAL_SONG } from "@/lib/theme-migrations"
import type { VerseRenderData } from "@/types/broadcast"

/** A landscape stand-in for the Picture preview, drawn here (no file, nothing fetched). */
function drawSamplePicture(): string {
  if (typeof document === "undefined") return ""
  const c = document.createElement("canvas")
  c.width = 1600
  c.height = 1000
  const g = c.getContext("2d")
  if (!g) return ""
  const sky = g.createLinearGradient(0, 0, 0, 1000)
  sky.addColorStop(0, "#5b8cc9")
  sky.addColorStop(1, "#f3c98b")
  g.fillStyle = sky
  g.fillRect(0, 0, 1600, 1000)
  g.fillStyle = "#fff4d6"
  g.beginPath()
  g.arc(1150, 330, 110, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = "#3d5a3f"
  g.beginPath()
  g.moveTo(0, 760); g.lineTo(380, 520); g.lineTo(700, 760); g.lineTo(1050, 470); g.lineTo(1600, 820); g.lineTo(1600, 1000); g.lineTo(0, 1000)
  g.closePath()
  g.fill()
  return c.toDataURL("image/png")
}
const SAMPLE_PICTURE_URL = drawSamplePicture()

/** What the Designer preview shows: each kind of content the theme can be used for. */
export type PreviewSample = "one" | "two" | "song" | "hymn" | "slide" | "picture"
const PREVIEW_SAMPLES: Record<PreviewSample, VerseRenderData> = {
  one: { ...SAMPLE_VERSE, content: "bible" },
  two: { ...SAMPLE_BILINGUAL_VERSE, content: "bible" },
  song: { ...SAMPLE_BILINGUAL_SONG, content: "song" },
  hymn: { ...SAMPLE_BILINGUAL_SONG, reference: "Amazing Grace · Verse 1", footer: "Amazing Grace · Hymn Book 245", content: "hymn" },
  slide: { kind: "slide", reference: "Announcements", segments: [{ text: "Youth meeting, Friday 6 pm. Choir practice, Saturday 4 pm." }], lines: ["Youth meeting · Friday 6 pm", "Choir practice · Saturday 4 pm"], content: "slide" },
  picture: { kind: "image", reference: "", segments: [], image: { url: SAMPLE_PICTURE_URL, fit: "contain", blur: 0, brightness: 100, tint: null }, content: "picture" },
}
const PREVIEW_TABS: ReadonlyArray<readonly [PreviewSample, string]> = [["one", "Bible"], ["two", "Bible · two languages"], ["song", "Song"], ["hymn", "Hymn"], ["slide", "Slide"], ["picture", "Picture"]]
// Read by the (module-level) redraw; the toolbar sets it and asks for a redraw.
let previewSample: PreviewSample = "two"
import { loadThemeImage, preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import { Button } from "@/components/ui/button"
import {
  SearchIcon,
  PlusIcon,
  MinusIcon,
  MousePointer2Icon,
  Grid3X3Icon,
  MaximizeIcon,
} from "lucide-react"
import { CONTENT_TYPES } from "@/types/broadcast"
import { MAIN_OUTPUT_ID } from "@/types"
import { themeIdFor, withThemeFor } from "@/lib/output-themes"
import { CONTENT_NAMES } from "@/lib/content-names"

/** The stage colour around the slide, from the theme (sage in light, near-black in dark). */
function stageColor(): string {
  if (typeof document === "undefined") return "#e7efeb"
  return getComputedStyle(document.documentElement).getPropertyValue("--canvas-stage").trim() || "#e7efeb"
}
import type { BroadcastTheme } from "@/types"

const WS_WIDTH = 1920
const WS_HEIGHT = 1080

export function DesignCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const latestThemeRef = useRef<BroadcastTheme | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const objectsRef = useRef<{
    workspace: fabric.Rect | null
    referenceRegion: fabric.Rect | null
    verseRegion: fabric.Rect | null
  }>({ workspace: null, referenceRegion: null, verseRegion: null })
  const draggingRef = useRef<"reference" | "verse" | null>(null)
  const latestMetricsRef = useRef<VerseLayoutMetrics | null>(null)

  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const editingThemeId = useBroadcastStore((s) => s.editingThemeId)
  const selectedElement = useBroadcastStore((s) => s.selectedElement)
  const [zoomLevel, setZoomLevel] = useState(0)
  const [sample, setSample] = useState<PreviewSample>(previewSample)

  const resyncLatestTheme = useCallback(() => {
    const latestTheme = latestThemeRef.current
    const canvas = fabricRef.current
    if (!latestTheme || !canvas) return
    void syncThemeToCanvas(
      latestTheme,
      objectsRef,
      canvas,
      undefined,
      latestMetricsRef,
      draggingRef.current
    )
  }, [])

  // Auto-zoom: fit workspace into container
  const autoZoom = useCallback(() => {
    const canvas = fabricRef.current
    const container = containerRef.current
    const workspace = objectsRef.current.workspace
    if (!canvas || !container || !workspace) return

    const cw = container.offsetWidth
    const ch = container.offsetHeight
    canvas.setDimensions({ width: cw, height: ch })

    // Reset viewport
    const identity: fabric.TMat2D = [1, 0, 0, 1, 0, 0]
    canvas.setViewportTransform(identity)

    // Calculate zoom to fit workspace with padding
    const scale = fabric.util.findScaleToFit(workspace, { width: cw, height: ch }) * 0.85
    canvas.setZoom(scale)

    // Center the workspace
    const wsCenter = workspace.getCenterPoint()
    const vpTransform = canvas.viewportTransform!
    vpTransform[4] = cw / 2 - wsCenter.x * vpTransform[0]
    vpTransform[5] = ch / 2 - wsCenter.y * vpTransform[3]
    canvas.setViewportTransform(vpTransform)
    canvas.requestRenderAll()
    resyncLatestTheme()

    setZoomLevel(Math.round(scale * 100))
  }, [resyncLatestTheme])

  // Initialize Fabric canvas + workspace
  useEffect(() => {
    if (!canvasElRef.current || !containerRef.current || !editingThemeId) return

    const canvas = new fabric.Canvas(canvasElRef.current, {
      backgroundColor: stageColor(),
      controlsAboveOverlay: true,
    })

    // Set canvas to container size
    const cw = containerRef.current.offsetWidth
    const ch = containerRef.current.offsetHeight
    canvas.setDimensions({ width: cw, height: ch })

    // Create workspace rect (the 1920x1080 "page")
    const workspace = new fabric.Rect({
      width: WS_WIDTH,
      height: WS_HEIGHT,
      fill: "white",
      selectable: false,
      hasControls: false,
      hoverCursor: "default",
      shadow: new fabric.Shadow({ color: "rgba(0,0,0,0.4)", blur: 20 }),
    })
    canvas.add(workspace)
    canvas.centerObject(workspace)
    workspace.setCoords()
    // Never assign the workspace itself as canvas.clipPath: Fabric shares one
    // cache canvas per object, so the clip pass would mask the whole canvas
    // with the theme bitmap's alpha (blanking transparent themes during drag).
    objectsRef.current.workspace = workspace

    const refRegion = new fabric.Rect({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      width: 100,
      height: 40,
      fill: "rgba(0,0,0,0.001)",
      selectable: true,
      hasControls: false,
      hasBorders: true,
      borderColor: "#f59e0b",
      borderDashArray: [6, 3],
      lockMovementX: false,
      lockMovementY: false,
      evented: true,
      objectCaching: false,
    })
    canvas.add(refRegion)
    objectsRef.current.referenceRegion = refRegion

    const verseRegion = new fabric.Rect({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      width: 100,
      height: 200,
      fill: "rgba(0,0,0,0.001)",
      selectable: true,
      hasControls: false,
      hasBorders: true,
      borderColor: "#f59e0b",
      borderDashArray: [6, 3],
      lockMovementX: false,
      lockMovementY: false,
      evented: true,
      objectCaching: false,
    })
    canvas.add(verseRegion)
    objectsRef.current.verseRegion = verseRegion

    // Selection events
    canvas.on("selection:created", (e) => {
      const obj = e.selected?.[0]
      if (obj === objectsRef.current.referenceRegion) {
        useBroadcastStore.getState().setSelectedElement("reference")
      } else if (obj === objectsRef.current.verseRegion) {
        useBroadcastStore.getState().setSelectedElement("verse")
      }
    })
    canvas.on("selection:updated", (e) => {
      const obj = e.selected?.[0]
      if (obj === objectsRef.current.referenceRegion) {
        useBroadcastStore.getState().setSelectedElement("reference")
      } else if (obj === objectsRef.current.verseRegion) {
        useBroadcastStore.getState().setSelectedElement("verse")
      }
    })
    canvas.on("selection:cleared", () => {
      useBroadcastStore.getState().setSelectedElement(null)
    })

    // Drag-to-position: moving a region writes its box back to the draft
    // theme. Dragging while in stacked mode detaches into free mode first,
    // seeding boxes from the current stacked layout so nothing jumps.
    const regionForObject = (obj: fabric.Object | undefined) =>
      obj === objectsRef.current.referenceRegion
        ? ("reference" as const)
        : obj === objectsRef.current.verseRegion
          ? ("verse" as const)
          : null

    canvas.on("object:moving", (e) => {
      const region = regionForObject(e.target)
      if (!region) return
      draggingRef.current = region

      const store = useBroadcastStore.getState()
      let theme = store.draftTheme
      if (!theme) return
      if (
        theme.layout.mode !== "free" ||
        !theme.layout.referenceBox ||
        !theme.layout.verseBox
      ) {
        const metrics = latestMetricsRef.current
        const seeded = metrics
          ? seedFreeBoxesFromMetrics(metrics, theme.resolution)
          : null
        if (!seeded) return
        store.updateDraft({ layout: { ...theme.layout, mode: "free", ...seeded } })
        theme = useBroadcastStore.getState().draftTheme
        if (!theme) return
      }

      const ws = objectsRef.current.workspace
      const obj = e.target
      if (!ws || !obj) return
      const wsTopLeft = ws.getPointByOrigin("left", "top")
      const key = region === "reference" ? "referenceBox" : "verseBox"
      const box = theme.layout[key]
      if (!box) return
      const widthPx = (box.width / 100) * WS_WIDTH
      const heightPx = (box.height / 100) * WS_HEIGHT
      const localX = clamp(obj.left - wsTopLeft.x, 0, Math.max(0, WS_WIDTH - widthPx))
      const localY = clamp(obj.top - wsTopLeft.y, 0, Math.max(0, WS_HEIGHT - heightPx))
      store.updateDraftNested(`layout.${key}`, {
        ...box,
        x: Math.round((localX / WS_WIDTH) * 10000) / 100,
        y: Math.round((localY / WS_HEIGHT) * 10000) / 100,
      })
    })

    const endDrag = () => {
      if (!draggingRef.current) return
      draggingRef.current = null
      resyncLatestTheme()
    }
    canvas.on("object:modified", endDrag)
    canvas.on("mouse:up", endDrag)

    fabricRef.current = canvas

    // Auto-zoom after a tick (canvas needs to be in DOM)
    requestAnimationFrame(() => {
      autoZoom()
    })

    // ResizeObserver for auto-zoom on container resize
    const observer = new ResizeObserver(() => autoZoom())
    observer.observe(containerRef.current)

    // Re-render once theme webfonts load — text measured against fallback
    // fonts before that would leave the bitmap and hit rects off.
    const unsubscribeFonts = onThemeFontsLoaded(() => resyncLatestTheme())

    return () => {
      unsubscribeFonts()
      observer.disconnect()
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
      void canvas.dispose()
      fabricRef.current = null
      objectsRef.current = { workspace: null, referenceRegion: null, verseRegion: null }
    }
  }, [editingThemeId, autoZoom, resyncLatestTheme])

  // Sync draft theme to the existing Fabric objects (throttled to 1 per frame)
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !draftTheme) return
    latestThemeRef.current = draftTheme

    if (rafIdRef.current) return // already scheduled
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      const latest = latestThemeRef.current
      const latestCanvas = fabricRef.current
      if (!latest || !latestCanvas) return
      void syncThemeToCanvas(
        latest,
        objectsRef,
        latestCanvas,
        () => {
          const current = latestThemeRef.current
          const currentCanvas = fabricRef.current
          if (!current || !currentCanvas) return
          void syncThemeToCanvas(
            current,
            objectsRef,
            currentCanvas,
            undefined,
            latestMetricsRef,
            draggingRef.current
          )
        },
        latestMetricsRef,
        draggingRef.current
      )
    })
  }, [draftTheme])

  useEffect(() => {
    const refRegion = objectsRef.current.referenceRegion
    const verseRegion = objectsRef.current.verseRegion
    if (!refRegion || !verseRegion) return
    refRegion.set({ strokeWidth: selectedElement === "reference" ? 1 : 0 })
    verseRegion.set({ strokeWidth: selectedElement === "verse" ? 1 : 0 })
    fabricRef.current?.requestRenderAll()
  }, [selectedElement])

  const zoomIn = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const newZoom = Math.min(canvas.getZoom() * 1.1, 3)
    canvas.setZoom(newZoom)
    canvas.requestRenderAll()
    resyncLatestTheme()
    setZoomLevel(Math.round(newZoom * 100))
  }, [resyncLatestTheme])

  const zoomOut = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const newZoom = Math.max(canvas.getZoom() * 0.9, 0.1)
    canvas.setZoom(newZoom)
    canvas.requestRenderAll()
    resyncLatestTheme()
    setZoomLevel(Math.round(newZoom * 100))
  }, [resyncLatestTheme])

  const elementLabel =
    selectedElement === "verse" ? "verse"
      : selectedElement === "reference" ? "reference"
        : "none"

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-foreground">
        {/* ponytail: was a button with no action; kept as a decorative mark */}
        <MousePointer2Icon aria-hidden className="size-3.5 text-muted-foreground" />
        <div className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <Grid3X3Icon className="size-3" />
          <span>Grid</span>
        </div>
        {/* Preview content: two languages by default, so second-language styling is visible while editing. */}
        <div role="radiogroup" aria-label="Preview" className="ml-3 flex rounded-md border border-border/60 p-0.5">
          {PREVIEW_TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={sample === value}
              onClick={() => {
                previewSample = value
                setSample(value)
                resyncLatestTheme()
                // The stand-in picture loads once; draw again when it is ready.
                if (value === "picture") void loadThemeImage(SAMPLE_PICTURE_URL).then(() => resyncLatestTheme())
              }}
              className={`rounded px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap ${sample === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <SearchIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="min-w-12 text-center text-[0.6875rem] font-medium tabular-nums text-muted-foreground">
          {zoomLevel}%
        </span>
        <Button variant="ghost" size="icon-xs" onClick={zoomOut} aria-label="Zoom out" title="Zoom out" className="text-muted-foreground">
          <MinusIcon className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={zoomIn} aria-label="Zoom in" title="Zoom in" className="text-muted-foreground">
          <PlusIcon className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={autoZoom} aria-label="Fit to window" title="Fit to window" className="text-muted-foreground">
          <MaximizeIcon className="size-3.5" />
        </Button>
      </div>

      {/* Canvas container */}
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasElRef} />
        {!draftTheme && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "var(--canvas-stage)" }}>
            <p className="text-xs text-muted-foreground">Select a theme to begin editing</p>
          </div>
        )}
      </div>

      {editingThemeId && <UseThemeFor themeId={editingThemeId} />}

      {/* Status bar */}
      <div className="flex h-8 shrink-0 items-center border-t border-border/40 px-3 text-[0.6875rem] text-muted-foreground bg-card">
        <span>Output: {WS_WIDTH} × {WS_HEIGHT}px</span>
        <span className="mx-2">·</span>
        <span>Zoom: {zoomLevel}%</span>
        <span className="mx-2">·</span>
        <span>Scroll to pan, pinch/Ctrl+scroll to zoom</span>
        <span className="mx-2">·</span>
        <span>
          {selectedElement ? (
            <>Editing: <span className="font-medium text-primary">{elementLabel}</span></>
          ) : (
            "Click frame to select"
          )}
        </span>
      </div>
    </div>
  )
}

/** Sync BroadcastTheme properties to existing Fabric objects */
async function syncThemeToCanvas(
  theme: BroadcastTheme,
  objectsRef: React.MutableRefObject<{
    workspace: fabric.Rect | null
    referenceRegion: fabric.Rect | null
    verseRegion: fabric.Rect | null
  }>,
  canvas: fabric.Canvas,
  onImageReady?: () => void,
  metricsRef?: React.MutableRefObject<VerseLayoutMetrics | null>,
  dragging?: "reference" | "verse" | null
) {
  const ws = objectsRef.current.workspace
  const refRegion = objectsRef.current.referenceRegion
  const verseRegion = objectsRef.current.verseRegion
  if (!ws || !refRegion || !verseRegion) return

  // Covers the frame background and every surface fill.
  preloadThemeImages(theme, onImageReady)

  const { bitmap, metrics } = renderThemeBitmap(theme)
  ws.set({
    fill: new fabric.Pattern({
      source: bitmap,
      repeat: "no-repeat",
    }),
  })

  if (!metrics) return
  if (metricsRef) metricsRef.current = metrics
  const referenceRect = metrics.referenceRect
  const verseRect = metrics.verseRect
  if (!referenceRect || !verseRect) return

  ws.setCoords()
  const wsTopLeft = ws.getPointByOrigin("left", "top")
  // In free mode the regions ARE the layout boxes, so map them 1:1 for an
  // exact drag round-trip. In stacked mode the renderer's element rects
  // already wrap the drawn text.
  const freeMode =
    theme.layout.mode === "free" &&
    metrics.referenceBoxRect &&
    metrics.verseBoxRect
  const hitRects = freeMode
    ? {
        referenceRect: metrics.referenceBoxRect!,
        verseRect: metrics.verseBoxRect!,
      }
    : { referenceRect, verseRect }
  const mappedReferenceRect = mapLocalRectToWorkspaceRect(hitRects.referenceRect, wsTopLeft)
  const mappedVerseRect = mapLocalRectToWorkspaceRect(hitRects.verseRect, wsTopLeft)

  if (dragging !== "reference") {
    refRegion.set({
      originX: "left",
      originY: "top",
      width: Math.max(24, mappedReferenceRect.width),
      height: Math.max(20, mappedReferenceRect.height),
    })
    refRegion.setPositionByOrigin(
      new fabric.Point(mappedReferenceRect.x, mappedReferenceRect.y),
      "left",
      "top"
    )
  }
  if (dragging !== "verse") {
    verseRegion.set({
      originX: "left",
      originY: "top",
      width: Math.max(24, mappedVerseRect.width),
      height: Math.max(24, mappedVerseRect.height),
    })
    verseRegion.setPositionByOrigin(
      new fabric.Point(mappedVerseRect.x, mappedVerseRect.y),
      "left",
      "top"
    )
  }
  canvas.bringObjectToFront(verseRegion)
  canvas.bringObjectToFront(refRegion)

  const selected = useBroadcastStore.getState().selectedElement
  refRegion.set({ strokeWidth: selected === "reference" ? 1 : 0 })
  verseRegion.set({ strokeWidth: selected === "verse" ? 1 : 0 })
  refRegion.setCoords()
  verseRegion.setCoords()

  canvas.requestRenderAll()
}

function mapLocalRectToWorkspaceRect(
  localRect: { x: number; y: number; width: number; height: number },
  wsTopLeft: fabric.Point
) {
  const clampedWidth = clamp(localRect.width, 0, WS_WIDTH)
  const clampedHeight = clamp(localRect.height, 0, WS_HEIGHT)
  const localX = clamp(localRect.x, 0, Math.max(0, WS_WIDTH - clampedWidth))
  const localY = clamp(localRect.y, 0, Math.max(0, WS_HEIGHT - clampedHeight))

  return {
    x: wsTopLeft.x + localX,
    y: wsTopLeft.y + localY,
    width: clampedWidth,
    height: clampedHeight,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Editor-only checkerboard so transparent backgrounds read as such (output stays truly transparent). */
function drawTransparencyCheckerboard(ctx: CanvasRenderingContext2D): void {
  const size = 40
  ctx.save()
  // Paint only behind already-rendered content: the theme render clears
  // transparent regions, so fill them from underneath.
  ctx.globalCompositeOperation = "destination-over"
  ctx.fillStyle = "#2c2c30"
  for (let y = 0; y < WS_HEIGHT; y += size) {
    for (let x = (y / size) % 2 === 0 ? 0 : size; x < WS_WIDTH; x += size * 2) {
      ctx.fillRect(x, y, size, size)
    }
  }
  ctx.fillStyle = "#232326"
  ctx.fillRect(0, 0, WS_WIDTH, WS_HEIGHT)
  ctx.restore()
}

function renderThemeBitmap(
  theme: BroadcastTheme,
): { bitmap: HTMLCanvasElement; metrics: ReturnType<typeof renderVerse> } {
  const offscreen = document.createElement("canvas")
  offscreen.width = WS_WIDTH
  offscreen.height = WS_HEIGHT
  const ctx = offscreen.getContext("2d")
  if (!ctx) return { bitmap: offscreen, metrics: null }

  const metrics = renderVerse(ctx, theme, PREVIEW_SAMPLES[previewSample], {
    imageCache: themeImageCache(),
  })
  if (theme.background.type === "transparent") {
    drawTransparencyCheckerboard(ctx)
  }
  return { bitmap: offscreen, metrics }
}

/**
 * Where the theme being edited is used: pick an output, then the kinds of
 * content that take this theme there (each kind can have its own look).
 */
function UseThemeFor({ themeId }: { themeId: string }) {
  const outputs = useBroadcastStore((s) => s.outputs)
  const [outputId, setOutputId] = useState(MAIN_OUTPUT_ID)
  const output = outputs.find((o) => o.id === outputId) ?? outputs[0]
  if (!output) return null
  const isMain = output.themeId === themeId
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/40 px-3 py-2 text-[0.6875rem] bg-card text-foreground" role="group" aria-label="Use this theme for">
      <span className="text-muted-foreground">Use this theme on</span>
      <select value={output.id} onChange={(e) => setOutputId(e.target.value)} aria-label="Output" className="h-6 rounded border border-border bg-background px-1.5 text-[0.6875rem]">
        {outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <span className="text-muted-foreground">for</span>
      {CONTENT_TYPES.map((c) => {
        const on = themeIdFor(output, c) === themeId
        const own = !!output.themeFor?.[c]
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            // The output's main theme covers every kind without its own; turning one off there means picking another theme for it in Outputs.
            disabled={isMain && !own}
            title={isMain && !own ? `This is ${output.name}'s main theme; ${CONTENT_NAMES[c]} use it unless given their own (Outputs)` : undefined}
            onClick={() => useBroadcastStore.getState().updateOutput(output.id, { themeFor: withThemeFor(output, c, on ? null : themeId) })}
            // The canvas bar is always dark: light text in either app theme.
            className={`inline-flex min-h-6 items-center rounded-full border px-2.5 ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"} disabled:cursor-default`}
          >
            {CONTENT_NAMES[c]}
          </button>
        )
      })}
      {isMain && <span className="text-muted-foreground">· the main theme of {output.name}</span>}
    </div>
  )
}

