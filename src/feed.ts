import "./broadcast-fonts.css"
import { drawLowerThird, onThemeFontsLoaded, renderVerse } from "@/lib/verse-renderer"
import { drawScene, drawTickerLayer, LayerFader, sceneOverlay } from "@/lib/scene-renderer"
import { syncSceneVideos, videoReady } from "@/lib/scene-videos"
import { feedMotion, feedNext, tickerStrips } from "@/lib/feed-motion"
import { noiseFrame } from "@/lib/no-signal"
import { drawStage, stageSurface } from "@/lib/stage-canvas"
import { CountdownFade, nextChangeIn } from "@/lib/countdown-display"
import { feedStale, pageClockSkew } from "@/lib/feed-freshness"
import { drawTicker } from "@/lib/ticker-draw"
import { tickerReserve } from "@/lib/ticker"
import { entranceProgress } from "@/lib/lower-third-style"
import { loadThemeImage, preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import { normalizeTheme } from "@/lib/theme-migrations"
import { cameraReports, syncCameras, WhepPlayer } from "@/lib/whep"
import type { BroadcastTheme, VerseRenderData } from "@/types/broadcast"
import type { LowerThird, SceneFrame, StagePayload, Ticker } from "@/types"

/**
 * A browser feed (ARCH-002): an output drawn by a web page on the church network, for OBS Browser
 * Source or a TV's browser. The same drawing code as the output windows; frames arrive as server-
 * sent events from the host (`/api/v1/feed/<id>/events?k=<secret>`). A keyed look stays transparent.
 * A video item does not play here (its file is on the host computer); a scene's video layer does,
 * from the host (`/api/v1/feed/<id>/media/<file>`, only while the feed shows it).
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
/** The scene's video layers (#243 SC.9), looping and silent, shown under the canvas like the cameras. */
const videos = new Map<string, HTMLVideoElement>()
/** Layers that cross-fade to new content (a new verse, another picture). */
const fader = new LayerFader()
const shownBelow = (id: string) => {
  const l = frame?.scene?.layers.find((x) => x.id === id)
  if (!l || l.crop) return false
  return l.kind === "video" ? videoReady(videos.get(id)) : !!cameras.get(id)?.ready
}
/** The element the page shows under the canvas for a layer: its camera's or its video's. */
const belowElement = (id: string) => videos.get(id) ?? cameras.get(id)?.video
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
    const order: HTMLVideoElement[] = []
    for (const l of f.scene.layers) {
      const v = belowElement(l.id)
      if ((l.kind !== "camera" && l.kind !== "video") || !v || !shownBelow(l.id)) continue
      Object.assign(v.style, { position: "absolute", objectFit: "cover", opacity: String(l.opacity), left: `${ox + (width * scale * l.box.x) / 100}px`, top: `${oy + (height * scale * l.box.y) / 100}px`, width: `${(width * scale * l.box.w) / 100}px`, height: `${(height * scale * l.box.h) / 100}px` })
      order.push(v)
      keep.add(v)
    }
    // Bottom layer first. Moved only when the order is wrong, so a playing video is not disturbed.
    const now = [...below.querySelectorAll("video")].filter((v) => keep.has(v))
    if (now.length !== order.length || order.some((v, i) => now[i] !== v)) for (const v of order) below.appendChild(v)
  }
  for (const v of [...below.querySelectorAll("video")]) if (!keep.has(v)) v.remove()
}
/**
 * The ticker crawls on a strip of its own over the canvas: moving it redraws the band only, not
 * the whole picture every frame (a Google TV dropped camera frames that way, #198). A scene with a
 * ticker layer owns the ticker (the frame then has none): see the scene's strips below.
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

/**
 * A scene's ticker layer crawls the same way, on a strip of its own in its box, when it is the
 * top-most layer there (`tickerStrips`; otherwise it stays in the canvas, in its place). The strip
 * is painted by the same code as the canvas would, at the layer's opacity. Not during a scene
 * cross-fade: the canvas draws the ticker then, so it fades with the rest of the picture.
 */
