// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  colourOpaque,
  createSurfaceWatch,
  frameMustBeOpaque,
  surfaceHealthAction,
  surfaceMessage,
  surfaceProblem,
  SURFACE_BACKOFF_MS,
  SURFACE_CHECK_MS,
  SURFACE_HELD_CHECK_MS,
  SURFACE_MAX_STRIKES,
  type SurfaceEvent,
} from "./output-surface"

/** A canvas whose 2D context reads back `alpha` everywhere (0 = a lost backing store: #873's [0,0,0,0]). */
function fakeCanvas(opts: { alpha?: number; context?: boolean; lost?: boolean; readError?: string } = {}) {
  const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => {
    if (opts.readError) {
      const e = new Error("read failed")
      e.name = opts.readError
      throw e
    }
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 3; i < data.length; i += 4) data[i] = opts.alpha ?? 255
    return { data }
  })
  const ctx = { getImageData, ...(opts.lost !== undefined ? { isContextLost: () => opts.lost } : {}) }
  const canvas = document.createElement("canvas")
  canvas.width = 1920
  canvas.height = 1080
  Object.defineProperty(canvas, "getContext", { value: () => (opts.context === false ? null : ctx) })
  return { canvas, getImageData }
}

/** A window around the watch: the live canvas, its rebuilds, its redraws, its timer and what it reported. */
function harness(opts: { alpha?: number; rebuildOk?: boolean; freshAlpha?: number; redrawChecks?: boolean } = {}) {
  let t = 1_000_000
  // Mutable: a test can drop the first canvas's backing store later (alpha 0), as WebKit does to an idle hidden one.
  const firstOpts: { alpha?: number } = { alpha: opts.alpha }
  const first = fakeCanvas(firstOpts)
  const host = document.createElement("div")
  host.appendChild(first.canvas)
  const live = { canvas: first.canvas }
  const reports: SurfaceEvent[] = []
  const timers: Array<{ fn: () => void; at: number; cleared: boolean }> = []
  const rebuild = vi.fn(() => {
    if (opts.rebuildOk === false) return false
    const fresh = fakeCanvas({ alpha: opts.freshAlpha ?? 255 }).canvas
    live.canvas.replaceWith(fresh)
    live.canvas = fresh
    return true
  })
  const check = vi.fn(surfaceProblem)
  // eslint-disable-next-line prefer-const
  let watch: ReturnType<typeof createSurfaceWatch>
  // The window's redraw ends in afterDraw, like broadcast-output's draw().
  const redraw = vi.fn(() => { if (opts.redrawChecks) watch.afterDraw(live.canvas, true) })
  watch = createSurfaceWatch({
    rebuild, redraw, report: (e) => reports.push(e), now: () => t, check,
    setTimer: (fn, ms) => { const timer = { fn, at: t + ms, cleared: false }; timers.push(timer); return timer },
    clearTimer: (id) => { (id as { cleared: boolean }).cleared = true },
  })
  return {
    watch, live, host, reports, redraw, rebuild, check, first, firstOpts, timers,
    advance: (ms: number) => { t += ms },
    /** Run the timers that are due. */
    runTimers: () => { for (const tm of timers.filter((x) => !x.cleared && x.at <= t)) { tm.cleared = true; tm.fn() } },
    // What the NDI/recorder push reads: always the live canvas.
    ndiSource: () => live.canvas,
  }
}

afterEach(() => vi.restoreAllMocks())

describe("surfaceProblem", () => {
  it("reads a drawn frame as healthy", () => {
    expect(surfaceProblem(fakeCanvas({ alpha: 255 }).canvas)).toBeNull()
  })
  it("reads a fully transparent opaque frame as blank (#873 centerPixel [0,0,0,0])", () => {
    expect(surfaceProblem(fakeCanvas({ alpha: 0 }).canvas)).toBe("blank")
  })
  it("reads a missing or lost context as lost", () => {
    expect(surfaceProblem(fakeCanvas({ context: false }).canvas)).toBe("context-lost")
    expect(surfaceProblem(fakeCanvas({ lost: true }).canvas)).toBe("context-lost")
  })
  it("takes a tainted canvas (SecurityError) as drawing, not lost", () => {
    expect(surfaceProblem(fakeCanvas({ readError: "SecurityError" }).canvas)).toBeNull()
    expect(surfaceProblem(fakeCanvas({ readError: "InvalidStateError" }).canvas)).toBe("context-lost")
  })
  it("reads one 1-pixel strip, not the frame", () => {
    const c = fakeCanvas({ alpha: 0 })
    surfaceProblem(c.canvas)
    expect(c.getImageData).toHaveBeenCalledTimes(1)
    expect(c.getImageData).toHaveBeenCalledWith(0, 540, 1920, 1)
  })
})

