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
import { syncCameras, WhepPlayer } from "@/lib/whep"
import { paintFrame } from "@/lib/output-paint"
import { loadThemeImage, preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import { normalizeTheme } from "@/lib/theme-migrations"
import "./broadcast-fonts.css"
import { useState } from "react"
import type { BroadcastTheme, VerseRenderData } from "@/types/broadcast"
import type { LowerThird, NdiConfigEventPayload, SceneFrame, StagePayload, Ticker } from "@/types"
import { drawScene, LayerFader, sceneMoving, sceneOverlay, sceneTicker } from "@/lib/scene-renderer"
import { stopVideo, syncSceneVideos, videoReady, videosPlaying } from "@/lib/scene-videos"
import { drawTicker } from "@/lib/ticker-draw"
import { tickerReserve } from "@/lib/ticker"
import { entranceProgress } from "@/lib/lower-third-style"
import { StageView } from "@/components/stage-view"
import { drawStage } from "@/lib/stage-canvas"
import { sceneStatic } from "@/lib/no-signal"
import { outputPace } from "@/lib/output-pace"


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
// A ticker or lower third moving in a scene's box redraws the whole frame (on a screen; NDI is paced).
let sceneRunning = false
// The frame rate the Rust pacer drives this window at (0 = off); see set_output_pace.
let paceFps = 0
/** Cameras on the church network in the scene up (OP-009): one WHEP player per camera layer. */
const cameras = new Map<string, WhepPlayer>()
/** The scene's video layers (#243 SC.9): looping and silent, played from the media folder. */
const sceneVideos = new Map<string, HTMLVideoElement>()
/** Layers that cross-fade to new content (a new verse, another picture). */
const fader = new LayerFader()
// A camera or a video layer moves with every frame.
const cameraPlaying = () => [...cameras.values()].some((p) => p.ready) || videosPlaying(sceneVideos)
// Scene transitions (ARCH-002): the picture before a scene change, faded out over the new one.
let fadeFrom: HTMLCanvasElement | null = null
let fadeStart = 0
let fadeMs = 0
/** What was up: a scene's id, "own" (the output's own feed) or "screen" (Black / Logo); null before the first frame. */
let lastSceneKey: string | null = null
let lastSceneFade = 0
const playing = (p: VideoPlayer | null) => {
  const el = p?.element()
  return !!el && !el.paused && !el.ended
}
const latencyLog = createLatencyLog(`output ${OUTPUT_ID}`)
// Frames are drawn here first; see paintFrame.
const scratchCanvas = document.createElement("canvas")
// The last frame without the ticker, so a frame where only the ticker moved repaints just its band.
const baseCanvas = document.createElement("canvas")
let baseValid = false
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
  /**
   * A congregation scene (ARCH-002): drawn instead of `verse`, under the lower third and ticker. A
   * scene with its own ticker or lower-third layer arrives without `ticker` / `overlay` (it owns them).
   */
  scene?: SceneFrame
}

