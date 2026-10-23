import "./broadcast-fonts.css"
import { drawLowerThird, onThemeFontsLoaded, renderVerse } from "@/lib/verse-renderer"
import { drawScene, sceneMoving, sceneOverlay, sceneTicker } from "@/lib/scene-renderer"
import { drawStage } from "@/lib/stage-canvas"
import { drawTicker } from "@/lib/ticker-draw"
import { tickerReserve } from "@/lib/ticker"
import { entranceProgress } from "@/lib/lower-third-style"
import { loadThemeImage, preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import { normalizeTheme } from "@/lib/theme-migrations"
import { syncCameras, WhepPlayer } from "@/lib/whep"
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
  /** The host's clock when it sent the frame. */
  hostNow?: number
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
/** Cameras in the scene (WHEP from the church network's relay; MediaMTX allows a page to ask). */
const cameras = new Map<string, WhepPlayer>()
const whep = async (url: string, sdp: string) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: sdp })
  if (!r.ok) throw new Error(String(r.status))
  return r.text()
}
/**
 * Cameras play as video elements under the canvas, which leaves their boxes see-through: the TV's
 * own video path shows them, instead of the page copying every camera frame into the canvas (a
 * Google TV managed ~39 fps that way, #198). A cropped camera is still drawn into the canvas.
 */
const below = document.getElementById("cameras") as HTMLDivElement
const shownBelow = (id: string) => {
  const l = frame?.scene?.layers.find((x) => x.id === id)
  return !!l && !l.crop && !!cameras.get(id)?.ready
}
/** Where the canvas's picture is on screen (object-fit: contain). */
function onScreen(width: number, height: number) {
  const scale = Math.min(innerWidth / width, innerHeight / height)
  return { scale, ox: (innerWidth - width * scale) / 2, oy: (innerHeight - height * scale) / 2 }
}
function placeCameras() {
  const f = frame
  const keep = new Set<HTMLVideoElement>()
  if (f?.theme && f.scene && !f.off) {
    const { width, height } = f.theme.resolution
    const { scale, ox, oy } = onScreen(width, height)
    for (const l of f.scene.layers) {
      const p = cameras.get(l.id)
      if (l.kind !== "camera" || !p || !shownBelow(l.id)) continue
      const v = p.video
      Object.assign(v.style, { position: "absolute", objectFit: "cover", left: `${ox + (width * scale * l.box.x) / 100}px`, top: `${oy + (height * scale * l.box.y) / 100}px`, width: `${(width * scale * l.box.w) / 100}px`, height: `${(height * scale * l.box.h) / 100}px` })
      if (v.parentElement !== below) below.appendChild(v)
      keep.add(v)
    }
  }
  for (const v of [...below.querySelectorAll("video")]) if (!keep.has(v)) v.remove()
}
/**
 * The ticker crawls on a strip of its own over the canvas: moving it redraws the band only, not
 * the whole picture every frame (a Google TV dropped camera frames that way, #198). A scene with a
 * ticker layer owns the ticker (the frame then has none): it moves in its box, in the canvas.
 */
const strip = document.getElementById("ticker") as HTMLCanvasElement
const sctx = strip.getContext("2d")!
function drawStrip() {
  const f = frame
  if (!f?.ticker || f.off || !f.theme || f.role === "stage" || f.verse?.screen === "black") {
    strip.hidden = true
    return
  }
  const { width, height } = f.theme.resolution
  const h = Math.round((height * f.ticker.style.height) / 100)
  const y = f.ticker.style.position === "top" ? 0 : height - h
  if (strip.width !== width || strip.height !== h) {
    strip.width = width
    strip.height = h
  }
  const { scale, ox, oy } = onScreen(width, height)
  Object.assign(strip.style, { left: `${ox}px`, top: `${oy + y * scale}px`, width: `${width * scale}px`, height: `${h * scale}px` })
  strip.hidden = false
  sctx.setTransform(1, 0, 0, 1, 0, -y)
  sctx.clearRect(0, y, width, h)
  drawTicker(sctx, width, height, f.ticker, f.theme.verseText?.fontFamily, { imageCache: themeImageCache(), now: Date.now() })
  sctx.setTransform(1, 0, 0, 1, 0, 0)
}

addEventListener("resize", () => { placeCameras(); draw(); drawStrip() })

/** Host time minus this machine's, from the latest frame (clock layers count by the host). */
let offset = 0
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
      now: Date.now() + offset,
      imageCache: themeImageCache(),
      camera: (id) => { const p = cameras.get(id); return p?.ready ? p.video : null },
      cameraBelow: shownBelow,
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
  // A scene change fading (as on the output windows).
  if (fade) {
    const p = (performance.now() - fade.start) / fade.ms
    if (p >= 1) fade = null
    else {
      ctx.globalAlpha = 1 - p
      ctx.drawImage(fade.from, 0, 0, width, height)
      ctx.globalAlpha = 1
    }
  }
}

/** The ticker crawls and a lower third fades in (over the frame or in a scene's box): keep drawing while either moves. */
function animate() {
  const f = frame
  const picture = !!f && !f.off && (!!fade || [...cameras.entries()].some(([id, p]) => p.ready && !shownBelow(id)) || (!!f.overlay && entranceProgress(f.overlay, Date.now()) < 1) || sceneMoving(f.scene, Date.now() + offset))
  const crawl = !!f && !f.off && !!f.ticker && !f.ticker.pausedAt
  if (picture) draw()
  drawStrip()
  if (picture || crawl) requestAnimationFrame(animate)
  else ticking = false
}

let fade: { from: HTMLCanvasElement; start: number; ms: number } | null = null
let lastKey: string | null = null
let lastFade = 0

function show(next: Frame) {
  if (typeof next.hostNow === "number") offset = next.hostNow - Date.now()
  // A Take or release fades when the scene says so; Black and Logo always cut.
  const key = next.off ? "off" : next.scene?.sceneId ?? (next.verse?.screen ? "screen" : "own")
  const ms = next.scene?.fadeMs ?? lastFade
  if (lastKey !== null && key !== lastKey && ![key, lastKey].some((k) => k === "screen" || k === "off") && ms > 0 && canvas.width > 0) {
    const from = document.createElement("canvas")
    from.width = canvas.width
    from.height = canvas.height
    from.getContext("2d")?.drawImage(canvas, 0, 0)
    fade = { from, start: performance.now(), ms }
    // A hidden page gets no animation frames: still end on the new picture.
    setTimeout(() => { if (fade && performance.now() >= fade.start + fade.ms) { fade = null; draw() } }, ms + 50)
  } else if (key === "screen" || key === "off") fade = null
  lastKey = key
  lastFade = next.scene?.fadeMs ?? 0
  frame = next.theme ? { ...next, theme: normalizeTheme(next.theme), scene: next.scene ? { ...next.scene, layers: next.scene.layers.map((l) => (l.theme ? { ...l, theme: normalizeTheme(l.theme) } : l)) } : undefined } : next
  if (frame.theme) preloadThemeImages(frame.theme, draw)
  syncCameras(cameras, frame.off ? [] : (frame.scene?.layers ?? []), whep, () => { placeCameras(); draw(); if (!ticking) { ticking = true; requestAnimationFrame(animate) } })
  placeCameras()
  for (const l of frame.scene?.layers ?? []) if (l.theme) preloadThemeImages(l.theme, draw)
  // Pictures behind a scene's own ticker or lower third.
  for (const b of [sceneTicker(frame.scene)?.backing, sceneOverlay(frame.scene)?.backing]) if (b?.kind === "picture") void loadThemeImage(b.url).then(draw)
  draw()
  drawStrip()
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
