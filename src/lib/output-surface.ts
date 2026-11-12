/**
 * Watch an output window's drawing surface (#873). WebKit can lose a hidden window's canvas (its
 * context or its backing store, under memory pressure): every later draw then lands nowhere and the
 * screen, NDI and a recording pinned to the output go fully transparent while the app still says a
 * scene is up. This notices it, has the window rebuild its canvas, and says so to the host.
 *
 * Three signals:
 * - the canvas's own `contextlost` event (and `isContextLost()`, where WebKit has them);
 * - after a real redraw of a frame that certainly covers the whole canvas with something opaque
 *   (see frameMustBeOpaque), one read of a 1-pixel strip across the middle: all of it fully
 *   transparent means the drawing never landed. At most once a second, never per frame;
 * - the same read every few seconds while such a frame is held and nothing redraws (a held scene in
 *   a hidden window): WebKit can drop an idle hidden canvas's backing store long after its last
 *   draw, and a check that only follows draws never sees it (CI run 43297534893: a baseline scene
 *   drawn at 20:28:58, idle while Design was used, read [0,0,0,0] at 20:29:33 with no rebuild).
 *
 * Never loops: a few rebuilds that do not hold back off (5 s, doubling up to 5 min), report a
 * failure once, and try again when the wait is over (a held verse draws nothing by itself).
 */

/** At most one read-back check this often (ms). */
export const SURFACE_CHECK_MS = 1000
/** How often a held frame (nothing redrawing) is checked (ms); see SurfaceWatch.whileHeld. */
export const SURFACE_HELD_CHECK_MS = 2000
/** Rebuilds in a row (no healthy check between) before backing off. */
export const SURFACE_MAX_STRIKES = 3
export const SURFACE_BACKOFF_MS = 5000
export const SURFACE_BACKOFF_MAX_MS = 5 * 60_000

export type SurfaceProblem = "context-lost" | "blank"

export type SurfaceEvent =
  | { kind: "rebuilt"; reason: SurfaceProblem; at: number }
  | { kind: "failed"; reason: SurfaceProblem; at: number; retryInMs: number }
  /** A check passed after a failure. */
  | { kind: "recovered"; at: number }
  /** After a failure, the output now shows a frame that is not checked (a keyed look): no longer known to be failing. */
  | { kind: "unchecked"; at: number }

/** What is wrong with this canvas, or null when it holds a drawing. Only call it after an opaque frame. */
export function surfaceProblem(canvas: HTMLCanvasElement): SurfaceProblem | null {
  if (canvas.width <= 0 || canvas.height <= 0) return null
  let ctx: CanvasRenderingContext2D | null
  try {
    ctx = canvas.getContext("2d")
  } catch {
    return "context-lost"
  }
  if (!ctx) return "context-lost"
  const lost = (ctx as CanvasRenderingContext2D & { isContextLost?: () => boolean }).isContextLost
  if (typeof lost === "function" && lost.call(ctx)) return "context-lost"
  let data: Uint8ClampedArray
  try {
    // One read: a 1-pixel strip across the middle (a frame that must be opaque is opaque everywhere).
    data = ctx.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data
  } catch (e) {
    // A tainted canvas (a cross-origin picture) cannot be read, but it is drawing: not a lost surface.
    if (e instanceof Error && e.name === "SecurityError") return null
    return "context-lost"
  }
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return null
  return "blank"
}

/** Whether a CSS colour is certainly visible (alpha at least 1/255); unknown forms count as not. */
export function colourOpaque(colour: string | undefined | null): boolean {
  const c = (colour ?? "").trim().toLowerCase()
  if (!c || c === "transparent" || c.includes("var(")) return false
  const hex = /^#([0-9a-f]{3,8})$/.exec(c)
  if (hex) {
    const h = hex[1]
    if (h.length === 3 || h.length === 6) return true
    if (h.length === 4) return parseInt(h[3] + h[3], 16) > 0
    if (h.length === 8) return parseInt(h.slice(6), 16) > 0
    return false
  }
  const fn = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((.*)\)$/.exec(c)
  if (fn) {
    const body = fn[2]
    // "r g b / a" or "r, g, b, a" (and the same for the other functions).
    const slash = body.split("/")
    const parts = body.split(",")
    const alpha = slash.length === 2 ? slash[1] : parts.length === 4 ? parts[3] : null
    if (alpha === null) return true
    const a = alpha.trim()
    const v = a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a)
    return Number.isFinite(v) && v * 255 >= 1
  }
  // A named colour.
  return /^[a-z]+$/.test(c)
}

interface ThemeLike {
  background?: { type?: string; color?: string; gradient?: { stops?: { color: string }[] } | null }
  layout?: { backgroundWidth?: number; backgroundHeight?: number; offsetX?: number; offsetY?: number }
}
interface SceneLike {
  background: string
  backgroundGradient?: { stops?: { color: string }[] } | unknown
}