describe("colourOpaque", () => {
  it("knows see-through colours", () => {
    for (const c of ["#000", "#123456", "#000f", "#000000ff", "black", "rgb(0,0,0)", "rgba(0, 0, 0, 0.5)", "rgb(0 0 0 / 50%)", "hsla(0, 0%, 0%, 1)"]) expect(colourOpaque(c), c).toBe(true)
    for (const c of ["transparent", "#00000000", "#0000", "rgba(0, 0, 0, 0)", "rgba(10,10,10,0.001)", "rgb(0 0 0 / 0%)", "hsla(0,0%,0%,0)", "var(--bg)", "", undefined]) expect(colourOpaque(c), String(c)).toBe(false)
  })
})

describe("frameMustBeOpaque", () => {
  const full = { backgroundWidth: 100, backgroundHeight: 100, offsetX: 0, offsetY: 0 }
  const theme = (background: object, layout: object = full) => ({ background, layout })
  it("stage displays and the startup frame are checked", () => {
    expect(frameMustBeOpaque({ stage: true, hasData: true })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: false })).toBe(true)
  })
  it("a visible colour or gradient over the whole frame is checked", () => {
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "solid", color: "#102030" }) })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "gradient", color: "#000", gradient: { stops: [{ color: "#000" }, { color: "#fff" }] } }) })).toBe(true)
  })
  it("a background band (80% x 20% at the bottom) is not checked", () => {
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "solid", color: "#000" }, { backgroundWidth: 80, backgroundHeight: 20, offsetX: 0, offsetY: 0 }) })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "solid", color: "#000" }, { ...full, offsetY: 40 }) })).toBe(false)
  })
  it("see-through colours, gradients with a clear stop, pictures and videos are not checked", () => {
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "solid", color: "rgba(0,0,0,0)" }) })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "solid", color: "#00000000" }) })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "gradient", color: "#000", gradient: { stops: [{ color: "#000" }, { color: "transparent" }] } }) })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "image", color: "#000" }) })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, video: true, theme: theme({ type: "solid", color: "#000" }) })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, theme: theme({ type: "transparent", color: "#000" }) })).toBe(false)
  })
  it("Black is checked unless the theme is keyed", () => {
    const band = { backgroundWidth: 80, backgroundHeight: 20, offsetX: 0, offsetY: 0 }
    expect(frameMustBeOpaque({ stage: false, hasData: true, screen: "black", theme: theme({ type: "image", color: "#000" }, band) })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: true, screen: "black", theme: theme({ type: "transparent", color: "#000" }) })).toBe(false)
  })
  it("a scene is checked only with a visible background", () => {
    expect(frameMustBeOpaque({ stage: false, hasData: true, scene: { background: "#000" } })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: true, scene: { background: "transparent" } })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, scene: { background: "rgba(0,0,0,0)" } })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, scene: { background: "transparent", backgroundGradient: { stops: [{ color: "#000" }, { color: "#111" }] } } })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: true, scene: { background: "#000", backgroundGradient: { stops: [{ color: "#000" }, { color: "#0000" }] } } })).toBe(false)
  })
})

