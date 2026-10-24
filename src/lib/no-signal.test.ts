// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { barGeometry, drawBars, drawStatic, NOISE_FPS, noiseFrame, noiseTile, sceneStatic } from "@/lib/no-signal"
import { drawScene } from "@/lib/scene-renderer"
import { feedMotion, feedNext } from "@/lib/feed-motion"
import { outputPace } from "@/lib/output-pace"
import { newLayer, newScene, normalizeScene, sceneFrame } from "@/lib/scenes"
import type { Scene, SceneFrame, SceneLayer } from "@/types"

/** What a camera's box shows while the camera is not sending (owner, 2026-10-24). */
const cameraScene = (patch: Partial<SceneLayer> = {}): Scene => {
  const s = newScene("Sermon")
  s.layers = [newLayer("camera", { name: "Pulpit camera", cameraUrl: "http://10.0.0.5:8889/pulpit/whep", ...patch })]
  return s
}
const frameOf = (s: Scene, extra = {}) => sceneFrame({ isLive: false, liveVerse: null, sources: {}, themes: [{ id: "t" } as never], ...extra }, { themeId: "t" }, s)
const rgbAt = (c: HTMLCanvasElement, x: number, y: number) => [...c.getContext("2d")!.getImageData(x, y, 1, 1).data.slice(0, 3)]

describe("a camera's box while it is not sending", () => {
  it("is colour bars unless the scene says otherwise; old scenes with words now show bars and keep their words", () => {
    const old = normalizeScene(JSON.parse(JSON.stringify(cameraScene({ cameraFallback: "Back soon" }))))!
    expect(old.layers[0].noSignal).toBeUndefined()
    expect(old.layers[0].cameraFallback).toBe("Back soon")
    const f = frameOf(old).layers[0]
    expect(f.noSignal).toBe("bars")
    expect(f.fallback).toBeUndefined()
    expect(f.ident).toBeUndefined()
    // Words: the words come through, as before.
    expect(frameOf(normalizeScene({ ...old, layers: [{ ...old.layers[0], noSignal: "words" }] })!).layers[0]).toMatchObject({ noSignal: "words", fallback: "Back soon" })
  })

  it("keeps only the four choices, the name tick only as true, and only on a camera", () => {
    const keep = (l: Record<string, unknown>) => normalizeScene({ id: "s", layers: [{ id: "a", kind: "camera", box: {}, ...l }] })!.layers[0]
    for (const mode of ["bars", "static", "words", "none"]) expect(keep({ noSignal: mode }).noSignal).toBe(mode)
    expect(keep({ noSignal: "snow", noSignalName: "yes" })).toMatchObject({ noSignal: undefined, noSignalName: undefined })
    expect(keep({ noSignalName: true }).noSignalName).toBe(true)
    const feed = normalizeScene({ id: "s", layers: [{ id: "a", kind: "feed", box: {}, noSignal: "static", noSignalName: true }] })!.layers[0]
    expect([feed.noSignal, feed.noSignalName]).toEqual([undefined, undefined])
  })

  it("the bars' ident shows the camera's name (Production → Cameras), else the layer's name, and only on bars", () => {
    const named = cameraScene({ noSignalName: true })
    expect(frameOf(named, { cameraLabel: (url: string) => (url.includes("/pulpit/") ? "Pulpit" : undefined) }).layers[0].ident).toBe("Pulpit")
    expect(frameOf(named).layers[0].ident).toBe("Pulpit camera")
    expect(frameOf(cameraScene({ noSignalName: true, noSignal: "static" })).layers[0].ident).toBeUndefined()
  })
})