const gradientOpaque = (g: { stops?: { color: string }[] } | null | undefined): boolean =>
  !!g?.stops?.length && g.stops.every((s) => colourOpaque(s.color))

/**
 * Whether the frame just drawn certainly covers the whole canvas with something opaque, so a fully
 * transparent read means a lost surface. Conservative: a theme's background counts only when it is
 * a visible colour or gradient filling the whole frame (a band, a see-through colour, a picture that
 * may be a transparent PNG and a video do not); then a stage display, the startup frame and Black on
 * a theme that is not keyed.
 */
export function frameMustBeOpaque(frame: {
  stage: boolean
  hasData: boolean
  theme?: ThemeLike
  screen?: string | null
  video?: boolean
  scene?: SceneLike | null
}): boolean {
  if (frame.stage || !frame.hasData) return true
  if (frame.scene) {
    const g = frame.scene.backgroundGradient as { stops?: { color: string }[] } | undefined
    return g ? gradientOpaque(g) : colourOpaque(frame.scene.background)
  }
  const bg = frame.theme?.background
  if (frame.screen === "black") return !!bg && bg.type !== "transparent"
  if (frame.video) return false
  const l = frame.theme?.layout
  const full = !!l && (l.backgroundWidth ?? 0) >= 100 && (l.backgroundHeight ?? 0) >= 100 && !l.offsetX && !l.offsetY
  if (!full || !bg) return false
  if (bg.type === "solid") return colourOpaque(bg.color)
  if (bg.type === "gradient") return gradientOpaque(bg.gradient)
  return false
}

export interface SurfaceWatchOptions {
  /** Make a new canvas and context, put it where the old one was, and point every reader at it. False when it could not. */
  rebuild: (reason: SurfaceProblem) => boolean
  /** Draw the current frame again (and send it). */
  redraw: () => void
  report: (event: SurfaceEvent) => void
  now?: () => number
  /** Swap for tests. */
  check?: (canvas: HTMLCanvasElement) => SurfaceProblem | null
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

export interface SurfaceWatch {
  /** Listen for the canvas losing its context. Returns the undo. */
  attach: (canvas: HTMLCanvasElement) => () => void
  /** After a real redraw: check the surface (rate-limited) when the frame drawn must be opaque. */
  afterDraw: (canvas: HTMLCanvasElement, mustBeOpaque: boolean) => void
  /**
   * On a timer (every SURFACE_HELD_CHECK_MS): check the canvas when the last frame drawn must be
   * opaque, even though nothing has redrawn since. Skipped while draws are already being checked.
   */
  whileHeld: (canvas: HTMLCanvasElement | null) => void
  /** Stop the retry timer (the window is going). */
  dispose: () => void
}

export function createSurfaceWatch(opts: SurfaceWatchOptions): SurfaceWatch {
  const now = opts.now ?? (() => Date.now())
  const check = opts.check ?? surfaceProblem
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))
  let lastCheck = -Infinity
  let strikes = 0
  let backoffMs = 0
  let retryAt = -Infinity
  let retryTimer: unknown = null
  let failing = false
  let recovering = false
  // Whether the last frame drawn must be opaque (so a held frame can be checked). Nothing drawn yet: no.
  let heldOpaque = false
  // A draw made while rebuilding (the redraw): checked as soon as the rebuild is done.
  let pending: { canvas: HTMLCanvasElement; mustBeOpaque: boolean } | null = null

  const stopRetry = () => {
    if (retryTimer !== null) clearTimer(retryTimer)
    retryTimer = null
  }
  const reset = () => {
    strikes = 0
    backoffMs = 0
    retryAt = -Infinity
    stopRetry()
  }

  const runCheck = (canvas: HTMLCanvasElement, t: number) => {
    lastCheck = t
    const problem = check(canvas)
    if (!problem) {
      reset()
      if (failing) {
        failing = false
        opts.report({ kind: "recovered", at: t })
      }
      return
    }
    recover(problem)
  }

  const recover = (reason: SurfaceProblem) => {
    if (recovering) return
    const t = now()
    if (t < retryAt) return
    recovering = true
    let rebuilt = false
    try {
      strikes++
      if (strikes > SURFACE_MAX_STRIKES) {
        backoffMs = backoffMs ? Math.min(SURFACE_BACKOFF_MAX_MS, backoffMs * 2) : SURFACE_BACKOFF_MS
        retryAt = t + backoffMs
        strikes = 0
        pending = null
        // Try again when the wait is over, even if nothing draws meanwhile (a held verse).
        stopRetry()
        retryTimer = setTimer(() => {
          retryTimer = null
          // The wait is over: a timer firing a hair early, or a clock stepped back, must not drop the retry.
          retryAt = -Infinity
          recover(reason)
        }, backoffMs)
        if (!failing) {
          failing = true
          opts.report({ kind: "failed", reason, at: t, retryInMs: backoffMs })
        }
        return
      }
      try {
        rebuilt = opts.rebuild(reason)
      } catch (e) {
        console.error("[output-surface] rebuild failed", e)
      }
      if (rebuilt) {
        // One report per run of rebuilds; a run that does not hold reports "failed" instead.
        if (!failing && strikes === 1) opts.report({ kind: "rebuilt", reason, at: t })
        pending = null
        opts.redraw()
      }
    } finally {
      recovering = false
    }
    if (!rebuilt) {
      // The rebuild itself failed: count it and go on to the next strike (bounded by the back-off).
      recover(reason)
      return
    }
    // Did the redraw land on the new canvas? Checked now, not a second later.
    const p = pending as { canvas: HTMLCanvasElement; mustBeOpaque: boolean } | null
    pending = null
    if (p?.mustBeOpaque) runCheck(p.canvas, now())
  }

  return {
    attach(canvas) {
      const onLost = (e: Event) => {
        // Ask the browser to keep the canvas restorable; the rebuild does not wait for it.
        e.preventDefault()
        recover("context-lost")
      }
      const onRestored = () => opts.redraw()
      canvas.addEventListener("contextlost", onLost)
      canvas.addEventListener("contextrestored", onRestored)
      return () => {
        canvas.removeEventListener("contextlost", onLost)
        canvas.removeEventListener("contextrestored", onRestored)
      }
    },
    afterDraw(canvas, mustBeOpaque) {
      heldOpaque = mustBeOpaque
      if (recovering) {
        pending = { canvas, mustBeOpaque }
        return
      }
      if (!mustBeOpaque) {
        // A keyed look cannot be checked: a failure is no longer known, so stop saying so.
        if (failing) {
          failing = false
          reset()
          opts.report({ kind: "unchecked", at: now() })
        }
        return
      }
      const t = now()
      if (t - lastCheck < SURFACE_CHECK_MS) return
      runCheck(canvas, t)
    },
    whileHeld(canvas) {
      if (!canvas || !heldOpaque || recovering) return
      const t = now()
      // Frames are being drawn and checked (or the back-off holds): nothing to add.
      if (t - lastCheck < SURFACE_CHECK_MS || t < retryAt) return
      runCheck(canvas, t)
    },
    dispose: stopRetry,
  }
}

