import { describe, expect, it } from "vitest"
import { DEFAULT_COUNTDOWN_LOOK, lookCounting, NO_COUNTDOWN_SOURCES, normalizeCountdownLook, countsName } from "./countdown-display"
import { clockText, stageClock, zoneCity } from "./stage-clock"
import { DEFAULT_STAGE_STYLE, normalizeStageStyle } from "./stage-style"
import { drawStage, ROLE_LAYOUTS, stageOnCanvas, stageSurface } from "./stage-canvas"
import { FEED_STALE_AFTER_MS, feedStale, pageClockSkew } from "./feed-freshness"
import { feedHealthLabel } from "./browser-feeds"
import { outputEditPatch, outputPresentation } from "./output-summary"
import type { BroadcastOutput, StagePayload } from "@/types"

/** #196 (stage-062): countdowns to an item's start or a group's end, the stage clock, role layouts, feeds that say they are out of date. */
const at = (h: number, m: number) => new Date(2026, 9, 25, h, m).getTime()
const idleTimer = { durationMs: 0, startedAt: null, accumulatedMs: 0 }

describe("the countdown display counts to an item's start or a group's end (R2.4)", () => {
  const targets = { next: null, end: null, endBy: {}, starts: { sermon: { label: "Sermon starts", at: at(10, 30) } }, groupEnds: { g: { label: "End of Worship", at: at(10, 25) } } }
  it("counts to the chosen one's expected time, with its name, the percentages over the minutes before it", () => {
    const look = normalizeCountdownLook({ ...DEFAULT_COUNTDOWN_LOOK, counts: "itemStart", targetId: "sermon", leadMinutes: 15 })
    expect(lookCounting(look, NO_COUNTDOWN_SOURCES, idleTimer, 0, at(10, 20), "", targets)).toEqual({ label: "Sermon starts", totalMs: 15 * 60_000, endsAt: at(10, 30), leftMs: 0 })
    const group = normalizeCountdownLook({ ...look, counts: "groupEnd", targetId: "g" })
    expect(lookCounting(group, NO_COUNTDOWN_SOURCES, idleTimer, 0, at(10, 20), "", targets)).toMatchObject({ label: "End of Worship", endsAt: at(10, 25) })
    expect(countsName({ ...group, targetName: "Worship" })).toBe("Time until Worship ends")
  })

  it("says what to do when nothing is chosen, or it is not in the run of show", () => {
    const look = normalizeCountdownLook({ ...DEFAULT_COUNTDOWN_LOOK, counts: "itemStart" })
    expect(lookCounting(look, NO_COUNTDOWN_SOURCES, idleTimer, 0, at(10, 20), "", targets).idle).toMatch(/Choose an item/)
    expect(lookCounting({ ...look, targetId: "gone" }, NO_COUNTDOWN_SOURCES, idleTimer, 0, at(10, 20), "", targets).idle).toMatch(/not in the main service/)
  })

  it("a look saved before keeps its shape; the chosen item is kept", () => {
    expect(normalizeCountdownLook(DEFAULT_COUNTDOWN_LOOK)).toEqual(DEFAULT_COUNTDOWN_LOOK)
    expect(normalizeCountdownLook({ counts: "groupEnd", targetId: "g1" })).toMatchObject({ counts: "groupEnd", targetId: "g1" })
    expect(normalizeCountdownLook({ counts: "somethingNewer" as never }).counts).toBe("timer")
  })
})