const sceneStrips = new Map<string, HTMLCanvasElement>()
let stripped = new Set<string>()
const onStrips = (): ReadonlySet<string> => (fade ? new Set() : stripped)
function drawSceneStrips() {
  const f = frame
  const on = f && !f.off && f.theme && f.role !== "stage" && f.scene ? onStrips() : new Set<string>()
  for (const [id, c] of sceneStrips) if (!on.has(id)) { c.remove(); sceneStrips.delete(id) }
  if (!f?.theme || !f.scene || on.size === 0) return
  const { width, height } = f.theme.resolution
  const { scale, ox, oy } = onScreen(width, height)
  const now = Date.now() + offset
  // Top layer first, so each strip goes just under the one above it (all under the full-frame
  // ticker's strip); the page is only changed when something moved.
  let next: Element = strip
  for (const l of [...f.scene.layers].reverse()) {
    if (!on.has(l.id)) continue
    let c = sceneStrips.get(l.id)
    if (!c) {
      sceneStrips.set(l.id, (c = document.createElement("canvas")))
      c.style.position = "fixed"
    }
    if (c.nextElementSibling !== next) document.body.insertBefore(c, next)
    next = c
    const x = (width * l.box.x) / 100, y = (height * l.box.y) / 100, bw = (width * l.box.w) / 100, bh = (height * l.box.h) / 100
    const w = Math.max(1, Math.round(bw)), h = Math.max(1, Math.round(bh))
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const place = { left: `${ox + x * scale}px`, top: `${oy + y * scale}px`, width: `${bw * scale}px`, height: `${bh * scale}px`, opacity: String(l.opacity), display: l.opacity > 0 ? "block" : "none" }
    const key = Object.values(place).join(" ")
    if (c.dataset.place !== key) {
      Object.assign(c.style, place)
      c.dataset.place = key
    }
    const cx = c.getContext("2d")
    if (!cx || l.opacity <= 0) continue
    cx.clearRect(0, 0, w, h)
    drawTickerLayer(cx, w, h, l, height, { imageCache: themeImageCache(), now })
  }
}
/** Both kinds of strip. */
function drawStrips() {
  drawStrip()
  drawSceneStrips()
}
const redraw = () => { draw(); drawStrips() }

addEventListener("resize", () => { placeCameras(); redraw() })

/** Host time minus this machine's, from the latest frame (clock layers count by the host). */
let offset = 0
let ticking = false

/** A countdown display (Design → Countdown): its blend between steps, and whether it moves now. */
const countdownFade = new CountdownFade()
let countdownMoving = false
let countdownTimer: ReturnType<typeof setTimeout> | null = null
/** Redraw a counting countdown display as its time changes: once a second, on the second (no animation frames). */
function scheduleCountdown() {
  if (countdownTimer) clearTimeout(countdownTimer)
  countdownTimer = null
  const c = frame && !frame.off && frame.role === "stage" ? frame.stage?.countdown : undefined
  if (!c) return
  const wait = Math.min(nextChangeIn(c, Date.now() + offset), c.look.showClock ? 1000 : Infinity)
  if (!Number.isFinite(wait)) return
  countdownTimer = setTimeout(() => {
    draw()
    scheduleCountdown()
    if (countdownMoving && !ticking) { ticking = true; requestAnimationFrame(animate) }
  }, wait + 5)
}