function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/** What the operator reads, e.g. "Main: the screen's drawing surface was lost and rebuilt at 10:42". */
export function surfaceMessage(outputName: string, event: SurfaceEvent): string {
  if (event.kind === "rebuilt") return `${outputName}: the screen's drawing surface was lost and rebuilt at ${clock(event.at)}`
  if (event.kind === "recovered") return `${outputName}: the screen is drawing again (${clock(event.at)})`
  if (event.kind === "unchecked") return `${outputName}: now showing a see-through look; its drawing surface cannot be checked (${clock(event.at)})`
  const secs = Math.round(event.retryInMs / 1000)
  return `${outputName}: the screen's drawing surface keeps getting lost (since ${clock(event.at)}); it may be blank on the screen, NDI and any recording. Retrying in ${secs} s. Close and reopen the output if it stays blank.`
}

export interface SurfaceHealthAction {
  /** No toast for a silent change. */
  toast?: "warning" | "error" | "success"
  message: string
  /** Set (a string) or clear (null) the Present warning; undefined leaves it. */
  warning?: string | null
}

/**
 * What the host does with an output's surface report: a rebuild is a passing warning (it already
 * recovered); one that keeps failing stays as the Present warning until that output draws again or
 * shows a look that is not checked. `ownWarning` is the warning this output set (tracked by output
 * ID), so only that one is ever cleared.
 */
export function surfaceHealthAction(
  outputName: string,
  payload: Partial<{ kind: string; reason: string; at: number; retryInMs: number }> | null | undefined,
  presentWarning: string | null,
  ownWarning: string | undefined,
): SurfaceHealthAction | null {
  const p = payload
  const at = typeof p?.at === "number" ? p.at : Date.now()
  const reason: SurfaceProblem = p?.reason === "context-lost" ? "context-lost" : "blank"
  if (p?.kind === "rebuilt") return { toast: "warning", message: surfaceMessage(outputName, { kind: "rebuilt", reason, at }) }
  if (p?.kind === "failed") {
    const retryInMs = typeof p.retryInMs === "number" ? p.retryInMs : SURFACE_BACKOFF_MS
    const message = surfaceMessage(outputName, { kind: "failed", reason, at, retryInMs })
    return { toast: "error", message, warning: message }
  }
  if (p?.kind === "recovered" || p?.kind === "unchecked") {
    const mine = !!ownWarning && presentWarning === ownWarning
    const message = surfaceMessage(outputName, p.kind === "recovered" ? { kind: "recovered", at } : { kind: "unchecked", at })
    return { ...(p.kind === "recovered" ? { toast: "success" as const } : {}), message, ...(mine ? { warning: null } : {}) }
  }
  return null
}