// A canvas per scene layer, where its look is drawn whole before it is placed.
const sceneLayerCanvases = new Map<string, HTMLCanvasElement>()
function sceneLayerCanvas(id: string): HTMLCanvasElement {
  let c = sceneLayerCanvases.get(id)
  if (!c) {
    c = document.createElement("canvas")
    sceneLayerCanvases.set(id, c)
  }
  return c
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
  // When the push in flight started: a reply that never comes must not stop NDI for good.
  const pushStartedRef = useRef(0)
  const pushNdiBurstRef = useRef<(() => void) | null>(null)
  // A scene picture that finishes loading redraws through this (draw cannot name itself).
  const redrawRef = useRef<(() => void) | null>(null)

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
      const scene = data.scene
      const result = scene
        ? (drawScene(fctx, width, height, scene, {
            imageCache: themeImageCache(),
            layerCanvas: sceneLayerCanvas,
            camera: (id) => { const p = cameras.get(id); return p?.ready ? p.video : null },
            video: (id) => { const v = sceneVideos.get(id); return videoReady(v) ? v : null },
            fader,
            tickerVideo: tickerPlayer?.element() ?? null,
            lowerThirdVideo: backingPlayer?.element() ?? null,
            image: (url) => {
              const img = themeImageCache().get(url)
              if (!img) void loadThemeImage(url).then(() => { redrawRef.current?.(); pushNdiBurstRef.current?.() })
              return img ?? null
            },
          }), true)
        : renderVerse(fctx, theme, verse, {
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
      // A scene change fading: the old picture over the new one, going.
      if (fadeFrom) {
        const p = fadeMs > 0 ? (performance.now() - fadeStart) / fadeMs : 1
        if (p >= 1) fadeFrom = null
        else {
          fctx.globalAlpha = 1 - p
          fctx.drawImage(fadeFrom, 0, 0, width, height)
          fctx.globalAlpha = 1
        }
      }
      if (data.ticker && verse?.screen !== "black") {
        if (baseCanvas.width !== width || baseCanvas.height !== height) {
          baseCanvas.width = width
          baseCanvas.height = height
        }
        const bctx = baseCanvas.getContext("2d")
        bctx?.clearRect(0, 0, width, height)
        bctx?.drawImage(fctx.canvas, 0, 0)
        baseValid = !!bctx
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

  useEffect(() => {
    redrawRef.current = draw
  }, [draw])

  /** Only the ticker moved: put back its band from the last frame and draw the ticker there. Returns its rows. */
  const drawTickerBand = useCallback((): { y: number; height: number } | null => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    const data = latestData.current
    if (!canvas || !ctx || !data?.ticker || !baseValid || baseCanvas.width !== canvas.width) {
      draw()
      return null
    }
    const { width, height } = data.theme.resolution
    const h = Math.round((height * data.ticker.style.height) / 100)
    const y = data.ticker.style.position === "top" ? 0 : height - h
    try {
      ctx.clearRect(0, y, width, h)
      ctx.drawImage(baseCanvas, 0, y, width, h, 0, y, width, h)
      drawTicker(ctx, width, height, data.ticker, data.theme.verseText?.fontFamily, {
        imageCache: themeImageCache(),
        video: tickerPlayer?.element() ?? null,
        now: Date.now(),
      })
    } catch (e) {
      console.error("[broadcast-output] ticker failed to draw", e)
    }
    return { y, height: h }
  }, [draw])

  // Redraw once a theme's images land. The burst matters: without it NDI
  // receivers keep the flat fallback frame until the 2s keepalive fires.
  const preloadThemeAssets = useCallback((theme: BroadcastTheme) => {
    preloadThemeImages(theme, () => {
      logDebug("Theme images loaded")
      draw()
      pushNdiBurstRef.current?.()
    })
  }, [draw, logDebug])

  const pushNdiFrame = useCallback(async (region?: { y: number; height: number }) => {
    if (!ndiConfigRef.current.active) return
    // Back-pressure: skip while a push is in flight, unless its reply is over a second late (lost).
    if (pushingRef.current && performance.now() - pushStartedRef.current < 1000) return
    pushingRef.current = true
    pushStartedRef.current = performance.now()

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

      if (region && sourceCtx === ctx && lastPushRef.current > 0) {
        // Only the rows that moved (a ticker's band): the whole frame is ~8 MB, and moving it
        // from the page takes ~70 ms on an Intel Mac, too slow for 30 frames a second.
        const band = sourceCtx.getImageData(0, region.y, sourceWidth, region.height)
        await invoke("push_ndi_region", new Uint8Array(band.data.buffer), {
          headers: { "x-ndi-output": OUTPUT_ID, "x-ndi-x": "0", "x-ndi-y": String(region.y), "x-ndi-width": String(sourceWidth), "x-ndi-height": String(region.height) },
        })
      } else {
        const imageData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight)
        // The pixels go as the raw request body (no base64/JSON); output and size ride in headers.
        await invoke("push_ndi_frame", new Uint8Array(imageData.data.buffer), {
          headers: { "x-ndi-output": OUTPUT_ID, "x-ndi-width": String(sourceWidth), "x-ndi-height": String(sourceHeight) },
        })
      }
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
        // While the pacer runs it sends the frames.
        if (ndiConfigRef.current.active && !paceFps) void pushNdiFrame()
      },
      onEnded: () => {
        draw()
        pushNdiBurst()
      },
      // Paused from Present: the held frame on the screen and on NDI (the frame loop has stopped).
      onPaused: () => {
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
        // While the pacer runs it sends the frames.
        if (ndiConfigRef.current.active && !paceFps) void pushNdiFrame()
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
    // A camera in the scene that is not sending shows moving static (when the scene says so).
    const staticShown = () => !stageRef.current && sceneStatic(latestData.current?.scene, (id) => !!cameras.get(id)?.ready)
    // What is moving: only the ticker (its band is all that changes), or more (an entrance, a video).
    const motion = (): "ticker" | "full" | null => {
      const d = latestData.current
      if (!d || stageRef.current) return null
      if (fadeFrom || fader.busy() || cameraPlaying() || staticShown() || sceneMoving(d.scene, Date.now()) || (d.overlay && entranceProgress(d.overlay, Date.now()) < 1) || playing(videoPlayer) || playing(backingPlayer)) return "full"
      return d.ticker && !d.ticker.pausedAt ? "ticker" : null
    }
    // An NDI window is hidden, and WebKit runs a hidden page's timers about once a second: while
    // something moves, a pacer in Rust sends `broadcast:pace` at the NDI rate and each one draws a frame.
    // A running clock layer needs one frame a second, on a screen too (a covered or locked screen's
    // timers are held back for many seconds).
    const clockRunning = () => !stageRef.current && !!latestData.current?.scene?.layers.some((l) => l.kind === "clock" && l.clock && l.clock.mode !== "still")
    const syncPace = () => {
      // A camera moves with every frame: the pacer draws it on screens too (a covered or locked
      // window gets no animation frames). A running clock needs one a second.
      // A camera showing static moves NOISE_FPS times a second, and only while it shows.
      const fps = outputPace({ ndi: ndiConfigRef.current.active, ndiFps: ndiConfigRef.current.fps, moving: !!motion(), cameraPlaying: cameraPlaying(), fading: fader.busy(), staticShown: staticShown(), clockRunning: clockRunning() })
      if (fps === paceFps) return
      paceFps = fps
      void logInfoLine(`[pace] output ${OUTPUT_ID}: ${fps ? `${fps} frames a second` : "stopped"}`).catch(() => {})
      void invoke("set_output_pace", { outputId: OUTPUT_ID, fps }).catch((e) => {
        console.warn("[broadcast-output] set_output_pace failed", e)
        paceFps = 0
      })
    }
    const unlistenPace = currentWindow.listen("broadcast:pace", () => {
      const d = latestData.current
      const band = motion() === "ticker" && d?.verse?.screen !== "black" ? drawTickerBand() : (draw(), null)
      void pushNdiFrame(band ?? undefined)
      syncPace()
    })
    // On a screen (not NDI): the ticker moves on the display's refresh.
    const tickTicker = () => {
      if (!tickerRunning) return
      if (!latestData.current?.ticker || latestData.current.ticker.pausedAt || stageRef.current || ndiConfigRef.current.active) {
        tickerRunning = false
        draw()
        return
      }
      drawTickerBand()
      requestAnimationFrame(tickTicker)
    }
    // A lower third's entrance on a screen; over NDI the pacer draws it.
    const animateOverlay = () => {
      if (ndiConfigRef.current.active) return
      draw()
      const ov = latestData.current?.overlay
      if (ov && entranceProgress(ov, Date.now()) < 1) requestAnimationFrame(animateOverlay)
    }
    const camerasChanged = () => {
      draw()
      syncPace()
    }
    // A ticker or lower third moving in a scene's box, on a screen; over NDI the pacer draws it.
    const animateScene = () => {
      if (!sceneRunning) return
      if (ndiConfigRef.current.active || stageRef.current || !sceneMoving(latestData.current?.scene, Date.now())) {
        sceneRunning = false
        draw()
        return
      }
      draw()
      requestAnimationFrame(animateScene)
    }
    // A scene fade on a screen; over NDI the pacer draws it.
    const animateFade = () => {
      if (ndiConfigRef.current.active) return
      draw()
      if (fadeFrom) requestAnimationFrame(animateFade)
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
      // A Take or release fades when the scene says so; Black and Logo always cut.
      const sceneKey = event.payload.scene?.sceneId ?? (event.payload.verse?.screen ? "screen" : "own")
      if (lastSceneKey !== null && sceneKey !== lastSceneKey && sceneKey !== "screen" && lastSceneKey !== "screen") {
        const ms = event.payload.scene?.fadeMs ?? lastSceneFade
        const canvas = canvasRef.current
        if (ms > 0 && canvas && canvas.width > 0) {
          const snap = document.createElement("canvas")
          snap.width = canvas.width
          snap.height = canvas.height
          snap.getContext("2d")?.drawImage(canvas, 0, 0)
          fadeFrom = snap
          fadeStart = performance.now()
          fadeMs = ms
        }
      } else if (sceneKey === "screen") fadeFrom = null
      lastSceneKey = sceneKey
      lastSceneFade = event.payload.scene?.fadeMs ?? 0
      latestData.current = {
        ...event.payload,
        theme: normalizeTheme(event.payload.theme),
        ...(event.payload.scene ? { scene: { ...event.payload.scene, layers: event.payload.scene.layers.map((l) => (l.theme ? { ...l, theme: normalizeTheme(l.theme) } : l)) } } : {}),
      }
      for (const l of latestData.current.scene?.layers ?? []) if (l.theme) preloadThemeImages(l.theme, () => { draw(); pushNdiBurstRef.current?.() })
      // The scene's cameras: start new ones, stop the ones it no longer has.
      syncCameras(cameras, latestData.current.scene?.layers ?? [], (url, sdp) => invoke<string>("whep_offer", { url, sdp }), camerasChanged)
      // Its videos, the same way: each one starts when the scene comes up and stops when it goes.
      syncSceneVideos(sceneVideos, latestData.current.scene?.layers ?? [], (l) => l.videoUrl, camerasChanged)
      // A new screen clears the operator's warning, so a failure to draw it must be reported again.
      frameFailing = false
      videoPlayer?.sync(event.payload.verse?.video)
      // The lower third and ticker over the whole frame, or in a scene's own boxes.
      const ov = event.payload.overlay ?? sceneOverlay(event.payload.scene)
      backingPlayer?.sync(ov?.backing?.kind === "video" ? { url: ov.backing.url, fit: "cover", loop: true, sound: false, name: "lower third", token: 0 } : undefined)
      if (ov?.backing?.kind === "picture") void loadThemeImage(ov.backing.url).then(() => { draw(); pushNdiBurstRef.current?.() })
      if (event.payload.overlay && entranceProgress(event.payload.overlay, Date.now()) < 1) animateOverlay()
      if (fadeFrom) {
        animateFade()
        // A covered or locked window gets no animation frames: still end on the new picture.
        const ends = fadeStart + fadeMs
        setTimeout(() => { if (fadeFrom && performance.now() >= ends) { fadeFrom = null; draw(); pushNdiBurstRef.current?.() } }, fadeMs + 50)
      }
      const tk = event.payload.ticker ?? sceneTicker(event.payload.scene)
      tickerVideo.sync(tk?.backing?.kind === "video" ? { url: tk.backing.url, fit: "cover", loop: true, sound: false, name: "ticker", token: 0 } : undefined)
      if (tk?.backing?.kind === "picture") void loadThemeImage(tk.backing.url)
      if (event.payload.ticker && !event.payload.ticker.pausedAt && !tickerRunning && !ndiConfigRef.current.active) {
        tickerRunning = true
        tickTicker()
      }
      if (sceneMoving(event.payload.scene, Date.now()) && !sceneRunning && !ndiConfigRef.current.active) {
        sceneRunning = true
        animateScene()
      }
      syncPace()
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
      // A layer that began a cross-fade in that drawing keeps the pacer drawing until it is done.
      syncPace()
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
      syncPace()
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
          // NDI started before this window was ready: anything already moving needs the pacer.
          syncPace()
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
      if (paceFps) void invoke("set_output_pace", { outputId: OUTPUT_ID, fps: 0 }).catch(() => {})
      paceFps = 0
      unlistenPace.then((fn) => fn())
      unsubscribeFonts()
      for (const p of cameras.values()) p.close()
      cameras.clear()
      for (const v of sceneVideos.values()) stopVideo(v)
      sceneVideos.clear()
      unlisten.then((fn) => fn())
      unlistenNdiConfig.then((fn) => fn())
    }
  }, [draw, drawTickerBand, logDebug, preloadThemeAssets, pushNdiFrame, pushNdiBurst])

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