describe("createSurfaceWatch", () => {
  it("rebuilds a canvas that reads transparent, redraws it, points NDI at it and reports it", () => {
    const h = harness({ alpha: 0 })
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.rebuild).toHaveBeenCalledWith("blank")
    expect(h.redraw).toHaveBeenCalledTimes(1)
    expect(h.ndiSource()).not.toBe(h.first.canvas)
    expect(h.host.contains(h.ndiSource())).toBe(true)
    expect(h.host.contains(h.first.canvas)).toBe(false)
    expect(h.reports).toEqual([{ kind: "rebuilt", reason: "blank", at: expect.any(Number) }])
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.rebuild).toHaveBeenCalledTimes(1)
    expect(h.reports).toHaveLength(1)
  })

  it("checks the redraw on the new canvas straight away", () => {
    const h = harness({ alpha: 0, redrawChecks: true })
    h.watch.afterDraw(h.live.canvas, true)
    // The first check, then the redraw's check on the new canvas, without waiting a second.
    expect(h.check).toHaveBeenCalledTimes(2)
    expect(h.check.mock.calls[1][0]).toBe(h.live.canvas)
    expect(h.rebuild).toHaveBeenCalledTimes(1)
  })

  it("rebuilds on the canvas's contextlost event", () => {
    const h = harness()
    h.watch.attach(h.live.canvas)
    const lost = new Event("contextlost", { cancelable: true })
    h.live.canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(h.rebuild).toHaveBeenCalledWith("context-lost")
    expect(h.redraw).toHaveBeenCalled()
    expect(h.reports[0]).toMatchObject({ kind: "rebuilt", reason: "context-lost" })
  })

  it("redraws on contextrestored, and stops listening once detached", () => {
    const h = harness()
    const detach = h.watch.attach(h.live.canvas)
    h.live.canvas.dispatchEvent(new Event("contextrestored"))
    expect(h.redraw).toHaveBeenCalledTimes(1)
    detach()
    h.live.canvas.dispatchEvent(new Event("contextlost", { cancelable: true }))
    expect(h.rebuild).not.toHaveBeenCalled()
  })

  it("checks at most once a second, not every frame", () => {
    const h = harness()
    for (let i = 0; i < 60; i++) {
      h.watch.afterDraw(h.live.canvas, true)
      h.advance(1000 / 60)
    }
    expect(h.check.mock.calls.length).toBeLessThanOrEqual(2)
    h.check.mockClear()
    h.advance(SURFACE_CHECK_MS)
    h.watch.afterDraw(h.live.canvas, true)
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.check).toHaveBeenCalledTimes(1)
    h.advance(SURFACE_CHECK_MS - 1)
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.check).toHaveBeenCalledTimes(1)
  })

  it("never reads back a frame that may be transparent (a keyed look)", () => {
    const h = harness({ alpha: 0 })
    h.watch.afterDraw(h.live.canvas, false)
    expect(h.check).not.toHaveBeenCalled()
    expect(h.rebuild).not.toHaveBeenCalled()
  })

  it("backs off and reports a failure, never thrashing, when rebuilds do not hold", () => {
    const h = harness({ alpha: 0, freshAlpha: 0 })
    const check = (n: number) => {
      for (let i = 0; i < n; i++) {
        h.watch.afterDraw(h.live.canvas, true)
        h.advance(SURFACE_CHECK_MS)
      }
    }
    check(SURFACE_MAX_STRIKES + 1)
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    check(SURFACE_BACKOFF_MS / SURFACE_CHECK_MS - 1)
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    check(60)
    expect(h.rebuild.mock.calls.length).toBeLessThan(20)
    expect(h.reports.filter((e) => e.kind === "rebuilt")).toHaveLength(1)
    const failed = h.reports.filter((e) => e.kind === "failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ reason: "blank", retryInMs: SURFACE_BACKOFF_MS })
  })

  it("a redraw that checks itself still stops after a few rebuilds", () => {
    const h = harness({ alpha: 0, freshAlpha: 0, redrawChecks: true })
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    expect(h.reports.map((e) => e.kind)).toEqual(["rebuilt", "failed"])
  })

  it("retries when the wait is over even though nothing draws (a held verse)", () => {
    const h = harness({ alpha: 0, freshAlpha: 0 })
    for (let i = 0; i <= SURFACE_MAX_STRIKES; i++) {
      h.watch.afterDraw(h.live.canvas, true)
      h.advance(SURFACE_CHECK_MS)
    }
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    const live = h.timers.filter((x) => !x.cleared)
    expect(live).toHaveLength(1)
    h.advance(SURFACE_BACKOFF_MS)
    h.runTimers()
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES + 1)
    expect(h.redraw).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES + 1)
  })

  it("still retries when the timer fires a little early (or the clock stepped back)", () => {
    const h = harness({ alpha: 0, freshAlpha: 0 })
    for (let i = 0; i <= SURFACE_MAX_STRIKES; i++) {
      h.watch.afterDraw(h.live.canvas, true)
      h.advance(SURFACE_CHECK_MS)
    }
    const timer = h.timers.find((x) => !x.cleared)!
    h.advance(SURFACE_BACKOFF_MS - 5)
    timer.cleared = true
    timer.fn()
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES + 1)
  })

  it("backs off when the rebuild itself fails", () => {
    const h = harness({ alpha: 0, rebuildOk: false })
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    for (let i = 0; i < 3; i++) {
      h.advance(SURFACE_CHECK_MS)
      h.watch.afterDraw(h.live.canvas, true)
    }
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    expect(h.redraw).not.toHaveBeenCalled()
    expect(h.reports.map((e) => e.kind)).toEqual(["failed"])
  })

  it("says when a failing surface draws again, and stops the retry", () => {
    const h = harness({ alpha: 0, freshAlpha: 0 })
    for (let i = 0; i <= SURFACE_MAX_STRIKES; i++) {
      h.watch.afterDraw(h.live.canvas, true)
      h.advance(SURFACE_CHECK_MS)
    }
    expect(h.reports.at(-1)?.kind).toBe("failed")
    h.advance(SURFACE_BACKOFF_MS)
    h.watch.afterDraw(fakeCanvas({ alpha: 255 }).canvas, true)
    expect(h.reports.at(-1)?.kind).toBe("recovered")
    expect(h.timers.every((x) => x.cleared)).toBe(true)
  })

  it("a keyed look after a failure clears it (not left stale)", () => {
    const h = harness({ alpha: 0, freshAlpha: 0 })
    for (let i = 0; i <= SURFACE_MAX_STRIKES; i++) {
      h.watch.afterDraw(h.live.canvas, true)
      h.advance(SURFACE_CHECK_MS)
    }
    h.watch.afterDraw(h.live.canvas, false)
    expect(h.reports.at(-1)?.kind).toBe("unchecked")
    expect(h.timers.every((x) => x.cleared)).toBe(true)
    // Said once.
    h.watch.afterDraw(h.live.canvas, false)
    expect(h.reports.filter((e) => e.kind === "unchecked")).toHaveLength(1)
  })

  // CI run 43297534893 (#873 again after #874): Main drew its baseline scene, then sat still in its
  // hidden window for ~35 s while Design was used; its canvas then read [0,0,0,0] (hash c84a4cca) and
  // nothing was rebuilt, because the check only ran after a draw and a held scene never redraws.
  it("checks a held opaque frame with no redraw, and rebuilds it when its backing store is dropped", () => {
    const h = harness()
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.check).toHaveBeenCalledTimes(1)
    // Held: nothing draws. The surface is fine for a while...
    for (let i = 0; i < 5; i++) {
      h.advance(SURFACE_HELD_CHECK_MS)
      h.watch.whileHeld(h.live.canvas)
    }
    expect(h.rebuild).not.toHaveBeenCalled()
    // ...then WebKit drops the idle canvas. The next held check notices, with no draw at all.
    h.firstOpts.alpha = 0
    h.advance(SURFACE_HELD_CHECK_MS)
    h.watch.whileHeld(h.live.canvas)
    expect(h.rebuild).toHaveBeenCalledWith("blank")
    expect(h.redraw).toHaveBeenCalledTimes(1)
    expect(h.ndiSource()).not.toBe(h.first.canvas)
    expect(h.reports).toEqual([{ kind: "rebuilt", reason: "blank", at: expect.any(Number) }])
    // The rebuilt canvas holds: later held checks pass and nothing more is rebuilt.
    h.advance(SURFACE_HELD_CHECK_MS)
    h.watch.whileHeld(h.live.canvas)
    expect(h.rebuild).toHaveBeenCalledTimes(1)
  })

  it("never checks a held frame that may be transparent, or before anything is drawn", () => {
    const h = harness({ alpha: 0 })
    h.advance(SURFACE_HELD_CHECK_MS)
    h.watch.whileHeld(h.live.canvas)
    h.watch.whileHeld(null)
    expect(h.check).not.toHaveBeenCalled()
    h.watch.afterDraw(h.live.canvas, false)
    for (let i = 0; i < 5; i++) {
      h.advance(SURFACE_HELD_CHECK_MS)
      h.watch.whileHeld(h.live.canvas)
    }
    expect(h.check).not.toHaveBeenCalled()
    expect(h.rebuild).not.toHaveBeenCalled()
  })

  it("adds no read-back while frames are being drawn and checked", () => {
    const h = harness()
    for (let i = 0; i < 120; i++) {
      h.watch.afterDraw(h.live.canvas, true)
      if (i % 30 === 0) h.watch.whileHeld(h.live.canvas)
      h.advance(1000 / 30)
    }
    // 4 s of drawing: the draws' own once-a-second checks, no more.
    expect(h.check.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it("a held check keeps to the back-off when rebuilds do not hold", () => {
    const h = harness({ alpha: 0, freshAlpha: 0, redrawChecks: true })
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.reports.filter((e) => e.kind === "failed")).toHaveLength(1)
    const rebuilds = h.rebuild.mock.calls.length
    // Held checks during the wait read nothing and rebuild nothing.
    h.check.mockClear()
    for (let t = SURFACE_HELD_CHECK_MS; t < SURFACE_BACKOFF_MS; t += SURFACE_HELD_CHECK_MS) {
      h.advance(SURFACE_HELD_CHECK_MS)
      h.watch.whileHeld(h.live.canvas)
    }
    expect(h.check).not.toHaveBeenCalled()
    expect(h.rebuild).toHaveBeenCalledTimes(rebuilds)
  })

  it("dispose stops a pending retry", () => {
    const h = harness({ alpha: 0, freshAlpha: 0, redrawChecks: true })
    h.watch.afterDraw(h.live.canvas, true)
    h.watch.dispose()
    expect(h.timers.every((x) => x.cleared)).toBe(true)
  })
})

