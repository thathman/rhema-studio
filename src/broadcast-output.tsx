import { ErrorBoundary } from "@/components/error-boundary"
import { createLatencyLog } from "@/lib/latency"
import { info as logInfoLine, warn as logWarnLine } from "@tauri-apps/plugin-log"
import { createVideoPlayer, type VideoPlayer } from "@/lib/output-video"
import { MAIN_OUTPUT_ID } from "@/types/broadcast-output"
import { emitTo } from "@tauri-apps/api/event"
import { initialNdiHealth, pushOutcome } from "@/lib/ndi-health"
import { createRoot } from "react-dom/client"
import { useRef, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { onThemeFontsLoaded, renderVerse, drawLowerThird } from "@/lib/verse-renderer"
import { paintFrame } from "@/lib/output-paint"
import { loadThemeImage, preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import { normalizeTheme } from "@/lib/theme-migrations"
import "./broadcast-fonts.css"
import { useState } from "react"
import type { BroadcastTheme, VerseRenderData } from "@/types/broadcast"
import type { LowerThird, NdiConfigEventPayload, StagePayload, Ticker } from "@/types"
import { drawTicker } from "@/lib/ticker-draw"
import { tickerReserve } from "@/lib/ticker"
import { entranceProgress } from "@/lib/lower-third-style"
import { StageView } from "@/components/stage-view"
import { drawStage } from "@/lib/stage-canvas"


/** Read output ID from URL query param (?output=main or ?output=alt). Defaults to "main". */
const OUTPUT_ID = new URLSearchParams(window.location.search).get("output") ?? "main"

// Tell the main window when the NDI stream dies on the network (a few pushes
// failing in a row) and when it comes back, so the operator sees it and the
// app can restart the sender. The pump itself keeps trying.
// One output window is one page, so its video player lives at module level
// (created and disposed with the window's listeners).
let videoPlayer: VideoPlayer | null = null
// The lower third's own looping video backing (silent), beside the screen's video.
let backingPlayer: VideoPlayer | null = null
// The ticker's video backing, and whether its frame loop is running.
let tickerPlayer: VideoPlayer | null = null
let tickerRunning = false
const latencyLog = createLatencyLog(`output ${OUTPUT_ID}`)
// Frames are drawn here first; see paintFrame.
const scratchCanvas = document.createElement("canvas")
// Report a drawing failure once per new screen (not every frame), and say when drawing works again.
let frameFailing = false

let ndiHealth = initialNdiHealth()
function reportNdi(ok: boolean, message: string): void {
  const r = pushOutcome(ndiHealth, ok)
  ndiHealth = r.state
  if (r.event === "trouble") void emitTo("main", "broadcast:ndi-trouble", { outputId: OUTPUT_ID, message }).catch(() => {})
  if (r.event === "recovered") void emitTo("main", "broadcast:ndi-recovered", { outputId: OUTPUT_ID }).catch(() => {})
}

interface BroadcastPayload {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  /** Lower third for this output, drawn over everything; null when hidden or not enabled here. */
  overlay?: LowerThird | null
  /** The news ticker for this output, crawling over everything; null when off or not shown here. */
  ticker?: Ticker | null
  role?: "congregation" | "stage"
  stage?: StagePayload
  /** Wall-clock ms when the main window sent this screen (latency log). */
  sentAt?: number
  /** This output plays videos' sound. */
  sound?: boolean
}

function BroadcastCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latestData = useRef<BroadcastPayload | null>(null)
  const [stage, setStage] = useState<StagePayload | null>(null)
  // The stage, also drawn on the canvas so a stage output can go out over NDI.
  const stageRef = useRef<StagePayload | null>(null)
  const ndiConfigRef = useRef<NdiConfigEventPayload>({
    active: false,
    fps: 24,
    width: 1920,
    height: 1080,
  })
  const ndiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastPushRef = useRef(0)
  const pushingRef = useRef(false)
  const pushNdiBurstRef = useRef<(() => void) | null>(null)

  const logDebug = useCallback((message: string, meta?: unknown) => {
    if (!import.meta.env.DEV) return
    if (meta === undefined) {
      console.debug(`[broadcast-output] ${message}`)
      return
    }
    console.debug(`[broadcast-output] ${message}`, meta)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    if (stageRef.current) {
      const s = stageRef.current
      paintFrame(canvas, scratchCanvas, 1920, 1080, (fctx) => drawStage(fctx, 1920, 1080, s))
      return
    }
    const data = latestData.current
    if (!data) {
      // Black screen when no data
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return
    }

    const { theme, verse } = data
    const { width, height } = theme.resolution
    const ok = paintFrame(canvas, scratchCanvas, width, height, (fctx) => {
      const result = renderVerse(fctx, theme, verse, {
        scale: 1,
        imageCache: themeImageCache(),
        video: videoPlayer?.element() ?? null,
        videoState: videoPlayer?.state(),
      })
      if (!result) {
        fctx.fillStyle = "#000"
        fctx.fillRect(0, 0, width, height)
        logDebug("renderVerse returned null; drew fallback frame")
      }
      if (data.overlay && verse?.screen !== "black") {
        drawLowerThird(fctx, width, height, data.overlay, theme.verseText?.fontFamily, {
          imageCache: themeImageCache(),
          video: backingPlayer?.element() ?? null,
          progress: entranceProgress(data.overlay, Date.now()),
          reserveBottom: tickerReserve(data.ticker, height),
        })
      }
      if (data.ticker && verse?.screen !== "black") {
        drawTicker(fctx, width, height, data.ticker, theme.verseText?.fontFamily, {
          imageCache: themeImageCache(),
          video: tickerPlayer?.element() ?? null,
          now: Date.now(),
        })
      }
    })
    if (ok !== !frameFailing) void getCurrentWebviewWindow().emitTo("main", ok ? "broadcast:render-recovered" : "broadcast:render-error", { outputId: OUTPUT_ID }).catch(() => {})
    frameFailing = !ok
  }, [logDebug])

  // Redraw once a theme's images land. The burst matters: without it NDI
  // receivers keep the flat fallback frame until the 2s keepalive fires.
  const preloadThemeAssets = useCallback((theme: BroadcastTheme) => {
    preloadThemeImages(theme, () => {
      logDebug("Theme images loaded")
      draw()
      pushNdiBurstRef.current?.()
    })
  }, [draw, logDebug])

  const pushNdiFrame = useCallback(async () => {
    if (!ndiConfigRef.current.active) return
    if (pushingRef.current) return // back-pressure: skip if already pushing
    pushingRef.current = true

    try {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const targetWidth = ndiConfigRef.current.width
      const targetHeight = ndiConfigRef.current.height

      let sourceCtx = ctx
      let sourceWidth = canvas.width
      let sourceHeight = canvas.height

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        const ndiCanvas = ndiCanvasRef.current ?? document.createElement("canvas")
        ndiCanvas.width = targetWidth
        ndiCanvas.height = targetHeight
        const ndiCtx = ndiCanvas.getContext("2d")
        if (!ndiCtx) return
        ndiCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight)
        ndiCanvasRef.current = ndiCanvas
        sourceCtx = ndiCtx
        sourceWidth = targetWidth
        sourceHeight = targetHeight
      }

      const imageData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight)
      // The pixels go as the raw request body (no base64/JSON); output and size ride in headers.
      await invoke("push_ndi_frame", new Uint8Array(imageData.data.buffer), {
        headers: { "x-ndi-output": OUTPUT_ID, "x-ndi-width": String(sourceWidth), "x-ndi-height": String(sourceHeight) },
      })
      lastPushRef.current = Date.now()
      reportNdi(true, "")
    } catch (error) {
      console.warn("[broadcast-output] push_ndi_frame failed", error)
      reportNdi(false, String(error))
    } finally {
      pushingRef.current = false
    }
  }, [])

  /** Push a burst of 3 frames after content changes (NDI receivers need a few frames to sync) */
  const pushNdiBurst = useCallback(() => {
    void pushNdiFrame()
    setTimeout(() => void pushNdiFrame(), 150)
    setTimeout(() => void pushNdiFrame(), 300)
  }, [pushNdiFrame])

  // Image loads finish after the burst that followed their theme update, and
  // the preload callback is defined above this — go through a ref so it can
  // re-burst without a definition cycle.
  useEffect(() => {
    pushNdiBurstRef.current = pushNdiBurst
  }, [pushNdiBurst])

  useEffect(() => {
    // Set initial canvas size
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, 1920, 1080)
      }
    }

    const currentWindow = getCurrentWebviewWindow()
    logDebug("Listener registration started", { label: currentWindow.label })
    const player = createVideoPlayer({
      onFrame: () => {
        draw()
        if (ndiConfigRef.current.active) void pushNdiFrame()
      },
      onEnded: () => {
        draw()
        pushNdiBurst()
      },
      onError: (name) => {
        console.warn("[broadcast-output] video failed to play:", name)
        void currentWindow.emitTo("main", "broadcast:media-error", { outputId: OUTPUT_ID, name }).catch(() => {})
        draw()
        pushNdiBurst()
      },
      // The main window says which output plays a video's sound (one only, so screens do not echo).
      allowSound: () => latestData.current?.sound ?? OUTPUT_ID === MAIN_OUTPUT_ID,
      fps: () => (ndiConfigRef.current.active ? ndiConfigRef.current.fps : 30),
    })
    videoPlayer = player
    const backing = createVideoPlayer({
      onFrame: () => {
        draw()
        if (ndiConfigRef.current.active) void pushNdiFrame()
      },
      onEnded: () => draw(),
      onError: (name) => console.warn("[broadcast-output] lower third video failed to play:", name),
      allowSound: false,
      fps: () => (ndiConfigRef.current.active ? ndiConfigRef.current.fps : 30),
    })
    backingPlayer = backing
    const tickerVideo = createVideoPlayer({
      onFrame: () => {},
      onEnded: () => {},
      onError: (name) => console.warn("[broadcast-output] ticker video failed to play:", name),
      allowSound: false,
      fps: () => (ndiConfigRef.current.active ? ndiConfigRef.current.fps : 30),
    })
    tickerPlayer = tickerVideo
    // While the ticker runs, draw every frame: on the screen's refresh, or at the NDI rate (a hidden NDI window gets no animation frames).
    const tickTicker = () => {
      if (!tickerRunning) return
      if (!latestData.current?.ticker || stageRef.current) {
        tickerRunning = false
        draw()
        return
      }
      draw()
      if (ndiConfigRef.current.active) {
        void pushNdiFrame()
        setTimeout(tickTicker, Math.round(1000 / Math.max(15, ndiConfigRef.current.fps || 30)))
      } else requestAnimationFrame(tickTicker)
    }
    // Draw the lower third's entrance frame by frame (and send each over NDI) until it is fully on.
    const animateOverlay = () => {
      draw()
      if (ndiConfigRef.current.active) void pushNdiFrame()
      const ov = latestData.current?.overlay
      if (ov && entranceProgress(ov, Date.now()) < 1) setTimeout(animateOverlay, 33)
    }
    const unlisten = currentWindow.listen<BroadcastPayload>("broadcast:verse-update", (event) => {
      if (event.payload.role === "stage") {
        videoPlayer?.sync(undefined)
        stageRef.current = event.payload.stage ?? { current: null, next: null, note: null, timer: null, message: null, band: null }
        setStage(stageRef.current)
        draw()
        pushNdiBurst()
        return
      }
      stageRef.current = null
      setStage(null)
      latestData.current = {
        ...event.payload,
        theme: normalizeTheme(event.payload.theme),
      }
      // A new screen clears the operator's warning, so a failure to draw it must be reported again.
      frameFailing = false
      videoPlayer?.sync(event.payload.verse?.video)
      const ov = event.payload.overlay
      backingPlayer?.sync(ov?.backing?.kind === "video" ? { url: ov.backing.url, fit: "cover", loop: true, sound: false, name: "lower third", token: 0 } : undefined)
      if (ov?.backing?.kind === "picture") void loadThemeImage(ov.backing.url).then(() => { draw(); pushNdiBurstRef.current?.() })
      if (ov && entranceProgress(ov, Date.now()) < 1) animateOverlay()
      const tk = event.payload.ticker
      tickerVideo.sync(tk?.backing?.kind === "video" ? { url: tk.backing.url, fit: "cover", loop: true, sound: false, name: "ticker", token: 0 } : undefined)
      if (tk?.backing?.kind === "picture") void loadThemeImage(tk.backing.url)
      if (tk && !tickerRunning) {
        tickerRunning = true
        tickTicker()
      }
      preloadThemeAssets(event.payload.theme)
      const sentAt = event.payload.sentAt
      const logLatency = () => {
        if (typeof sentAt !== "number") return
        const lines = latencyLog.record(Date.now() - sentAt)
        if (lines.warn) void logWarnLine(lines.warn).catch(() => {})
        if (lines.info) void logInfoLine(lines.info).catch(() => {})
      }
      // A picture slide is timed when the picture itself is drawn, not its placeholder.
      const picture = event.payload.verse?.image?.url
      if (picture) void loadThemeImage(picture).then(() => { draw(); pushNdiBurstRef.current?.(); logLatency() })
      logDebug("Received broadcast:verse-update", {
        hasVerse: Boolean(event.payload.verse),
        themeId: event.payload.theme.id,
      })
      draw()
      pushNdiBurst()
      // Send-to-drawn time, batched into the log file (QA-007 benchmarks read it from a diagnostics export).
      if (!picture) logLatency()
    })

    const unlistenNdiConfig = currentWindow.listen<NdiConfigEventPayload>("broadcast:ndi-config", (event) => {
      // A deliberate on/off is a fresh start for trouble counting.
      ndiHealth = initialNdiHealth()
      ndiConfigRef.current = event.payload
      logDebug("Received broadcast:ndi-config", event.payload)
      // Push burst when NDI becomes active
      if (event.payload.active) pushNdiBurst()
    })

    // Request current NDI status on mount (fixes race condition
    // where NDI is started before this window opens)
    void invoke<{ active: boolean; width: number; height: number; fps: number } | null>("get_ndi_status", { outputId: OUTPUT_ID })
      .then((status) => {
        if (status && status.active) {
          ndiConfigRef.current = {
            active: true,
            fps: status.fps,
            width: status.width,
            height: status.height,
          }
          logDebug("Fetched NDI status on mount", status)
        }
      })
      .catch(() => {
        // Command may not exist yet
      })

    // Redraw whenever a theme webfont finishes loading (the renderer requests
    // them on demand) so frames drawn against fallback metrics are replaced.
    const unsubscribeFonts = onThemeFontsLoaded(() => {
      draw()
      pushNdiBurst()
    })

    void currentWindow.emitTo("main", "broadcast:output-ready", { outputId: OUTPUT_ID }).then(() => {
      logDebug("Sent broadcast:output-ready")
    }).catch(() => {
      console.warn("[broadcast-output] failed to send output-ready event")
    })

    return () => {
      player.dispose()
      videoPlayer = null
      backing.dispose()
      backingPlayer = null
      tickerVideo.dispose()
      tickerPlayer = null
      tickerRunning = false
      unsubscribeFonts()
      unlisten.then((fn) => fn())
      unlistenNdiConfig.then((fn) => fn())
    }
  }, [draw, logDebug, preloadThemeAssets, pushNdiFrame, pushNdiBurst])

  // Slow keepalive: push one frame every 2s if idle (prevents NDI receivers from dropping the source)
  useEffect(() => {
    const timer = setInterval(() => {
      if (!ndiConfigRef.current.active) return
      const elapsed = Date.now() - lastPushRef.current
      if (elapsed > 2000) void pushNdiFrame()
    }, 2000)
    return () => clearInterval(timer)
  }, [pushNdiFrame])

  return (
    <>
      {/* A stage payload that fails to draw must not take the window's listeners with it. */}
      {stage && <ErrorBoundary name="the stage display" quiet><StageView stage={stage} /></ErrorBoundary>}
      <canvas
        ref={canvasRef}
        style={{
          width: "100vw",
          height: "100vh",
          display: stage ? "none" : "block",
          objectFit: "contain",
        }}
      />
    </>
  )
}

const root = document.getElementById("broadcast-root")!
createRoot(root).render(<BroadcastCanvas />)