describe("the stage clock: 12 or 24 hours, a second time zone (R2.6)", () => {
  const t = Date.UTC(2026, 9, 25, 13, 5)
  it("on the church's clock, as chosen", () => {
    expect(clockText(t, "Africa/Lagos", 24)).toBe("14:05")
    expect(clockText(t, "Africa/Lagos", 12)).toMatch(/^2:05\s?PM$/)
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires")
  })

  it("nothing unless the design shows it; a second zone named by its city or its label", () => {
    expect(stageClock(t, DEFAULT_STAGE_STYLE, "Africa/Lagos")).toBeNull()
    expect(stageClock(t, { showClock: true, secondZone: "Europe/London" }, "Africa/Lagos")).toEqual({ time: "14:05", second: { label: "London", time: "13:05" } })
    expect(stageClock(t, { showClock: true, clockHours: 12, secondZone: "America/New_York", secondZoneLabel: "Online" }, "Africa/Lagos")?.second).toEqual({ label: "Online", time: expect.stringMatching(/^9:05\s?AM$/) })
  })

  it("a design saved before reads as it was; a zone this computer does not know is not kept", () => {
    expect(normalizeStageStyle(DEFAULT_STAGE_STYLE)).toEqual(DEFAULT_STAGE_STYLE)
    expect(normalizeStageStyle({ showClock: true, clockHours: 12, secondZone: "Mars/Olympus", secondZoneLabel: "  " })).toMatchObject({ showClock: true, clockHours: 12 })
    expect(normalizeStageStyle({ showClock: true, secondZone: "Mars/Olympus" }).secondZone).toBeUndefined()
    expect(normalizeStageStyle({ clockHours: 24 as const }).clockHours).toBeUndefined()
  })
})

