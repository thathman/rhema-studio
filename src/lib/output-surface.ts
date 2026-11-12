/**
 * Watch an output window's drawing surface (#873). WebKit can lose a hidden window's canvas (its
 * context or its backing store, under memory pressure): every later draw then lands nowhere and the
 * screen, NDI and a recording pinned to the output go fully transparent while the app still says a
 * scene is up. This notices it, has the window rebuild its canvas, and says so to the host.
 *
 * Two signals:
 * - the canvas's own `contextlost` event (and `isContextLost()`, where WebKit has them);
 * - after a real redraw of a frame that must be opaque (a scene or theme with a background, Black
 *   on an opaque theme, a stage display, the startup frame), a few single-pixel reads: all fully
 *   transparent means the drawing never landed. At most once a second, never per frame.
 *
 * Never loops: a few rebuilds that do not hold back off (5 s, doubling up to 5 min) and report a
 * failure once, instead of rebuilding every frame.
 */

/** At most one read-back check this often (ms). */
export const SURFACE_CHECK_MS = 1000
/** Rebuilds in a row (no healthy check between) before backing off. */
export const SURFACE_MAX_STRIKES = 3
export const SURFACE_BACKOFF_MS = 5000
export const SURFACE_BACKOFF_MAX_MS = 5 * 60_000

export type SurfaceProblem = "context-lost" | "blank"

export type SurfaceEvent =
  | { kind: "rebuilt"; reason: SurfaceProblem; at: number }
  | { kind: "failed"; reason: SurfaceProblem; at: number; retryInMs: number }
  | { kind: "recovered"; at: number }

/** Where to read: the centre and two inner corners. A frame that must be opaque is opaque everywhere. */
function samplePoints(w: number, h: number): Array<[number, number]> {
  return [
    [Math.floor(w / 2), Math.floor(h / 2)],
    [Math.min(w - 1, 2), Math.min(h - 1, 2)],
    [Math.max(0, w - 3), Math.max(0, h - 3)],
  ]
}

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
  try {
    for (const [x, y] of samplePoints(canvas.width, canvas.height)) {
      if (ctx.getImageData(x, y, 1, 1).data[3] !== 0) return null
    }
  } catch {
    // A read that throws is a dead surface too (a tainted canvas never reaches here: it would have
    // failed the NDI read first, and output pictures are same-origin).
    return "context-lost"
  }
  return "blank"
}

/** Whether the frame just drawn covers the whole canvas with something opaque. */
export function frameMustBeOpaque(frame: {
  stage: boolean
  hasData: boolean
  themeBackground?: string
  scene?: { background: string; backgroundGradient?: unknown } | null
}): boolean {
  if (frame.stage || !frame.hasData) return true
  if (frame.scene) return !!frame.scene.backgroundGradient || frame.scene.background !== "transparent"
  return frame.themeBackground !== "transparent"
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
}

export interface SurfaceWatch {
  /** Listen for the canvas losing its context. Returns the undo. */
  attach: (canvas: HTMLCanvasElement) => () => void
  /** After a real redraw: check the surface (rate-limited) when the frame drawn must be opaque. */
  afterDraw: (canvas: HTMLCanvasElement, mustBeOpaque: boolean) => void
}

export function createSurfaceWatch(opts: SurfaceWatchOptions): SurfaceWatch {
  const now = opts.now ?? (() => Date.now())
  const check = opts.check ?? surfaceProblem
  let lastCheck = -Infinity
  let strikes = 0
  let backoffMs = 0
  let retryAt = -Infinity
  let failing = false
  let recovering = false

  const recover = (reason: SurfaceProblem) => {
    if (recovering) return
    const t = now()
    if (t < retryAt) return
    recovering = true
    try {
      strikes++
      if (strikes > SURFACE_MAX_STRIKES) {
        backoffMs = backoffMs ? Math.min(SURFACE_BACKOFF_MAX_MS, backoffMs * 2) : SURFACE_BACKOFF_MS
        retryAt = t + backoffMs
        strikes = 0
        if (!failing) {
          failing = true
          opts.report({ kind: "failed", reason, at: t, retryInMs: backoffMs })
        }
        return
      }
      let ok = false
      try {
        ok = opts.rebuild(reason)
      } catch (e) {
        console.error("[output-surface] rebuild failed", e)
      }
      if (!ok) return
      // The new surface is checked on the next opaque redraw, not held back by this check's clock.
      lastCheck = -Infinity
      // One report per run of rebuilds; a run that does not hold reports "failed" instead.
      if (!failing && strikes === 1) opts.report({ kind: "rebuilt", reason, at: t })
      opts.redraw()
    } finally {
      recovering = false
    }
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
      if (!mustBeOpaque || recovering) return
      const t = now()
      if (t - lastCheck < SURFACE_CHECK_MS) return
      lastCheck = t
      const problem = check(canvas)
      if (!problem) {
        strikes = 0
        backoffMs = 0
        retryAt = -Infinity
        if (failing) {
          failing = false
          opts.report({ kind: "recovered", at: t })
        }
        return
      }
      recover(problem)
    },
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
  const secs = Math.round(event.retryInMs / 1000)
  return `${outputName}: the screen's drawing surface keeps getting lost (since ${clock(event.at)}); it may be blank on the screen, NDI and any recording. Retrying in ${secs} s. Close and reopen the output if it stays blank.`
}

export interface SurfaceHealthAction {
  toast: "warning" | "error" | "success"
  message: string
  /** Set (a string) or clear (null) the Present warning; undefined leaves it. */
  warning?: string | null
}

/**
 * What the host does with an output's surface report: a rebuild is a passing warning (it already
 * recovered); one that keeps failing stays as the Present warning until that output draws again.
 */
export function surfaceHealthAction(
  outputName: string,
  payload: Partial<SurfaceEvent> | null | undefined,
  presentWarning: string | null,
): SurfaceHealthAction | null {
  const p = payload as { kind?: string; reason?: SurfaceProblem; at?: number; retryInMs?: number } | null | undefined
  const at = typeof p?.at === "number" ? p.at : Date.now()
  const reason = p?.reason === "context-lost" ? "context-lost" : "blank"
  if (p?.kind === "rebuilt") return { toast: "warning", message: surfaceMessage(outputName, { kind: "rebuilt", reason, at }) }
  if (p?.kind === "failed") {
    const retryInMs = typeof p.retryInMs === "number" ? p.retryInMs : SURFACE_BACKOFF_MS
    const message = surfaceMessage(outputName, { kind: "failed", reason, at, retryInMs })
    return { toast: "error", message, warning: message }
  }
  if (p?.kind === "recovered") {
    const mine = !!presentWarning && presentWarning.startsWith(`${outputName}: the screen's drawing surface keeps getting lost`)
    return { toast: "success", message: surfaceMessage(outputName, { kind: "recovered", at }), ...(mine ? { warning: null } : {}) }
  }
  return null
}