function draw() {
  const f = frame
  // A cross-fade that has run its time: done (the scene's tickers go back on their strips).
  if (fade && performance.now() - fade.start >= fade.ms) fade = null
  if (!f || f.off || !f.theme) {
    canvas.width = canvas.width || 1920
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    return
  }
  if (f.role === "stage" && f.stage) {
    // A browser on a tall screen (a TV app or tablet set to portrait) gets a tall picture (#196 R6).
    const { width: sw, height: sh } = stageSurface(f.stage, innerWidth, innerHeight)
    if (canvas.width !== sw || canvas.height !== sh) {
      canvas.width = sw
      canvas.height = sh
    }
    // A countdown display counts by the host's clock, blending between its colour steps.
    countdownMoving = drawStage(ctx, sw, sh, f.stage, { now: Date.now() + offset, fade: countdownFade }).moving
    return
  }
  countdownMoving = false
  const { width, height } = f.theme.resolution
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  ctx.clearRect(0, 0, width, height)
  if (f.scene) {
    const strips = onStrips()
    drawScene(ctx, width, height, f.scene, {
      now: Date.now() + offset,
      imageCache: themeImageCache(),
      camera: (id) => { const p = cameras.get(id); return p?.ready ? p.video : null },
      video: (id) => { const v = videos.get(id); return videoReady(v) ? v : null },
      cameraBelow: shownBelow,
      fader,
      tickerAbove: (id) => strips.has(id),
      layerCanvas: (id) => {
        let c = layers.get(id)
        if (!c) layers.set(id, (c = document.createElement("canvas")))
        return c
      },
      image: (url) => {
        const img = themeImageCache().get(url)
        if (!img) void loadThemeImage(url).then(redraw)
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
  // A scene change fading (as on the output windows). It ends at the top of the next picture, so
  // that picture is drawn without the tickers that go back on their strips.
  const p = fade ? (performance.now() - fade.start) / fade.ms : 1
  if (fade && p < 1) {
    ctx.globalAlpha = 1 - p
    ctx.drawImage(fade.from, 0, 0, width, height)
    ctx.globalAlpha = 1
  }
}

/** The static picture last drawn (a camera not sending that shows static). */
let lastNoise = -1

/**
 * Keep drawing while something moves: the whole picture only while it changes (a fade, a camera in
 * the canvas, a lower third coming in, a ticker that has to stay in the canvas, a camera's static
 * a few times a second); the strips every frame. A ticker on a strip leaves the main canvas still.
 */
function animate() {
  const f = frame
  const inCanvas = [...cameras.entries()].some(([id, p]) => p.ready && !shownBelow(id)) || [...videos.entries()].some(([id, v]) => videoReady(v) && !v.paused && !shownBelow(id))
  const hostNow = Date.now() + offset
  const motion = feedMotion(f, { now: Date.now(), hostNow, fading: !!fade || fader.busy(), cameraInCanvas: inCanvas, strips: onStrips(), playing: (id) => !!cameras.get(id)?.ready, countdown: countdownMoving })
  const n = noiseFrame(hostNow)
  if (motion.picture || (motion.noise && n !== lastNoise)) {
    draw()
    lastNoise = n
  }
  drawStrips()
  const next = feedNext(motion, hostNow)
  if (next === "frame") requestAnimationFrame(animate)
  else if (next !== null) setTimeout(() => requestAnimationFrame(animate), next)
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
    const fctx = from.getContext("2d")
    fctx?.drawImage(canvas, 0, 0)
    // The scene's tickers on strips are part of the picture going out.
    const sf = frame?.scene
    if (fctx && sf) for (const l of sf.layers) {
      const c = sceneStrips.get(l.id)
      if (!c || l.opacity <= 0) continue
      fctx.globalAlpha = l.opacity
      fctx.drawImage(c, (canvas.width * l.box.x) / 100, (canvas.height * l.box.y) / 100, (canvas.width * l.box.w) / 100, (canvas.height * l.box.h) / 100)
    }
    if (fctx) fctx.globalAlpha = 1
    fade = { from, start: performance.now(), ms }
    // A hidden page gets no animation frames: still end on the new picture.
    setTimeout(() => { if (fade && performance.now() >= fade.start + fade.ms) { fade = null; redraw() } }, ms + 50)
  } else if (key === "screen" || key === "off") fade = null
  lastKey = key
  lastFade = next.scene?.fadeMs ?? 0
  frame = next.theme ? { ...next, theme: normalizeTheme(next.theme), scene: next.scene ? { ...next.scene, layers: next.scene.layers.map((l) => (l.theme ? { ...l, theme: normalizeTheme(l.theme) } : l)) } : undefined } : next
  stripped = tickerStrips(frame.scene, !!frame.overlay && frame.verse?.screen !== "black")
  if (frame.theme) preloadThemeImages(frame.theme, draw)
  const moved = () => { placeCameras(); draw(); if (!ticking) { ticking = true; requestAnimationFrame(animate) } }
  syncCameras(cameras, frame.off ? [] : (frame.scene?.layers ?? []), whep, moved)
  // A video layer's file comes from the host, which serves it only while this feed shows it.
  syncSceneVideos(videos, frame.off ? [] : (frame.scene?.layers ?? []), (l) => (l.mediaFile ? `/api/v1/feed/${encodeURIComponent(id)}/media/${l.mediaFile}?k=${encodeURIComponent(key)}` : undefined), moved)
  placeCameras()
  for (const l of frame.scene?.layers ?? []) if (l.theme) preloadThemeImages(l.theme, draw)
  // Pictures behind a scene's own tickers or lower third (a ticker may be on its strip).
  const backings = [...(frame.scene?.layers.filter((l) => l.kind === "ticker").map((l) => l.ticker?.backing) ?? []), sceneOverlay(frame.scene)?.backing]
  for (const b of backings) if (b?.kind === "picture") void loadThemeImage(b.url).then(redraw)
  draw()
  drawStrips()
  scheduleCountdown()
  if (!ticking) {
    ticking = true
    requestAnimationFrame(animate)
  }
}

onThemeFontsLoaded(redraw)
// A running clock layer: redraw each second.
setInterval(() => {
  if (frame?.scene?.layers.some((l) => l.kind === "clock" && l.clock && l.clock.mode !== "still")) draw()
}, 1000)
const id = decodeURIComponent(location.pathname.split("/").pop() ?? "")
const key = new URLSearchParams(location.search).get("k") ?? ""
/** The newest frame this page drew (what it acknowledged). */
let drawnSeq = 0
const ack = (body: object) => fetch(`/api/v1/feed/${encodeURIComponent(id)}/ack?k=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {})
/**
 * While the scene plays cameras, tell the host every 2 s how they really play here (#213): frames a
 * second, decoded and dropped, the last new frame's age. Measured on this screen, sent with the
 * acknowledgement of the frame drawn last.
 */
setInterval(() => {
  if (drawnSeq > 0 && cameras.size > 0) void ack({ seq: drawnSeq, video: cameraReports(cameras) })
}, 2000)
// EventSource reconnects by itself; the host sends the current frame first.
const events = new EventSource(`/api/v1/feed/${encodeURIComponent(id)}/events?k=${encodeURIComponent(key)}`)

/**
 * Out of date (#196): when the host has not been heard (no frame, no beat) for a while, a small
 * "Not updating" mark in a corner, so a still picture or a stopped timer is not taken for live.
 */
let lastHeard = performance.now()
let beats = false
let beatCount = 0
const staleMark = document.createElement("div")
staleMark.setAttribute("role", "status")
staleMark.textContent = "Not updating"
Object.assign(staleMark.style, { position: "fixed", top: "1.2vh", right: "1.2vw", padding: "0.4vh 0.8vw", borderRadius: "0.6vh", background: "rgba(0,0,0,0.6)", color: "#ffc547", font: "600 1.6vh system-ui, sans-serif", zIndex: "10", display: "none", pointerEvents: "none" })
document.body.appendChild(staleMark)
const heard = () => { lastHeard = performance.now(); checkStale() }
function checkStale() {
  const stale = feedStale({ now: performance.now(), lastHeard, beats, connected: events.readyState === EventSource.OPEN })
  const show = stale ? "block" : "none"
  if (staleMark.style.display !== show) staleMark.style.display = show
}
setInterval(checkStale, 1000)
events.addEventListener("error", checkStale)
// The host's clock, between frames: count by it, and tell the host how far this screen's clock is off (it warns over 2 s).
events.addEventListener("beat", (e) => {
  const hostNow = Number((e as MessageEvent<string>).data)
  if (!Number.isFinite(hostNow)) return
  beats = true
  heard()
  offset = hostNow - Date.now()
  if (drawnSeq > 0 && beatCount++ % 2 === 0) void ack({ seq: drawnSeq, clock: pageClockSkew(hostNow, Date.now()) })
})
events.addEventListener("frame", (e) => {
  heard()
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
      drawnSeq = seq
      void ack({ seq })
    })
  }
})
