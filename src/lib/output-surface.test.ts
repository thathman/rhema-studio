// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createSurfaceWatch,
  frameMustBeOpaque,
  surfaceHealthAction,
  surfaceMessage,
  surfaceProblem,
  SURFACE_BACKOFF_MS,
  SURFACE_CHECK_MS,
  SURFACE_MAX_STRIKES,
  type SurfaceEvent,
} from "./output-surface"

/** A canvas whose 2D context reads back `alpha` everywhere (0 = a lost backing store: #873's [0,0,0,0]). */
function fakeCanvas(opts: { alpha?: number; context?: boolean; lost?: boolean } = {}) {
  const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, opts.alpha ?? 255]) }))
  const ctx = { getImageData, ...(opts.lost !== undefined ? { isContextLost: () => opts.lost } : {}) }
  const canvas = document.createElement("canvas")
  canvas.width = 1920
  canvas.height = 1080
  Object.defineProperty(canvas, "getContext", { value: () => (opts.context === false ? null : ctx) })
  return { canvas, getImageData }
}

/** A window around the watch: the live canvas, its rebuilds, its redraws and what it reported. */
function harness(opts: { alpha?: number; rebuildOk?: boolean; freshAlpha?: number } = {}) {
  let t = 1_000_000
  const first = fakeCanvas({ alpha: opts.alpha })
  const host = document.createElement("div")
  host.appendChild(first.canvas)
  const live = { canvas: first.canvas }
  const reports: SurfaceEvent[] = []
  const redraw = vi.fn()
  const rebuild = vi.fn(() => {
    if (opts.rebuildOk === false) return false
    const fresh = fakeCanvas({ alpha: opts.freshAlpha ?? 255 }).canvas
    live.canvas.replaceWith(fresh)
    live.canvas = fresh
    return true
  })
  const check = vi.fn(surfaceProblem)
  const watch = createSurfaceWatch({ rebuild, redraw, report: (e) => reports.push(e), now: () => t, check })
  return {
    watch, live, host, reports, redraw, rebuild, check, first,
    advance: (ms: number) => { t += ms },
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
  it("samples a few pixels, not the frame", () => {
    const c = fakeCanvas({ alpha: 0 })
    surfaceProblem(c.canvas)
    expect(c.getImageData.mock.calls.length).toBeLessThanOrEqual(3)
    for (const call of c.getImageData.mock.calls as unknown as number[][]) expect(call.slice(2)).toEqual([1, 1])
  })
})

describe("frameMustBeOpaque", () => {
  it("knows which frames cover the canvas", () => {
    expect(frameMustBeOpaque({ stage: true, hasData: true })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: false })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: true, themeBackground: "solid" })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: true, themeBackground: "transparent" })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, scene: { background: "#000" } })).toBe(true)
    expect(frameMustBeOpaque({ stage: false, hasData: true, scene: { background: "transparent" } })).toBe(false)
    expect(frameMustBeOpaque({ stage: false, hasData: true, scene: { background: "transparent", backgroundGradient: {} } })).toBe(true)
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
    // The new surface holds the frame: checked on the next opaque draw, and quiet.
    h.watch.afterDraw(h.live.canvas, true)
    expect(h.rebuild).toHaveBeenCalledTimes(1)
    expect(h.reports).toHaveLength(1)
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
    // 60 frames over one second: the first draw and the one a second later.
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

  it("never reads back a frame that may be transparent (a keyed theme or scene)", () => {
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
    // A few rebuilds in a row, then the failure.
    check(SURFACE_MAX_STRIKES + 1)
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    // Inside the wait: no rebuild at all, however often it draws.
    check(SURFACE_BACKOFF_MS / SURFACE_CHECK_MS - 1)
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    // Over a longer run the waits double: far fewer rebuilds than checks.
    check(60)
    expect(h.rebuild.mock.calls.length).toBeLessThan(20)
    expect(h.reports.filter((e) => e.kind === "rebuilt")).toHaveLength(1)
    const failed = h.reports.filter((e) => e.kind === "failed")
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ reason: "blank", retryInMs: SURFACE_BACKOFF_MS })
  })

  it("backs off when the rebuild itself fails", () => {
    const h = harness({ alpha: 0, rebuildOk: false })
    for (let i = 0; i < SURFACE_MAX_STRIKES + 3; i++) {
      h.watch.afterDraw(h.live.canvas, true)
      h.advance(SURFACE_CHECK_MS)
    }
    expect(h.rebuild).toHaveBeenCalledTimes(SURFACE_MAX_STRIKES)
    expect(h.redraw).not.toHaveBeenCalled()
    expect(h.reports.map((e) => e.kind)).toEqual(["failed"])
  })

  it("says when a failing surface draws again", () => {
    const h = harness({ alpha: 0, freshAlpha: 0 })
    for (let i = 0; i <= SURFACE_MAX_STRIKES; i++) {
      h.watch.afterDraw(h.live.canvas, true)
      h.advance(SURFACE_CHECK_MS)
    }
    expect(h.reports.at(-1)?.kind).toBe("failed")
    // The page comes back to life: the next check reads a frame.
    const healthy = fakeCanvas({ alpha: 255 }).canvas
    h.watch.afterDraw(healthy, true)
    expect(h.reports.at(-1)?.kind).toBe("recovered")
  })
})

describe("surface health for the operator", () => {
  const at = new Date(2026, 10, 15, 10, 42).getTime()
  it("says what happened and when", () => {
    expect(surfaceMessage("Main", { kind: "rebuilt", reason: "blank", at })).toBe("Main: the screen's drawing surface was lost and rebuilt at 10:42")
  })
  it("a rebuild is a passing warning; a failure stays until that output draws again", () => {
    expect(surfaceHealthAction("Main", { kind: "rebuilt", reason: "context-lost", at }, null)).toEqual({ toast: "warning", message: "Main: the screen's drawing surface was lost and rebuilt at 10:42" })
    const failed = surfaceHealthAction("Main", { kind: "failed", reason: "blank", at, retryInMs: 5000 }, null)
    expect(failed?.toast).toBe("error")
    expect(failed?.warning).toBe(failed?.message)
    expect(failed?.message).toContain("Retrying in 5 s")
    expect(surfaceHealthAction("Main", { kind: "recovered", at }, failed!.message)).toMatchObject({ toast: "success", warning: null })
    // Another output's or another kind of warning is left alone.
    expect(surfaceHealthAction("Main", { kind: "recovered", at }, "Alt could not draw the new screen")).not.toHaveProperty("warning")
    expect(surfaceHealthAction("Main", { kind: "bogus" } as never, null)).toBeNull()
  })
})