/** A canvas context that records what is drawn. */
function recorder() {
  const texts: { text: string; font: string; fill: string }[] = []
  const turns: number[] = []
  const ctx = {
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 0, textAlign: "left", textBaseline: "alphabetic",
    save() {}, restore() {}, fillRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {}, translate() {},
    rotate(a: number) { turns.push(a) },
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillText(text: string) { texts.push({ text, font: ctx.font, fill: String(ctx.fillStyle) }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, turns }
}
const STAGE: StagePayload = {
  current: { title: "Amazing grace", lines: ["Amazing grace, how sweet the sound"] },
  next: "Sermon", note: "Pastor walks up", timer: { label: "12:40", tone: "ok" }, message: null, band: "Key G · 72 bpm",
  finish: { time: "11:42", lateMin: 5 }, aux: [{ label: "Communion prep", text: "3:12", tone: "ok" }],
}
const size = (font: string) => Number(/(\d+)px/.exec(font)?.[1])

describe("stage layouts per role, portrait and night (R6)", () => {
  it("the plain stage page stays as it was unless a new choice is made", () => {
    expect(stageOnCanvas(STAGE)).toBe(false)
    for (const extra of [{ layout: "pastor" as const }, { portrait: "cw" as const }, { night: true }, { clock: { time: "10:42" } }]) expect(stageOnCanvas({ ...STAGE, ...extra })).toBe(true)
  })

  it("the pastor's monitor: a timer twice as large, no key or extra timers", () => {
    const full = recorder(), pastor = recorder()
    drawStage(full.ctx, 1920, 1080, STAGE)
    drawStage(pastor.ctx, 1920, 1080, { ...STAGE, layout: "pastor" })
    const timer = (r: ReturnType<typeof recorder>) => size(r.texts.find((t) => t.text === "12:40")!.font)
    expect(timer(pastor)).toBe(timer(full) * ROLE_LAYOUTS.pastor.timer)
    expect(pastor.texts.some((t) => t.text.includes("Key G"))).toBe(false)
    expect(pastor.texts.some((t) => t.text.includes("Communion"))).toBe(false)
    expect(full.texts.some((t) => t.text.includes("Communion"))).toBe(true)
  })

  it("the band: the key large; the stage manager: every timer, the words smaller", () => {
    const band = recorder(), manager = recorder(), full = recorder()
    drawStage(full.ctx, 1920, 1080, STAGE)
    drawStage(band.ctx, 1920, 1080, { ...STAGE, layout: "band" })
    drawStage(manager.ctx, 1920, 1080, { ...STAGE, layout: "manager" })
    const font = (r: ReturnType<typeof recorder>, s: string) => size(r.texts.find((t) => t.text.includes(s))!.font)
    expect(font(band, "Key G")).toBeGreaterThan(font(full, "Key G"))
    expect(band.texts.some((t) => t.text.includes("11:42"))).toBe(false)
    expect(font(manager, "Amazing grace, how")).toBeLessThan(font(full, "Amazing grace, how"))
    expect(manager.texts.some((t) => t.text.includes("Communion"))).toBe(true)
  })

  it("the clock and a second zone on the top line", () => {
    const r = recorder()
    drawStage(r.ctx, 1920, 1080, { ...STAGE, clock: { time: "10:42", second: { label: "London", time: "09:42" } } })
    expect(r.texts.some((t) => t.text === "10:42 · London 09:42")).toBe(true)
  })

  it("night colours: no white, nothing bright", () => {
    const r = recorder()
    drawStage(r.ctx, 1920, 1080, { ...STAGE, night: true, message: "Mic 2 is off" })
    expect(r.texts.every((t) => !["#fff", "#ffffff", "#9be37a", "#ffd166"].includes(t.fill.toLowerCase()))).toBe(true)
  })

  it("a screen on its side: turned a quarter turn on a landscape picture, drawn tall on a tall one", () => {
    const cw = recorder(), ccw = recorder(), tall = recorder()
    drawStage(cw.ctx, 1920, 1080, { ...STAGE, portrait: "cw" })
    drawStage(ccw.ctx, 1920, 1080, { ...STAGE, portrait: "ccw" })
    drawStage(tall.ctx, 1080, 1920, { ...STAGE, portrait: "cw" })
    expect(cw.turns).toEqual([-Math.PI / 2])
    expect(ccw.turns).toEqual([Math.PI / 2])
    expect(tall.turns).toEqual([])
    expect(stageSurface({ ...STAGE, portrait: "cw" }, 1080, 1920)).toEqual({ width: 1080, height: 1920 })
    expect(stageSurface({ ...STAGE, portrait: "cw" }, 1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(stageSurface(STAGE, 1080, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it("the outputs list names the layout, and the editor saves it", () => {
    const o = { id: "s", name: "Pulpit", role: "stage", type: "display", themeId: "", monitorIndex: 0, ndi: {} } as unknown as BroadcastOutput
    expect(outputPresentation({ ...o, stageLayout: "pastor", stageOrientation: "cw", stageNight: true }, [])).toMatch(/Pastor's confidence monitor.*portrait, night colours/)
    expect(outputPresentation(o, [])).toBe("Stage display (words, next, note, timer)")
    // Saving the editor on an existing output keeps them (and clears them when set back).
    expect(outputEditPatch({ ...o, stageLayout: "band", stageOrientation: "ccw", stageNight: true })).toMatchObject({ stageLayout: "band", stageOrientation: "ccw", stageNight: true })
    expect(outputEditPatch(o)).toMatchObject({ stageLayout: undefined, stageOrientation: undefined, stageNight: undefined })
  })
})

describe("feed pages that say they are out of date, and clocks that differ (R5)", () => {
  it("out of date after the host has been quiet; an older host (no beats) only once the link is lost", () => {
    expect(feedStale({ now: FEED_STALE_AFTER_MS, lastHeard: 0, beats: true, connected: true })).toBe(false)
    expect(feedStale({ now: FEED_STALE_AFTER_MS + 1, lastHeard: 0, beats: true, connected: true })).toBe(true)
    expect(feedStale({ now: 60_000, lastHeard: 0, beats: false, connected: true })).toBe(false)
    expect(feedStale({ now: 60_000, lastHeard: 0, beats: false, connected: false })).toBe(true)
    expect(pageClockSkew(1_000, 4_500)).toBe(3_500)
  })

  it("the output card warns when a TV's clock is more than 2 s off", () => {
    expect(feedHealthLabel({ watching: 1, current: true, behind: false, clockSkewMs: -1500 })).toBe("1 page · showing the latest")
    expect(feedHealthLabel({ watching: 1, current: true, behind: false, clockSkewMs: -4000 })).toBe("1 page · showing the latest · its clock is 4 s behind this computer's")
  })
})
