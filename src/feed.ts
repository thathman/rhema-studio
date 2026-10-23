import "./broadcast-fonts.css"
import { drawLowerThird, onThemeFontsLoaded, renderVerse } from "@/lib/verse-renderer"
import { drawScene } from "@/lib/scene-renderer"
import { drawStage } from "@/lib/stage-canvas"
import { drawTicker } from "@/lib/ticker-draw"
import { tickerReserve } from "@/lib/ticker"
import { entranceProgress } from "@/lib/lower-third-style"
import { loadThemeImage, preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import { normalizeTheme } from "@/lib/theme-migrations"
import type { BroadcastTheme, VerseRenderData } from "@/types/broadcast"
import type { LowerThird, SceneFrame, StagePayload, Ticker } from "@/types"

/**
 * A browser feed (ARCH-002): an output drawn by a web page on the church network, for OBS Browser
 * Source or a TV's browser. The same drawing code as the output windows; frames arrive as server-
 * sent events from the host (`/api/v1/feed/<id>/events?k=<secret>`). A keyed look stays transparent.
 * Videos do not play here (their files are on the host computer).
 */
interface Frame {
  off?: boolean
  theme?: BroadcastTheme
  verse?: VerseRenderData | null
  overlay?: LowerThird | null
  ticker?: Ticker | null
  scene?: SceneFrame
  role?: "congregation" | "stage"
  stage?: StagePayload
}

const canvas = document.getElementById("feed") as HTMLCanvasElement
const ctx = canvas.getContext("2d")!
const layers = new Map<string, HTMLCanvasElement>()
let frame: Frame | null = null
let ticking = false

function draw() {
  const f = frame
  if (!f || f.off || !f.theme) {
    canvas.width = canvas.width || 1920
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    return
  }
  if (f.role === "stage" && f.stage) {
    canvas.width = 1920
    canvas.height = 1080
    drawStage(ctx, 1920, 1080, f.stage)
    return
  }
  const { width, height } = f.theme.resolution
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  ctx.clearRect(0, 0, width, height)
  if (f.scene) {
    drawScene(ctx, width, height, f.scene, {
      imageCache: themeImageCache(),
      layerCanvas: (id) => {
        let c = layers.get(id)
        if (!c) layers.set(id, (c = document.createElement("canvas")))
        return c
      },
      image: (url) => {
        const img = themeImageCache().get(url)
        if (!img) void loadThemeImage(url).then(draw)
        return img ?? null
      },
    })
  } else {
    // No video element here: a video item shows its theme only.
    renderVerse(ctx, f.theme, f.verse?.video ? { ...f.verse, video: undefined } : (f.verse ?? null), { scale: 1, imageCache: themeImageCache() })
  }
  if (f.overlay && f.verse?.screen !== "black") {
    drawLowerThird(ctx, width, height, f.overlay, f.theme.verseText?.fontFamily, { imageCache: themeImageCache(), progress: entranceProgress(f.overlay, Date.now()), reserveBottom: tickerReserve(f.ticker, height) })
  }
  if (f.ticker && f.verse?.screen !== "black") drawTicker(ctx, width, height, f.ticker, f.theme.verseText?.fontFamily, { imageCache: themeImageCache(), now: Date.now() })
}

/** The ticker crawls and a lower third fades in: keep drawing while either moves. */
function animate() {
  const f = frame
  const moving = !!f && !f.off && ((!!f.ticker && !f.ticker.pausedAt) || (!!f.overlay && entranceProgress(f.overlay, Date.now()) < 1))
  draw()
  if (moving) requestAnimationFrame(animate)
  else ticking = false
}

function show(next: Frame) {
  frame = next.theme ? { ...next, theme: normalizeTheme(next.theme), scene: next.scene ? { ...next.scene, layers: next.scene.layers.map((l) => (l.theme ? { ...l, theme: normalizeTheme(l.theme) } : l)) } : undefined } : next
  if (frame.theme) preloadThemeImages(frame.theme, draw)
  for (const l of frame.scene?.layers ?? []) if (l.theme) preloadThemeImages(l.theme, draw)
  if (!ticking) {
    ticking = true
    requestAnimationFrame(animate)
  }
}

onThemeFontsLoaded(draw)
// A running clock layer: redraw each second.
setInterval(() => {
  if (frame?.scene?.layers.some((l) => l.kind === "clock" && l.clock && l.clock.mode !== "still")) draw()
}, 1000)
const id = decodeURIComponent(location.pathname.split("/").pop() ?? "")
const key = new URLSearchParams(location.search).get("k") ?? ""
// EventSource reconnects by itself; the host sends the current frame first.
const events = new EventSource(`/api/v1/feed/${encodeURIComponent(id)}/events?k=${encodeURIComponent(key)}`)
events.addEventListener("frame", (e) => {
  const ev = e as MessageEvent<string>
  try {
    show(JSON.parse(ev.data) as Frame)
  } catch {
    // A frame this page cannot read: keep the last one (and do not say it was drawn).
    return
  }
  // Tell the host this frame is on this screen (receiver trust), after it is drawn.
  const seq = Number(ev.lastEventId)
  if (Number.isFinite(seq) && seq > 0) {
    requestAnimationFrame(() => {
      void fetch(`/api/v1/feed/${encodeURIComponent(id)}/ack?k=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seq }) }).catch(() => {})
    })
  }
})