describe("colour bars (SMPTE EG 1-1990, 75%)", () => {
  it("cover the box exactly, in whole pixels, with the three rows where they belong", () => {
    for (const [w, h] of [[1920, 1080], [320, 180], [333, 187]]) {
      const bars = barGeometry(w, h)
      expect(bars.every((b) => [b.x, b.y, b.w, b.h].every(Number.isInteger))).toBe(true)
      expect(bars.reduce((n, b) => n + b.w * b.h, 0)).toBe(w * h)
    }
    const bars = barGeometry(1920, 1080)
    const at = (x: number, y: number) => bars.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)!.rgb
    expect(bars.filter((b) => b.y === 0)).toHaveLength(7)
    expect(bars.find((b) => b.y > 0)!.y).toBe(Math.round(1080 * 0.67))
    expect(at(10, 10)).toEqual([191, 191, 191])
    expect(at(1910, 10)).toEqual([0, 0, 191])
    expect(at(10, 750)).toEqual([0, 0, 191])
    expect(at(10, 1070)).toEqual([0, 33, 76])
  })

  it("are drawn with crisp edges: sampled pixels on a real canvas are the standard colours", () => {
    const c = document.createElement("canvas")
    c.width = 700
    c.height = 400
    const ctx = c.getContext("2d")!
    drawBars(ctx, { x: 0, y: 0, w: 700, h: 400 })
    // Top: grey, yellow, cyan, green, magenta, red, blue; each bar 100 px wide.
    const top = [[191, 191, 191], [191, 191, 0], [0, 191, 191], [0, 191, 0], [191, 0, 191], [191, 0, 0], [0, 0, 191]]
    top.forEach((rgb, i) => expect(rgbAt(c, i * 100 + 50, 100), `bar ${i}`).toEqual(rgb))
    // Edge pixels on both sides of a boundary are pure (no blending).
    expect(rgbAt(c, 99, 100)).toEqual([191, 191, 191])
    expect(rgbAt(c, 100, 100)).toEqual([191, 191, 0])
    // The thin strip: blue, black, magenta, black, cyan, black, grey.
    const strip = [[0, 0, 191], [19, 19, 19], [191, 0, 191], [19, 19, 19], [0, 191, 191], [19, 19, 19], [191, 191, 191]]
    strip.forEach((rgb, i) => expect(rgbAt(c, i * 100 + 50, 285), `strip ${i}`).toEqual(rgb))
    // The bottom: −I, white, +Q, black, then the pluge (−4, 0, +4 %) and black.
    expect(rgbAt(c, 60, 380)).toEqual([0, 33, 76])
    expect(rgbAt(c, 190, 380)).toEqual([255, 255, 255])
    expect(rgbAt(c, 310, 380)).toEqual([50, 0, 106])
    expect(rgbAt(c, 440, 380)).toEqual([19, 19, 19])
    expect(rgbAt(c, 515, 380)).toEqual([9, 9, 9])
    expect(rgbAt(c, 550, 380)).toEqual([19, 19, 19])
    expect(rgbAt(c, 585, 380)).toEqual([29, 29, 29])
    expect(rgbAt(c, 650, 380)).toEqual([19, 19, 19])
  })

  it("are drawn once per box size and copied after that", () => {
    const calls: string[] = []
    const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : (...a: unknown[]) => calls.push(`${String(k)}:${a.length}`)), set: (t, k, v) => { t[k as string] = v; return true } }) as unknown as CanvasRenderingContext2D
    drawBars(ctx, { x: 10.4, y: 20.6, w: 300, h: 200 })
    drawBars(ctx, { x: 10.4, y: 20.6, w: 300, h: 200 })
    // One copy of the cached picture each time, at a whole pixel; no bar-by-bar painting here.
    expect(calls).toEqual(["drawImage:3", "drawImage:3"])
  })

  it("a scene draws them (and the preview too) where a camera is not playing; a playing camera shows its picture", () => {
    const frame = frameOf(cameraScene())
    const c = document.createElement("canvas")
    c.width = 320
    c.height = 180
    const ctx = c.getContext("2d")!
    const opts = { image: () => null, layerCanvas: () => document.createElement("canvas") }
    drawScene(ctx, 320, 180, frame, { ...opts, camera: () => null })
    expect(rgbAt(c, 20, 20)).toEqual([191, 191, 191])
    ctx.clearRect(0, 0, 320, 180)
    drawScene(ctx, 320, 180, { ...frame, layers: frame.layers.map((l) => ({ ...l, label: undefined })) }, { ...opts, preview: true })
    expect(rgbAt(c, 300, 20)).toEqual([0, 0, 191])
    // Nothing: the background shows.
    const none = frameOf(cameraScene({ noSignal: "none" }))
    drawScene(ctx, 320, 180, { ...none, background: "#204060" }, { ...opts, camera: () => null })
    expect(rgbAt(c, 20, 20)).toEqual([32, 64, 96])
  })
})