describe("surface health for the operator", () => {
  const at = new Date(2026, 10, 15, 10, 42).getTime()
  it("says what happened and when", () => {
    expect(surfaceMessage("Main", { kind: "rebuilt", reason: "blank", at })).toBe("Main: the screen's drawing surface was lost and rebuilt at 10:42")
  })
  it("a rebuild is a passing warning; a failure stays until that output draws again", () => {
    expect(surfaceHealthAction("Main", { kind: "rebuilt", reason: "context-lost", at }, null, undefined)).toEqual({ toast: "warning", message: "Main: the screen's drawing surface was lost and rebuilt at 10:42" })
    const failed = surfaceHealthAction("Main", { kind: "failed", reason: "blank", at, retryInMs: 5000 }, null, undefined)
    expect(failed?.toast).toBe("error")
    expect(failed?.warning).toBe(failed?.message)
    expect(failed?.message).toContain("Retrying in 5 s")
    const own = failed!.warning as string
    expect(surfaceHealthAction("Main", { kind: "recovered", at }, own, own)).toMatchObject({ toast: "success", warning: null })
    // A keyed look clears it silently.
    const unchecked = surfaceHealthAction("Main", { kind: "unchecked", at }, own, own)
    expect(unchecked).toMatchObject({ warning: null })
    expect(unchecked).not.toHaveProperty("toast")
    // Only this output's own warning (by ID): another warning, even with the same name, stays.
    expect(surfaceHealthAction("Main", { kind: "recovered", at }, "Alt could not draw the new screen", own)).not.toHaveProperty("warning")
    expect(surfaceHealthAction("Main", { kind: "recovered", at }, own, undefined)).not.toHaveProperty("warning")
    expect(surfaceHealthAction("Main", { kind: "bogus" }, null, undefined)).toBeNull()
  })
})