describe("TV static", () => {
  it("is grey noise with faint bands, a little below mid-grey", () => {
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const px = noiseTile(64, 32, random)
    const grey = [...Array(64 * 32).keys()].every((i) => px[i * 4] === px[i * 4 + 1] && px[i * 4] === px[i * 4 + 2] && px[i * 4 + 3] === 255)
    expect(grey).toBe(true)
    const mean = [...Array(64 * 32).keys()].reduce((n, i) => n + px[i * 4], 0) / (64 * 32)
    expect(mean).toBeGreaterThan(90)
    expect(mean).toBeLessThan(130)
  })

  it("changes NOISE_FPS times a second, and fills the box", () => {
    expect(noiseFrame(0)).toBe(noiseFrame(1000 / NOISE_FPS - 1))
    expect(noiseFrame(1000)).toBe(NOISE_FPS)
    const c = document.createElement("canvas")
    c.width = 160
    c.height = 90
    const ctx = c.getContext("2d")!
    drawStatic(ctx, { x: 0, y: 0, w: 160, h: 90 }, 12_345)
    const d = ctx.getImageData(0, 0, 160, 90).data
    let opaque = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] === 255) opaque++
    expect(opaque).toBe(160 * 90)
  })
})

describe("the screens redraw for static only while it shows", () => {
  const still = { now: 0, hostNow: 0, fading: false, cameraInCanvas: false, strips: new Set<string>() }
  const staticFrame = (): SceneFrame => frameOf(cameraScene({ noSignal: "static" }))

  it("a camera showing static (not playing, seen) is what counts", () => {
    const f = staticFrame()
    expect(sceneStatic(f, () => false)).toBe(true)
    expect(sceneStatic(f, () => true)).toBe(false)
    expect(sceneStatic({ ...f, layers: f.layers.map((l) => ({ ...l, opacity: 0 })) }, () => false)).toBe(false)
    expect(sceneStatic(frameOf(cameraScene()), () => false)).toBe(false)
    expect(sceneStatic(undefined, () => false)).toBe(false)
  })

  it("a browser feed wakes at the next change of the static only, and stops when the camera sends", () => {
    const f = { scene: staticFrame() }
    const off = feedMotion(f, { ...still, playing: () => false })
    expect(off).toEqual({ picture: false, crawl: false, noise: true })
    const wait = feedNext(off, 1000)
    expect(typeof wait).toBe("number")
    expect(wait as number).toBeGreaterThan(0)
    expect(wait as number).toBeLessThanOrEqual(Math.ceil(1000 / NOISE_FPS))
    // The camera sends: nothing moves, the page stops drawing.
    const on = feedMotion(f, { ...still, playing: () => true })
    expect(on.noise).toBe(false)
    expect(feedNext(on, 1000)).toBeNull()
    // Bars do not move either.
    expect(feedNext(feedMotion({ scene: frameOf(cameraScene()) }, { ...still, playing: () => false }), 1000)).toBeNull()
    expect(feedNext({ picture: false, crawl: true, noise: true }, 0)).toBe("frame")
  })

  it("an output window's pacer runs at the static's rate while it shows, and stops after", () => {
    const base = { ndi: false, ndiFps: 30, moving: false, cameraPlaying: false, fading: false, staticShown: false, clockRunning: false }
    expect(outputPace({ ...base, staticShown: true })).toBe(NOISE_FPS)
    expect(outputPace(base)).toBe(0)
    expect(outputPace({ ...base, clockRunning: true })).toBe(1)
    expect(outputPace({ ...base, staticShown: true, cameraPlaying: true })).toBe(30)
    expect(outputPace({ ...base, ndi: true, moving: true, staticShown: true, ndiFps: 25 })).toBe(25)
  })
})
